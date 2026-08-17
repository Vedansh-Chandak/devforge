import { describe, expect, it } from "vitest";
import {
  DeterministicSummarizer,
  deterministicSummarizer,
  TYPE_LABELS,
} from "../src/summarizer.js";
import { buildMemoryRecord, defaultIdFactory } from "../src/record-builder.js";
import { makeClock } from "./helpers.js";
import type { MemoryRecord, MemoryType } from "../src/types.js";

const NOW = 1_700_000_000_000;

function rec(type: MemoryType, title: string, extra: Partial<MemoryRecord> = {}): MemoryRecord {
  const clock = makeClock();
  const base = buildMemoryRecord(
    { repositoryId: "repo", now: clock.clock, id: defaultIdFactory() },
    type,
    title,
    {
      architecture: { owner: "GitService", responsibility: "git mutations", constraints: ["no direct shell"] },
      convention: { category: "formatting", convention: "single quotes" },
      decision: {
        decision: "All Git ops go through GitService.",
        rationale: "Prevents direct shell usage.",
        affectedArea: "platform/git",
      },
      task: { task: "Fix ranking", outcome: "success" as const, affectedFiles: ["src/ranking.ts"], tests: ["t"], failures: [], repairs: ["tie-break"] },
      failure: { fingerprint: "fp-1", errorCategory: "build", affectedSubsystem: "packages/memory", attemptedSolution: "narrow", result: "resolved" as const },
      session: { sessionId: "s1", userRequest: "wire memory", actions: ["explored"], result: "done", discoveries: ["store is generic"] },
    }[type],
    {
      id: extra.id,
      createdAt: extra.createdAt,
      confidence: extra.confidence,
      tags: extra.tags,
      source: extra.source,
    },
  );
  const link = {} as Partial<MemoryRecord>;
  if (extra.supersededBy) link.supersededBy = extra.supersededBy;
  if (extra.supersedes) link.supersedes = extra.supersedes;
  return { ...base, ...link } as MemoryRecord;
}

const summarizer = new DeterministicSummarizer();

describe("DeterministicSummarizer.summarize", () => {
  it("summarizes architecture memories", () => {
    const out = summarizer.summarize(rec("architecture", "Git boundary"));
    expect(out).toContain("[Architecture]");
    expect(out).toContain("GitService");
    expect(out).toContain("git mutations");
  });

  it("summarizes conventions with their category", () => {
    const out = summarizer.summarize(rec("convention", "Quote style"));
    expect(out).toContain("[Convention:formatting]");
    expect(out).toContain("single quotes");
  });

  it("summarizes decisions with rationale and supersession links", () => {
    const out = summarizer.summarize(
      rec("decision", "Git rule", { supersedes: "abc", supersededBy: "def" }),
    );
    expect(out).toContain("All Git ops go through GitService.");
    expect(out).toContain("rationale");
    expect(out).toContain("supersedes abc");
    expect(out).toContain("superseded by def");
  });

  it("summarizes tasks with outcome and file counts", () => {
    const out = summarizer.summarize(rec("task", "Ranking fix"));
    expect(out).toContain("[Task:success]");
    expect(out).toContain("1 files");
    expect(out).toContain("repairs: 1");
  });

  it("summarizes failures with category and subsystem", () => {
    const out = summarizer.summarize(rec("failure", "tsc break"));
    expect(out).toContain("[Failure:resolved]");
    expect(out).toContain("build @ packages/memory");
  });

  it("summarizes sessions with action and discovery counts", () => {
    const out = summarizer.summarize(rec("session", "Exploration"));
    expect(out).toContain("[Session]");
    expect(out).toContain("1 actions; 1 discoveries");
  });

  it("is deterministic across calls", () => {
    const record = rec("architecture", "Determinism check");
    expect(summarizer.summarize(record)).toBe(summarizer.summarize(record));
  });

  it("handles all memory types without throwing", () => {
    for (const type of ["architecture", "convention", "decision", "task", "failure", "session"] as const) {
      expect(() => summarizer.summarize(rec(type, `title ${type}`))).not.toThrow();
    }
  });
});

describe("DeterministicSummarizer.summarizeMany", () => {
  it("orders output by record id", () => {
    const a = rec("task", "aaa", { id: "b" });
    const b = rec("task", "bbb", { id: "a" });
    const out = summarizer.summarizeMany([a, b]);
    expect(out.indexOf("bbb")).toBeLessThan(out.indexOf("aaa"));
  });

  it("joins lines deterministically", () => {
    const records = [rec("decision", "d"), rec("convention", "c")];
    const first = summarizer.summarizeMany(records);
    const second = summarizer.summarizeMany(records);
    expect(first).toBe(second);
    expect(first.split("\n")).toHaveLength(2);
  });

  it("handles empty collections", () => {
    expect(summarizer.summarizeMany([])).toBe("");
  });
});

describe("DeterministicSummarizer.digest", () => {
  it("counts records per type", () => {
    const records = [
      rec("architecture", "a"),
      rec("architecture", "a2"),
      rec("decision", "d"),
      rec("failure", "f"),
    ];
    const out = summarizer.digest(records);
    expect(out).toContain("4 record(s)");
    expect(out).toContain("Architecture: 2");
    expect(out).toContain("Decision: 1");
    expect(out).toContain("Failure: 1");
  });

  it("is deterministic across identical inputs", () => {
    const records = [rec("task", "t"), rec("task", "t2")];
    expect(summarizer.digest(records)).toBe(summarizer.digest(records));
  });

  it("reports zero-length digests for empty inputs", () => {
    expect(summarizer.digest([])).toContain("0 record(s)");
  });
});

describe("offline & injectable", () => {
  it("default shared instance produces identical summaries", () => {
    const record = rec("convention", "shared instance check");
    expect(deterministicSummarizer.summarize(record)).toBe(
      summarizer.summarize(record),
    );
  });

  it("exposes human-readable type labels", () => {
    expect(TYPE_LABELS.architecture).toBe("Architecture");
    expect(TYPE_LABELS.session).toBe("Session");
  });

  it("never performs network access (pure string construction)", async () => {
    const record = rec("architecture", "offline");
    const out = summarizer.summarize(record);
    await Promise.resolve();
    expect(out.length).toBeGreaterThan(0);
  });
});