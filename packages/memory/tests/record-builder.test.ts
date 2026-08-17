import { describe, expect, it } from "vitest";
import {
  buildMemoryRecord,
  defaultIdFactory,
  clamp01,
} from "../src/record-builder.js";
import { makeClock } from "./helpers.js";

function ctx(repositoryId = "repo") {
  const clock = makeClock();
  return {
    repositoryId,
    now: clock.clock,
    id: defaultIdFactory(),
  };
}

describe("buildMemoryRecord", () => {
  it("produces a content-derived deterministic id", () => {
    const a = buildMemoryRecord(ctx(), "architecture", "t", {
      owner: "o",
      responsibility: "r",
      constraints: [],
    });
    const b = buildMemoryRecord(ctx(), "architecture", "t", {
      owner: "o",
      responsibility: "r",
      constraints: [],
    });
    expect(a.id).toBe(b.id);
  });

  it("changes the id when content changes", () => {
    const a = buildMemoryRecord(ctx(), "failure", "t", {
      fingerprint: "f1",
      errorCategory: "x",
      affectedSubsystem: "s",
      attemptedSolution: "a",
      result: "unknown",
    });
    const b = buildMemoryRecord(ctx(), "failure", "t", {
      fingerprint: "f2",
      errorCategory: "x",
      affectedSubsystem: "s",
      attemptedSolution: "a",
      result: "unknown",
    });
    expect(a.id).not.toBe(b.id);
  });

  it("scopes the id by repository", () => {
    const same = buildMemoryRecord(ctx("A"), "task", "t", {
      task: "x",
      outcome: "success",
      affectedFiles: [],
      tests: [],
      failures: [],
      repairs: [],
    });
    const other = buildMemoryRecord(ctx("B"), "task", "t", {
      task: "x",
      outcome: "success",
      affectedFiles: [],
      tests: [],
      failures: [],
      repairs: [],
    });
    expect(same.id).not.toBe(other.id);
  });

  it("honors an explicit id override", () => {
    const record = buildMemoryRecord(ctx(), "convention", "t", {
      category: "other",
      convention: "c",
    }, { id: "explicit-id" });
    expect(record.id).toBe("explicit-id");
  });

  it("sorts and deduplicates tags deterministically", () => {
    const record = buildMemoryRecord(ctx(), "convention", "t", {
      category: "other",
      convention: "c",
    }, { tags: ["z", "a", "b", "a"] });
    expect(record.tags).toEqual(["a", "b", "z"]);
  });

  it("clamps confidence and importance to [0, 1]", () => {
    const record = buildMemoryRecord(ctx(), "architecture", "t", {
      owner: "o",
      responsibility: "r",
      constraints: [],
    }, { confidence: 3, importance: -1 });
    expect(record.confidence).toBe(1);
    expect(record.importance).toBe(0);
  });

  it("records createdAt from the injected clock", () => {
    const clock = makeClock(1234);
    const r = buildMemoryRecord(
      {
        repositoryId: "r",
        now: clock.clock,
        id: defaultIdFactory(),
      },
      "architecture",
      "t",
      { owner: "o", responsibility: "r", constraints: [] },
    );
    expect(r.createdAt).toBe(1234);
    expect(r.updatedAt).toBe(1234);
  });

  it("supports createdAt/updatedAt overrides deterministically", () => {
    const record = buildMemoryRecord(ctx(), "architecture", "t", {
      owner: "o",
      responsibility: "r",
      constraints: [],
    }, { createdAt: 100, updatedAt: 200 });
    expect(record.createdAt).toBe(100);
    expect(record.updatedAt).toBe(200);
    expect(record.createdAt).not.toBe(record.updatedAt);
  });

  it("only includes source when provided", () => {
    const withSource = buildMemoryRecord(ctx(), "decision", "t", {
      decision: "d",
      rationale: "r",
      affectedArea: "a",
    }, { source: "ADR" });
    const without = buildMemoryRecord(ctx(), "decision", "t", {
      decision: "d",
      rationale: "r",
      affectedArea: "a",
    });
    expect(withSource.source).toBe("ADR");
    expect(without.source).toBeUndefined();
  });
});

describe("defaultIdFactory", () => {
  it("is deterministic: identical inputs yield identical ids", () => {
    const factory = defaultIdFactory();
    expect(
      factory({ repositoryId: "r", type: "task", seed: "seed" }),
    ).toBe(factory({ repositoryId: "r", type: "task", seed: "seed" }));
  });

  it("differs across repository or type", () => {
    const factory = defaultIdFactory();
    expect(
      factory({ repositoryId: "r", type: "task", seed: "s" }),
    ).not.toBe(factory({ repositoryId: "r2", type: "task", seed: "s" }));
    expect(
      factory({ repositoryId: "r", type: "task", seed: "s" }),
    ).not.toBe(factory({ repositoryId: "r", type: "failure", seed: "s" }));
  });
});

describe("clamp01", () => {
  it("bounds values below and above", () => {
    expect(clamp01(-5)).toBe(0);
    expect(clamp01(5)).toBe(1);
    expect(clamp01(0.5)).toBe(0.5);
  });

  it("is deterministic for NaN and Infinity", () => {
    expect(clamp01(Number.NaN)).toBeGreaterThan(0);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(1);
  });
});