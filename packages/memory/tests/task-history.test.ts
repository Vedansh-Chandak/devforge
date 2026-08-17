import { describe, expect, it } from "vitest";
import { buildTaskRecord, TaskMemory } from "../src/task.js";
import { InvalidRecordError } from "../src/errors.js";
import { makeClock, makeMemory } from "./helpers.js";

function ctx() {
  const clock = makeClock();
  return {
    repositoryId: "repo-t",
    now: clock.clock,
    id: (input: { seed: string }) => `id-${input.seed}`,
  };
}

describe("buildTaskRecord", () => {
  it("builds a typed task record deterministically", () => {
    const input = {
      title: "fix ranking",
      task: "Make ranking deterministic",
      outcome: "success" as const,
      affectedFiles: ["src/ranking.ts"],
      tests: ["tests/ranking.test.ts"],
      repairs: ["added tie-breakers"],
    };
    const a = buildTaskRecord(ctx(), input);
    const b = buildTaskRecord(ctx(), input);
    expect(a.id).toBe(b.id);
    expect(a.data.outcome).toBe("success");
    expect(a.data.repairs).toEqual(["added tie-breakers"]);
  });

  it("rejects invalid outcomes", () => {
    expect(() =>
      buildTaskRecord(ctx(), {
        title: "t",
        task: "task",
        // @ts-expect-error invalid outcome
        outcome: "bogus",
      }),
    ).toThrow(InvalidRecordError);
  });

  it("accepts each documented outcome", () => {
    for (const outcome of ["success", "failure", "partial"] as const) {
      const record = buildTaskRecord(ctx(), { title: "t", task: "task", outcome });
      expect(record.data.outcome).toBe(outcome);
    }
  });

  it("defaults file/test/repair lists to empty arrays", () => {
    const record = buildTaskRecord(ctx(), { title: "t", task: "task", outcome: "failure" });
    expect(record.data.affectedFiles).toEqual([]);
    expect(record.data.failures).toEqual([]);
  });
});

describe("TaskMemory", () => {
  it("adds and retrieves tasks", async () => {
    const { memory } = makeMemory();
    await memory.load();
    const task = await memory.tasks.add({
      title: "Implement memory",
      task: "Build the whole memory package",
      outcome: "success",
      affectedFiles: ["packages/memory/src/index.ts"],
      tests: ["packages/memory/tests"],
    });
    expect(await memory.tasks.get(task.id)).not.toBeNull();
  });

  it("latest returns the most recent task by outcome", async () => {
    const { memory, clock } = makeMemory();
    await memory.load();
    await memory.tasks.add({ title: "one", task: "first", outcome: "failure" });
    clock.advance(1000);
    const second = await memory.tasks.add({ title: "two", task: "second", outcome: "success" });
    const latest = await memory.tasks.latest("success");
    expect(latest?.id).toBe(second.id);
    expect(await memory.tasks.latest("partial")).toBeNull();
  });

  it("records structured success details", async () => {
    const { memory } = makeMemory();
    await memory.load();
    const task = await memory.tasks.add({
      title: "Repair git diff",
      task: "Fix staged diff parsing",
      outcome: "success",
      affectedFiles: ["packages/execution/src/git/parser.ts"],
      tests: ["packages/execution/src/git/tests/parser.test.ts"],
      failures: ["hunks dropped trailing context"],
      repairs: ["preserve hunk headers"],
    });
    const fetched = await memory.tasks.getOrThrow(task.id);
    expect(fetched.data.affectedFiles[0]).toContain("parser.ts");
    expect(fetched.data.repairs).toContain("preserve hunk headers");
    expect(fetched.data.failures[0]).toContain("trailing context");
  });
});