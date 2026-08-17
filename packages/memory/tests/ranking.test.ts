import { describe, expect, it } from "vitest";
import {
  scoreRecord,
  rankRecords,
  compareRanked,
  RANKING_WEIGHTS,
  type RankInput,
} from "../src/ranking.js";
import { buildMemoryRecord, defaultIdFactory } from "../src/record-builder.js";
import type { MemoryRecord, MemoryType } from "../src/types.js";

const NOW = 1_700_000_000_000;

function make(
  type: MemoryType,
  title: string,
  overrides: Partial<MemoryRecord> & { id?: string } = {},
): MemoryRecord {
  const factory = defaultIdFactory();
  const base = buildMemoryRecord(
    {
      repositoryId: "repo",
      now: () => NOW,
      id: factory,
    },
    type,
    title,
    {
      architecture: { owner: "o", responsibility: "r", constraints: [] },
      convention: { category: "other", convention: "c" },
      decision: { decision: "d", rationale: "r", affectedArea: "a" },
      task: { task: title, outcome: "success" as const, affectedFiles: [], tests: [], failures: [], repairs: [] },
      failure: {
        fingerprint: "fp",
        errorCategory: "x",
        affectedSubsystem: "s",
        attemptedSolution: "a",
        result: "unknown" as const,
      },
      session: { sessionId: "s", userRequest: title, actions: [], result: "r", discoveries: [] },
    }[type],
    {
      id: overrides.id,
      createdAt: overrides.createdAt,
      updatedAt: overrides.updatedAt,
      confidence: overrides.confidence,
      importance: overrides.importance,
      tags: overrides.tags,
      source: overrides.source,
    },
  );
  const link = {} as Partial<MemoryRecord>;
  if (overrides.supersededBy) link.supersededBy = overrides.supersededBy;
  if (overrides.supersedes) link.supersedes = overrides.supersedes;
  return { ...base, ...link } as MemoryRecord;
}

function input(record: MemoryRecord, query: string, now = NOW): RankInput {
  return { record, query, now };
}

describe("scoreRecord", () => {
  it("scores an exact title match highest", () => {
    const record = make("architecture", "GitService mutates git only");
    const result = scoreRecord(input(record, "GitService mutates"));
    expect(result.signals.exactTitle).toBe(RANKING_WEIGHTS.exactTitle);
    expect(result.score).toBeGreaterThan(0);
  });

  it("gives a smaller boost for phrase matches outside the title", () => {
    const record = make("task", "general title", { id: "t1" });
    // Put the phrase inside the payload text, not the title.
    const textHit = { ...record, data: { ...record.data, ...payloadFor(record, "deterministic tie-break") } };
    const result = scoreRecord(input(textHit as MemoryRecord, "deterministic tie-break"));
    expect(result.signals.exactTitle).toBe(0);
    expect(result.signals.exactPhrase).toBe(RANKING_WEIGHTS.exactPhrase);
  });

  it("rewards token overlap (jaccard) proportionally", () => {
    const exact = make("task", "fix the ranking bug");
    const partial = make("task", "fix the parser bug");
    const scoreExact = scoreRecord(input(exact, "fix the ranking bug"));
    const scorePartial = scoreRecord(input(partial, "fix the ranking bug"));
    expect(scoreExact.score).toBeGreaterThan(scorePartial.score);
  });

  it("adds tag hits per matching tag token", () => {
    const tagged = make("convention", "quotes", {
      tags: ["formatting", "typescript"],
    });
    const untagged = make("convention", "quotes");
    const withQuery = scoreRecord(input(tagged, "formatting typescript"));
    const withoutQuery = scoreRecord(input(untagged, "formatting typescript"));
    expect(withQuery.score).toBeGreaterThan(withoutQuery.score);
  });

  it("boosts typeExact when the query names the memory type", () => {
    const decision = make("decision", "git policy");
    const query = "decision git policy";
    const scored = scoreRecord(input(decision, query));
    expect(scored.signals.typeExact).toBe(
      RANKING_WEIGHTS.typeExact * 1.2, // decision default weight
    );
  });

  it("scales the confidence signal by record confidence", () => {
    const high = make("architecture", "unique talk", { confidence: 1, createdAt: NOW });
    const low = make("architecture", "unique talk", { confidence: 0.1, createdAt: NOW });
    const a = scoreRecord(input(high, "unique talk"));
    const b = scoreRecord(input(low, "unique talk"));
    expect(a.signals.confidence).toBeGreaterThan(b.signals.confidence);
  });

  it("decays older records via recency", () => {
    const fresh = make("architecture", "stable subject", { createdAt: NOW });
    const old = make("architecture", "stable subject", { createdAt: NOW - 1000 * 86400 * 700 });
    const a = scoreRecord(input(fresh, "stable"));
    const b = scoreRecord(input(old, "stable"));
    expect(a.signals.recency).toBeGreaterThan(b.signals.recency);
  });

  it("penalizes superseded records", () => {
    const active = make("decision", "storage", { id: "active", createdAt: NOW });
    const superseded = make("decision", "storage", {
      id: "old",
      createdAt: NOW,
      supersededBy: "active",
    });
    const a = scoreRecord(input(active, "storage policy"));
    const b = scoreRecord(input(superseded, "storage policy"));
    expect(b.signals.superseded).toBe(RANKING_WEIGHTS.superseded);
    expect(a.score).toBeGreaterThan(b.score);
  });

  it("is deterministic: identical inputs give identical output", () => {
    const record = make("task", "identical input");
    const a = scoreRecord(input(record, "identical input"));
    const b = scoreRecord(input(record, "identical input"));
    expect(a).toEqual(b);
  });

  it("matchedTerms lists the query terms present in the record", () => {
    const record = make("architecture", "brain owns reasoning orchestration");
    const result = scoreRecord(input(record, "brain orchestration other"));
    expect(result.matchedTerms).toContain("brain");
    expect(result.matchedTerms).toContain("orchestration");
    expect(result.matchedTerms).not.toContain("other");
  });
});

