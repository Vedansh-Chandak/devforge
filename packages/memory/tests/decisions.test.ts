import { describe, expect, it } from "vitest";
import { buildDecisionRecord, DecisionMemory } from "../src/decisions.js";
import { InvalidRecordError, NotFoundError } from "../src/errors.js";
import { makeClock, makeMemory } from "./helpers.js";

function ctx() {
  const clock = makeClock();
  return {
    repositoryId: "repo-d",
    now: clock.clock,
    id: (input: { seed: string }) => `id-${input.seed}`,
  };
}

describe("buildDecisionRecord", () => {
  it("builds a decision with rationale and affected area", () => {
    const record = buildDecisionRecord(ctx(), {
      title: "Git through GitService",
      decision: "Git operations must go through GitService.",
      rationale: "Prevents direct shell Git usage throughout the platform.",
      affectedArea: "platform/git",
      source: "ADR-001",
      confidence: 0.9,
    });
    expect(record.type).toBe("decision");
    expect(record.data.decision).toContain("GitService");
    expect(record.data.affectedArea).toBe("platform/git");
    expect(record.source).toBe("ADR-001");
  });

  it("is deterministic for identical inputs", () => {
    const input = {
      title: "t",
      decision: "d",
      rationale: "r",
      affectedArea: "a",
    };
    const a = buildDecisionRecord(ctx(), input);
    const b = buildDecisionRecord(ctx(), input);
    expect(a.id).toBe(b.id);
  });

  it("rejects missing decisions and rationales", () => {
    expect(() =>
      buildDecisionRecord(ctx(), { title: "t", decision: "", rationale: "r", affectedArea: "a" }),
    ).toThrow(InvalidRecordError);
    expect(() =>
      buildDecisionRecord(ctx(), { title: "t", decision: "d", rationale: "", affectedArea: "a" }),
    ).toThrow(InvalidRecordError);
  });
});

describe("DecisionMemory", () => {
  it("adds and retrieves decisions", async () => {
    const { memory } = makeMemory();
    await memory.load();
    const decision = await memory.decisions.add({
      title: "Repo boundaries",
      decision: "Package boundaries must be respected.",
      rationale: "Keeps coupling low.",
      affectedArea: "packages",
    });
    const fetched = await memory.decisions.getOrThrow(decision.id);
    expect(fetched.data.rationale).toContain("coupling");
  });

  it("preserves historical decisions rather than overwriting them", async () => {
    const { memory } = makeMemory();
    await memory.load();
    const first = await memory.decisions.add({
      title: "Module system",
      decision: "Use ESM.",
      rationale: "Consistency.",
      affectedArea: "platform",
    });
    const second = await memory.decisions.add({
      title: "Module system",
      decision: "Use ESM with NodeNext resolution.",
      rationale: "Modern tooling.",
      affectedArea: "platform",
    });
    expect(first.id).not.toBe(second.id);
    expect(await memory.decisions.count()).toBe(2);
    expect(await memory.decisions.get(first.id)).not.toBeNull();
    expect(await memory.decisions.get(second.id)).not.toBeNull();
  });

  it("supersedes an old decision with a new one while keeping history", async () => {
    const { memory } = makeMemory();
    await memory.load();
    const old = await memory.decisions.add({
      title: "Git access",
      decision: "Allow direct shell git.",
      rationale: "Speed.",
      affectedArea: "platform/git",
    });
    const { previous, current } = await memory.decisions.supersede(old.id, {
      title: "Git sandbox",
      decision: "All Git ops go through GitService.",
      rationale: "Prevents direct shell usage in the platform.",
      affectedArea: "platform/git",
    });

    expect(previous.supersededBy).toBe(current.id);
    expect(current.supersedes).toBe(old.id);

    // The old decision is still present and retrievable.
    const stored = await memory.decisions.get(old.id);
    expect(stored).not.toBeNull();
    expect(stored?.supersededBy).toBe(current.id);
    expect(await memory.decisions.count()).toBe(2);
  });

  it("superseding a missing decision throws NotFoundError", async () => {
    const { memory } = makeMemory();
    await memory.load();
    await expect(
      memory.decisions.supersede("ghost", {
        title: "t",
        decision: "d",
        rationale: "r",
        affectedArea: "a",
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("activeFor returns the active decision for an area", async () => {
    const { memory } = makeMemory();
    await memory.load();
    const old = await memory.decisions.add({
      title: "Storage",
      decision: "Use JSON.",
      rationale: "Simple.",
      affectedArea: "persistence",
    });
    await memory.decisions.supersede(old.id, {
      title: "Storage v2",
      decision: "Use SQLite.",
      rationale: "Queries.",
      affectedArea: "persistence",
    });
    const active = await memory.decisions.activeFor("persistence");
    expect(active?.data.decision).toBe("Use SQLite.");
    expect(active?.supersedes).toBe(old.id);
  });

  it("historyOf walks the supersession chain", async () => {
    const { memory } = makeMemory();
    await memory.load();
    const v1 = await memory.decisions.add({
      title: "v1",
      decision: "one",
      rationale: "r",
      affectedArea: "x",
    });
    const { current: v2 } = await memory.decisions.supersede(v1.id, {
      title: "v2",
      decision: "two",
      rationale: "r",
      affectedArea: "x",
    });
    const { current: v3 } = await memory.decisions.supersede(v2.id, {
      title: "v3",
      decision: "three",
      rationale: "r",
      affectedArea: "x",
    });
    const chain = await memory.decisions.historyOf(v1.id);
    expect(chain.map((r) => r.id)).toEqual([v1.id, v2.id, v3.id]);
  });

  it("superseded decisions receive a ranking penalty on retrieval", async () => {
    const { memory } = makeMemory();
    await memory.load();
    const old = await memory.decisions.add({
      title: "Cache strategy",
      decision: "No caching.",
      rationale: "r",
      affectedArea: "cache",
      confidence: 1,
    });
    const { current } = await memory.decisions.supersede(old.id, {
      title: "Cache strategy",
      decision: "Add LRU cache.",
      rationale: "r",
      affectedArea: "cache",
      confidence: 1,
    });
    const result = await memory.retrieve("cache strategy", { types: ["decision"], limit: 5 });
    const rankedIds = result.records.map((r) => r.record.id);
    expect(rankedIds.indexOf(current.id)).toBeLessThan(rankedIds.indexOf(old.id));
  });
});