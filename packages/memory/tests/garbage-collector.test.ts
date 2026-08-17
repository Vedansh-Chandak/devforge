import { describe, expect, it } from "vitest";
import {
  collectGarbage,
  isProtected,
  evictionPriority,
  defaultGcConfig,
  type GcConfig,
} from "../src/garbage-collector.js";
import { buildMemoryRecord, defaultIdFactory } from "../src/record-builder.js";
import { makeClock } from "./helpers.js";
import type { MemoryRecord, MemoryType } from "../src/types.js";

const NOW = 1_700_000_000_000;

function rec(
  type: MemoryType,
  title: string,
  overrides: Partial<MemoryRecord> & { id: string } = { id: "auto" },
): MemoryRecord {
  const clock = makeClock();
  const base = buildMemoryRecord(
    { repositoryId: "repo", now: clock.clock, id: defaultIdFactory() },
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
      createdAt: overrides.createdAt ?? NOW,
      updatedAt: overrides.updatedAt ?? NOW,
      confidence: overrides.confidence,
      importance: overrides.importance,
      tags: overrides.tags,
    },
  );
  const link = {} as Partial<MemoryRecord>;
  if (overrides.supersededBy) link.supersededBy = overrides.supersededBy;
  return { ...base, ...link } as MemoryRecord;
}

describe("isProtected", () => {
  it("protects architecture/decision above the confidence threshold", () => {
    const arch = rec("architecture", "core", { id: "a", confidence: 0.8 });
    const convention = rec("convention", "core", { id: "c", confidence: 0.8 });
    expect(isProtected(arch, {})).toBe(true);
    expect(isProtected(convention, {})).toBe(false);
  });

  it("does not protect below the threshold", () => {
    const arch = rec("architecture", "core", { id: "a", confidence: 0.5 });
    expect(isProtected(arch, {})).toBe(false);
  });

  it("respects explicit protected ids", () => {
    const task = rec("task", "t", { id: "pin-me" });
    expect(isProtected(task, { protectedIds: ["pin-me"] })).toBe(true);
  });

  it("respects configurable threshold and types", () => {
    const conv = rec("convention", "c", { id: "c", confidence: 0.9 });
    expect(isProtected(conv, { protectedTypes: ["convention"] })).toBe(true);
    expect(isProtected(conv, { protectHighConfidenceAbove: 0.95 })).toBe(false);
  });
});

describe("defaultGcConfig", () => {
  it("protects architecture and decision by default", () => {
    expect(defaultGcConfig().protectedTypes).toEqual(["architecture", "decision"]);
    expect(defaultGcConfig().protectHighConfidenceAbove).toBe(0.8);
  });
});

describe("evictionPriority", () => {
  it("evicts lower importance*confidence first", () => {
    const weak = rec("task", "weak", { id: "weak", importance: 0.1, confidence: 0.1 });
    const strong = rec("task", "strong", { id: "strong", importance: 0.9, confidence: 0.9 });
    expect(evictionPriority(weak, strong)).toBeLessThan(0);
  });

  it("tie-breaks by createdAt ascending then id descending", () => {
    const a = rec("task", "a", { id: "aaa", createdAt: 100 });
    const b = rec("task", "b", { id: "bbb", createdAt: 200 });
    expect(evictionPriority(a, b)).toBeLessThan(0); // older evicted first
    const sameAge1 = rec("task", "x", { id: "aaa", createdAt: 100 });
    const sameAge2 = rec("task", "y", { id: "bbb", createdAt: 100 });
    // larger id evicted first
    expect(evictionPriority(sameAge1, sameAge2)).toBeGreaterThan(0);
  });
});

