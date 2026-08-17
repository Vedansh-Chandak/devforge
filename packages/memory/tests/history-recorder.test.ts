import { describe, expect, it } from "vitest";
import { InvalidRecordError } from "../src/errors.js";
import { makeMemory } from "./helpers.js";
import { failureFingerprint } from "../src/failure.js";

describe("HistoryRecorder (via RepositoryMemory.history)", () => {
  it("records a successful repair as a success task", async () => {
    const { memory } = makeMemory();
    await memory.load();
    await memory.history.recordSuccessfulRepair({
      title: "Repair ranking",
      task: "Fix tie-breaking",
      affectedFiles: ["packages/memory/src/ranking.ts"],
      repairs: ["added id tie-breaker"],
    });
    const tasks = await memory.tasks.list();
    expect(tasks.length).toBe(1);
    expect(tasks[0]?.data.outcome).toBe("success");
    expect(tasks[0]?.data.repairs).toEqual(["added id tie-breaker"]);
  });

  it("records a failed repair as a failure task plus a failure record", async () => {
    const { memory } = makeMemory();
    await memory.load();
    await memory.history.recordFailedRepair({
      title: "Failed repair of parser",
      task: "Fix parser crash",
      fingerprint: "parser-crash-1",
      errorCategory: "runtime",
      affectedSubsystem: "packages/execution",
      attemptedSolution: "guard nulls",
      failures: ["null dereference"],
      result: "unresolved",
    });
    expect(await memory.tasks.count()).toBe(1);
    expect(await memory.failures.count()).toBe(1);
    const failure = (await memory.failures.list())[0]!;
    expect(failure.data.fingerprint).toBe("parser-crash-1");
    expect(failure.data.result).toBe("unresolved");
  });

  it("records test failures with error category test", async () => {
    const { memory } = makeMemory();
    await memory.load();
    await memory.history.recordTestFailure({
      title: "ranking tests red",
      task: "Fix ranking tests",
      fingerprint: fingerprint(),
      affectedSubsystem: "packages/memory",
      attemptedSolution: "reorder comparator",
      failures: ["expected 3 got 2"],
    });
    const failure = (await memory.failures.list())[0]!;
    expect(failure.data.errorCategory).toBe("test");
  });

  it("records build failures with error category build", async () => {
    const { memory } = makeMemory();
    await memory.load();
    await memory.history.recordBuildFailure({
      title: "tsc broke",
      task: "Fix types",
      fingerprint: fingerprint(),
      affectedSubsystem: "packages/memory",
      attemptedSolution: "narrow union",
    });
    const failure = (await memory.failures.list())[0]!;
    expect(failure.data.errorCategory).toBe("build");
  });

  it("records successful implementations with an implementation tag", async () => {
    const { memory } = makeMemory();
    await memory.load();
    await memory.history.recordSuccessfulImplementation({
      title: "Implemented memory",
      task: "Build the memory package",
      affectedFiles: ["packages/memory/src/index.ts"],
    });
    const task = (await memory.tasks.list())[0]!;
    expect(task.tags).toContain("implementation");
    expect(task.data.outcome).toBe("success");
  });

  it("records repository discoveries in a retrievable way", async () => {
    const { memory } = makeMemory();
    await memory.load();
    await memory.history.recordRepositoryDiscovery({
      title: "Found workspace layout",
      task: "Map packages",
      discovery: "memory is dependency-free infrastructure",
    });
    const task = (await memory.tasks.list())[0]!;
    expect(task.tags).toContain("repository-discovery");
    expect(task.data.repairs).toEqual([
      "memory is dependency-free infrastructure",
    ]);
  });

  it("is deterministic: repeating an event deduplicates into one record", async () => {
    const { memory } = makeMemory();
    await memory.load();
    const event = {
      title: "Repair X",
      task: "Fix X",
      affectedFiles: ["src/x.ts"],
      repairs: ["fix"],
    };
    await memory.history.recordSuccessfulRepair(event);
    await memory.history.recordSuccessfulRepair(event);
    expect(await memory.tasks.count()).toBe(1);
  });

  it("rejects discoveries without content", async () => {
    const { memory } = makeMemory();
    await memory.load();
    await expect(
      memory.history.recordRepositoryDiscovery({
        title: "empty",
        task: "map",
        discovery: "",
      }),
    ).rejects.toThrow(InvalidRecordError);
  });

  it("never executes anything: only memory changes", async () => {
    const { memory } = makeMemory();
    await memory.load();
    await memory.history.recordSuccessfulRepair({
      title: "t",
      task: "do nothing",
      repairs: [],
    });
    expect(await memory.tasks.count()).toBe(1);
    expect(await memory.failures.count()).toBe(0);
    expect(await memory.architecture.count()).toBe(0);
    expect(await memory.sessions.count()).toBe(0);
  });

  it("stores enough structured detail without full transcripts", async () => {
    const { memory } = makeMemory();
    await memory.load();
    await memory.history.recordFailedRepair({
      title: "memory leak",
      task: "Fix leak",
      fingerprint: failureFingerprint("memory", "heap"),
      errorCategory: "runtime",
      affectedSubsystem: "core",
      attemptedSolution: "pool buffers",
      failures: ["heap grows 2x over night"],
    });
    const failure = (await memory.failures.findByFingerprint(
      failureFingerprint("memory", "heap"),
    ))[0]!;
    expect(failure.data.fingerprint).toBe(failureFingerprint("memory", "heap"));
    expect(failure.data.attemptedSolution).toBe("pool buffers");
  });
});

let fpCounter = 0;
function fingerprint(): string {
  fpCounter += 1;
  return `fp-${fpCounter}`;
}