describe("rankRecords", () => {
  it("orders by score descending", () => {
    const best = make("task", "shipping pipeline is done");
    const ok = make("task", "unrelated topic");
    const ranked = rankRecords([input(ok, "shipping pipeline"), input(best, "shipping pipeline")]);
    expect(ranked[0]?.record.id).toBe(best.id);
  });

  it("is independent of input order", () => {
    const records = [
      input(make("architecture", "alpha"), "alpha"),
      input(make("convention", "beta"), "beta"),
      input(make("decision", "gamma"), "gamma"),
      input(make("task", "delta"), "delta"),
    ];
    const reversed = records.slice().reverse();
    expect(rankRecords(records).map((r) => r.record.id)).toEqual(
      rankRecords(reversed).map((r) => r.record.id),
    );
  });

  it("is deterministic across repeated calls", () => {
    const records = [
      input(make("task", "task one two"), "task"),
      input(make("task", "task blue"), "task"),
      input(make("task", "two two"), "task"),
    ];
    const first = rankRecords(records);
    const second = rankRecords(records);
    expect(first.map((r) => [r.record.id, r.score])).toEqual(
      second.map((r) => [r.record.id, r.score]),
    );
  });
});

describe("tie-breaking", () => {
  it("orders equal scores by confidence descending", () => {
    const a = make("failure", "cold target", { id: "aaaa", confidence: 0.9, createdAt: NOW });
    const b = make("failure", "cold target", { id: "bbbb", confidence: 0.1, createdAt: NOW });
    // query with zero-term relevance so score is driven by confidence/recency.
    const ranked = rankRecords([input(b, "zzzzz"), input(a, "zzzzz")]);
    expect(ranked[0]?.record.id).toBe(a.id);
  });

  it("orders equal score+confidence by createdAt descending", () => {
    const older = make("failure", "cold target", { id: "aaaa", confidence: 0.5, createdAt: NOW - 1000 });
    const newer = make("failure", "cold target", { id: "bbbb", confidence: 0.5, createdAt: NOW });
    const ranked = rankRecords([input(older, "zzzzz"), input(newer, "zzzzz")]);
    expect(ranked[0]?.record.id).toBe(newer.id);
  });

  it("breaks full ties by id ascending", () => {
    const a = make("failure", "cold target", { id: "a001", confidence: 0.5, createdAt: NOW });
    const z = make("failure", "cold target", { id: "z100", confidence: 0.5, createdAt: NOW });
    const ranked = rankRecords([input(z, "zzzzz"), input(a, "zzzzz")]);
    expect(ranked.map((r) => r.record.id)).toEqual(["a001", "z100"]);
  });

  it("compareRanked is a total, antisymmetric order", () => {
    const records = [
      make("task", "t1", { id: "c", confidence: 0.5, createdAt: NOW }),
      make("task", "t2", { id: "b", confidence: 0.5, createdAt: NOW }),
      make("task", "t3", { id: "a", confidence: 0.5, createdAt: NOW }),
    ];
    for (const x of records) {
      for (const y of records) {
        const forward = compareRanked(
          { record: x, score: 0, matchedTerms: [], signals: {} as never },
          { record: y, score: 0, matchedTerms: [], signals: {} as never },
        );
        const reverse = compareRanked(
          { record: y, score: 0, matchedTerms: [], signals: {} as never },
          { record: x, score: 0, matchedTerms: [], signals: {} as never },
        );
        expect(forward + reverse).toBe(0);
      }
    }
  });
});

function payloadFor(record: MemoryRecord, text: string): Record<string, unknown> {
  switch (record.type) {
    case "task":
      return { task: text, outcome: "success", affectedFiles: [], tests: [], failures: [], repairs: [] };
    case "failure":
      return { fingerprint: text, errorCategory: "x", affectedSubsystem: "s", attemptedSolution: "a", result: "unknown" };
    default:
      return { ...record.data, title: text };
  }
}