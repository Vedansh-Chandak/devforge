import { describe, expect, it } from "vitest";
import { retrieve, type RetrieveInput } from "../src/retrieval.js";
import { buildMemoryRecord, defaultIdFactory } from "../src/record-builder.js";
import type { MemoryRecord, MemoryType } from "../src/types.js";

const NOW = 1_700_000_000_000;

function rec(
  repositoryId: string,
  type: MemoryType,
  title: string,
  overrides: Partial<MemoryRecord> = {},
): MemoryRecord {
  const base = buildMemoryRecord(
    {
      repositoryId,
      now: () => NOW,
      id: defaultIdFactory(),
    },
    type,
    title,
    {
      architecture: { owner: title, responsibility: "r", constraints: [] },
      convention: { category: "other", convention: title },
      decision: { decision: title, rationale: "r", affectedArea: "a" },
      task: { task: title, outcome: "success" as const, affectedFiles: [], tests: [], failures: [], repairs: [] },
      failure: { fingerprint: "fp", errorCategory: "x", affectedSubsystem: "s", attemptedSolution: "a", result: "unknown" as const },
      session: { sessionId: "s", userRequest: title, actions: [], result: "r", discoveries: [] },
    }[type],
    {
      id: overrides.id,
      createdAt: overrides.createdAt,
      confidence: overrides.confidence,
      tags: overrides.tags,
    },
  );
  const link = {} as Partial<MemoryRecord>;
  if (overrides.supersededBy) link.supersededBy = overrides.supersededBy;
  return { ...base, ...link } as MemoryRecord;
}

function makeInput(overrides: Partial<RetrieveInput> = {}): RetrieveInput {
  return {
    query: "git service",
    repositoryId: "repo-A",
    records: [],
    options: {},
    ...overrides,
  };
}

describe("retrieve", () => {
  it("returns ranked records for a query", () => {
    const records = [
      rec("repo-A", "architecture", "GitService owns git mutations"),
      rec("repo-A", "task", "fixed the parser"),
    ];
    const result = retrieve(makeInput({ records }));
    expect(result.total).toBe(2);
    expect(result.records[0]?.record.title).toBe("GitService owns git mutations");
  });

  it("isolates by repository: other repositories never surface", () => {
    const records = [
      rec("repo-A", "architecture", "GitService owns git"),
      rec("repo-B", "architecture", "GitService owns git"),
    ];
    const result = retrieve(makeInput({ repositoryId: "repo-A", records }));
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.record.repositoryId).toBe("repo-A");
    expect(result.total).toBe(1);
  });

  it("filters by memory type", () => {
    const records = [
      rec("repo-A", "architecture", "git service mutates"),
      rec("repo-A", "decision", "git service mutates"),
      rec("repo-A", "convention", "git knowledge"),
    ];
    const result = retrieve(
      makeInput({ records, options: { types: ["decision"] } }),
    );
    expect(result.records.every((r) => r.record.type === "decision")).toBe(true);
    expect(result.total).toBe(1);
  });

  it("applies a limit and reports truncation", () => {
    const records = [
      rec("repo-A", "architecture", "git service one"),
      rec("repo-A", "architecture", "git service two"),
      rec("repo-A", "architecture", "git service three"),
    ];
    const result = retrieve(makeInput({ records, options: { limit: 2 } }));
    expect(result.records).toHaveLength(2);
    expect(result.truncated).toBe(true);
    expect(result.limit).toBe(2);
  });

  it("returns the full set when limited beyond the candidate count", () => {
    const records = [rec("repo-A", "task", "one")];
    const result = retrieve(makeInput({ records, options: { limit: 10 } }));
    expect(result.truncated).toBe(false);
  });

  it("drops records below a minScore", () => {
    const records = [
      rec("repo-A", "task", "plumbing"),
      rec("repo-A", "task", "git service deep relevance"),
    ];
    const result = retrieve(
      makeInput({ records, options: { minScore: 50, limit: 10 } }),
    );
    expect(result.records.every((r) => r.score >= 50)).toBe(true);
    expect(result.total).toBe(result.records.length);
  });

  it("excludes superseded decisions when requested", () => {
    const records = [
      rec("repo-A", "decision", "cache policy", { id: "old", supersededBy: "new" }),
      rec("repo-A", "decision", "cache policy", { id: "new" }),
    ];
    const result = retrieve(
      makeInput({
        records,
        options: { types: ["decision"], includeSuperseded: false },
      }),
    );
    expect(result.records.map((r) => r.record.id)).toEqual(["new"]);
  });

  it("handles empty repositories", () => {
    const result = retrieve(makeInput({ records: [] }));
    expect(result.total).toBe(0);
    expect(result.records).toEqual([]);
  });

  it("returns deterministically ordered output for identical input", () => {
    const records = [
      rec("repo-A", "architecture", "ranking one"),
      rec("repo-A", "architecture", "ranking two"),
    ];
    const a = retrieve(makeInput({ records }));
    const b = retrieve(makeInput({ records }));
    expect(a.records.map((r) => r.record.id)).toEqual(
      b.records.map((r) => r.record.id),
    );
    expect(a).toEqual(b);
  });

  it("handles empty queries as pure metadata sorting", () => {
    const records = [
      rec("repo-A", "failure", "port conflict"),
      rec("repo-A", "failure", "heap leak"),
    ];
    const result = retrieve(makeInput({ query: "", records }));
    expect(result.records).toHaveLength(2);
    for (let i = 1; i < result.records.length; i += 1) {
      expect(result.records[i - 1]!.record.id < result.records[i]!.record.id).toBe(true);
    }
  });

  it("scales with large memories without losing determinism", () => {
    const records: MemoryRecord[] = [];
    for (let i = 0; i < 2000; i += 1) {
      records.push(rec("repo-A", "task", `bulk record ${i}`));
    }
    const result = retrieve(makeInput({ records, options: { limit: 10 } }));
    expect(result.total).toBe(2000);
    expect(result.records).toHaveLength(10);
  });

  it("type weights scale the type-match bonus", () => {
    const decision = rec("repo-A", "decision", "shared subject");
    const session = rec("repo-A", "session", "shared subject");
    const query = "decision shared subject";
    const defaulted = retrieve({
      query,
      repositoryId: "repo-A",
      records: [session, decision],
      options: {},
    });
    const down = retrieve({
      query,
      repositoryId: "repo-A",
      records: [session, decision],
      options: { typeWeights: { decision: 0.1 } },
    });
    // The named type still wins, but down-weighting shrinks its margin.
    expect(defaulted.records[0]?.record.type).toBe("decision");
    expect(down.records[0]?.record.type).toBe("decision");
    expect(defaulted.records[0]!.signals.typeExact).toBeGreaterThan(
      down.records[0]!.signals.typeExact,
    );
    const defaultMargin =
      defaulted.records[0]!.score - defaulted.records[1]!.score;
    const downMargin = down.records[0]!.score - down.records[1]!.score;
    expect(downMargin).toBeLessThan(defaultMargin);
  });

  it("narrows the union correctly so record.data is typed per type", () => {
    const records = [rec("repo-A", "failure", "boom")];
    const result = retrieve(makeInput({ records, options: { types: ["failure"] } }));
    const entry = result.records[0]!;
    expect(entry.record.type).toBe("failure");
  });
});