describe("collectGarbage", () => {
  it("removes exact content duplicates keeping the newest", () => {
    const old = rec("task", "identical", { id: "old", createdAt: 100 });
    const fresh = rec("task", "identical", { id: "fresh", createdAt: 200 });
    const result = collectGarbage([old, fresh], {});
    expect(result.reasons.get("old")).toBe("duplicates");
    expect(result.remaining.map((r) => r.id)).toEqual(["fresh"]);
  });

  it("preserves both records when duplicate cleanup is skipped", () => {
    const old = rec("task", "identical", { id: "old", createdAt: 100 });
    const fresh = rec("task", "identical", { id: "fresh", createdAt: 200 });
    const result = collectGarbage([old, fresh], { skipDuplicateCleanup: true });
    expect(result.remaining).toHaveLength(2);
  });

  it("removes expired records but protects high-confidence architecture", () => {
    const now = NOW + 1000;
    const expiredArch = rec("architecture", "old arch", { id: "arch", createdAt: 100, confidence: 0.9 });
    const expiredConv = rec("convention", "old conv", { id: "conv", createdAt: 100, confidence: 0.9 });
    const result = collectGarbage([expiredArch, expiredConv], { maxAgeMs: 500, now: () => now });
    expect(result.remaining.map((r) => r.id)).toEqual(["arch"]);
    expect(result.reasons.get("conv")).toBe("age");
  });

  it("expires unprotected records older than the window", () => {
    const now = NOW + 1000;
    const old = rec("failure", "old", { id: "f", createdAt: 100 });
    const current = rec("failure", "current", { id: "c", createdAt: now - 200 });
    const result = collectGarbage([old, current], {
      maxAgeMs: 500,
      now: () => now,
    });
    expect(result.reasons.get("f")).toBe("age");
    expect(result.remaining.map((r) => r.id)).toEqual(["c"]);
  });

  it("respects explicit protected ids against expiration", () => {
    const old = rec("session", "old", { id: "s1", createdAt: 100 });
    const result = collectGarbage([old], {
      maxAgeMs: 500,
      protectedIds: ["s1"],
      now: () => NOW + 1000,
    });
    expect(result.remaining).toHaveLength(1);
  });

  it("enforces a maximum record count deterministically", () => {
    const records = [
      rec("task", "strong", { id: "s", importance: 0.9 }),
      rec("task", "mid", { id: "m", importance: 0.5 }),
      rec("task", "weak", { id: "w", importance: 0.1 }),
    ];
    const result = collectGarbage(records, { maxRecords: 2 });
    expect(result.remaining).toHaveLength(2);
    expect(result.reasons.get("w")).toBe("records");
  });

  it("never evicts protected records beneath the cap", () => {
    const arch = rec("architecture", "core", { id: "core", importance: 0.001, confidence: 0.9 });
    const task = rec("task", "t", { id: "t", importance: 0.99 });
    const result = collectGarbage([arch, task], { maxRecords: 1 });
    expect(result.remaining.map((r) => r.id)).toEqual(["core"]);
  });

  it("enforces a maximum byte budget", () => {
    const small = rec("task", "tiny", { id: "small", createdAt: NOW });
    const big = rec("task", `big-${"x".repeat(400)}`, { id: "big", createdAt: 100 });
    const sized = (records: readonly MemoryRecord[]) =>
      records.reduce(
        (sum, r) => sum + Buffer.byteLength(JSON.stringify(r), "utf8"),
        0,
      );
    const result = collectGarbage(
      [small, big],
      { maxBytes: sized([small]) },
      { sizeOf: sized, duplicateKey: (r) => r.id },
    );
    expect(result.remaining).toContain(small);
    expect(result.reasons.get("big")).toBe("bytes");
    expect(result.sizeAfter).toBeLessThanOrEqual(result.sizeBefore);
  });

  it("is fully deterministic across identical runs", () => {
    const records = [
      rec("task", "a", { id: "a", importance: 0.3, createdAt: 100 }),
      rec("task", "b", { id: "b", importance: 0.9, createdAt: 200 }),
      rec("task", "c", { id: "c", importance: 0.5, createdAt: 300 }),
      rec("task", "d", { id: "d", importance: 0.2, createdAt: 400 }),
    ];
    const config: GcConfig = { maxRecords: 2 };
    const first = collectGarbage(records, config);
    const second = collectGarbage(records, config);
    expect(first.remaining.map((r) => r.id)).toEqual(second.remaining.map((r) => r.id));
    expect(first.reasons).toEqual(second.reasons);
  });

  it("ordered removal is stable regardless of input order", () => {
    const records = [
      rec("task", "a", { id: "a", importance: 0.1 }),
      rec("task", "b", { id: "b", importance: 0.9 }),
      rec("task", "c", { id: "c", importance: 0.5 }),
    ];
    const forward = collectGarbage(records, { maxRecords: 1 });
    const reversed = collectGarbage([...records].reverse(), { maxRecords: 1 });
    expect(forward.remaining.map((r) => r.id)).toEqual(reversed.remaining.map((r) => r.id));
  });

  it("reports protected and size bookkeeping", () => {
    const arch = rec("architecture", "core", { id: "core", confidence: 0.9 });
    const task = rec("task", "t", { id: "t" });
    const result = collectGarbage([arch, task], { maxRecords: 1 });
    expect(result.protected.map((r) => r.id)).toEqual(["core"]);
    expect(result.sizeBefore).toBeGreaterThan(result.sizeAfter);
    expect(result.remaining.length).toBe(result.remaining.length);
  });

  it("handles an empty record set", () => {
    const result = collectGarbage([], {});
    expect(result.remaining).toEqual([]);
    expect(result.protected).toEqual([]);
    expect(result.sizeBefore).toBe(0);
  });

  it("does not remove duplicates for distinct content", () => {
    const a = rec("failure", "one", { id: "a" });
    const b = rec("failure", "two", { id: "b" });
    const result = collectGarbage([a, b], {});
    expect(result.remaining).toHaveLength(2);
  });
});