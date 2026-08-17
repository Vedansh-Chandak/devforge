import { describe, expect, it } from "vitest";
import {
  createFailBaseline,
  createPassBaseline,
  DeterministicBaselineAgent,
  ScriptedBaselineAgent,
} from "../src/baselines.js";
import { Cancellation, Deadline, type TaskRunContext } from "../src/execution.js";
import { FakeClock } from "../src/clock.js";
import { CancelledError, TimeoutError } from "../src/errors.js";
import { makeTask } from "./helpers.js";

function context(overrides: Partial<TaskRunContext> = {}): TaskRunContext {
  return {
    task: makeTask("t1"),
    fixture: {} as never,
    clock: new FakeClock(0),
    cancellation: new Cancellation(),
    deadline: new Deadline(0, 60_000, new FakeClock(0)),
    attempt: 1,
    events: [],
    ...overrides,
  };
}

describe("ScriptedBaselineAgent — behavior resolution", () => {
  it("resolves byTask before byCategory before default", () => {
    const agent = new ScriptedBaselineAgent({
      byTask: { t1: { outcome: "pass" } },
      byCategory: { REFACTOR: { outcome: "fail" } },
      default: { outcome: "fail" },
    });
    expect(agent.behaviorFor(makeTask("t1")).outcome).toBe("pass");
    const refactor = makeTask("t2");
    refactor.category = "REFACTOR" as never;
    expect(agent.behaviorFor(refactor).outcome).toBe("fail");
  });

  it("falls back to a pass default when nothing matches", () => {
    const agent = new ScriptedBaselineAgent({});
    expect(agent.behaviorFor(makeTask("nope")).outcome).toBe("pass");
  });

  it("supports per-category resolution", () => {
    const agent = new ScriptedBaselineAgent({
      byCategory: { BUG_FIX: { outcome: "fail" } },
    });
    const task = makeTask("bug");
    task.category = "BUG_FIX" as never;
    expect(agent.behaviorFor(task).outcome).toBe("fail");
  });

  it("resolves deterministically for identical tasks", () => {
    const agent = new ScriptedBaselineAgent({ default: { outcome: "fail" } });
    expect(agent.behaviorFor(makeTask("x"))).toEqual(agent.behaviorFor(makeTask("x")));
  });
});

describe("baseline plan/execute/repair", () => {
  it("plan reports the behavior summary and steps", async () => {
    const agent = new ScriptedBaselineAgent({
      default: { planSummary: "my plan", planSteps: ["a", "b"], planDurationMs: 3 },
    });
    const plan = await agent.plan({ task: makeTask("t1"), fixture: {}, context: context(), kind: "plan" });
    expect(plan.summary).toBe("my plan");
    expect(plan.steps).toEqual(["a", "b"]);
    expect(plan.durationMs).toBe(3);
  });

  it("execute returns success with scripted commands", async () => {
    const agent = new ScriptedBaselineAgent({
      default: { commands: ["npm test"], executeDurationMs: 7 },
    });
    const step = await agent.execute({ task: makeTask("t1"), fixture: {}, context: context(), kind: "execute" });
    expect(step.status).toBe("success");
    expect(step.commandsRun).toEqual(["npm test"]);
    expect(step.durationMs).toBe(7);
  });

  it("repair resolves by kind", async () => {
    const agent = new ScriptedBaselineAgent({ default: {} });
    const repaired = await agent.repair({ task: makeTask("t1"), fixture: {}, context: context(), kind: "repair" });
    expect(repaired.status).toBe("success");
    const notRepair = await agent.repair({ task: makeTask("t1"), fixture: {}, context: context(), kind: "plan" });
    expect(notRepair.status).toBe("failed");
  });
});

describe("baseline run lifecycle", () => {
  it("succeeds on the first attempt", async () => {
    const agent = new ScriptedBaselineAgent({ default: { outcome: "pass", filesWritten: { "a.txt": "x" } } });
    const result = await agent.run({ task: makeTask("t1"), fixture: {}, context: context() });
    expect(result.status).toBe("success");
    expect(result.filesWritten).toEqual({ "a.txt": "x" });
    expect(result.steps).toHaveLength(1);
    expect(result.telemetry.attemptedRepairs).toBe(0);
  });

  it("fails when the scripted outcome is fail", async () => {
    const result = await new ScriptedBaselineAgent({ default: { outcome: "fail" } }).run({
      task: makeTask("t1"),
      fixture: {},
      context: context(),
    });
    expect(result.status).toBe("failed");
    expect(result.note).toContain("failure");
  });

  it("runs a repair loop when attemptsToSucceed > 1", async () => {
    const agent = new ScriptedBaselineAgent({
      default: { outcome: "pass", attemptsToSucceed: 3 },
    });
    const result = await agent.run({ task: makeTask("t1"), fixture: {}, context: context() });
    expect(result.steps).toHaveLength(5);
    expect(result.telemetry.attemptedRepairs).toBe(2);
    expect(result.status).toBe("success");
  });

  it("carries a patch through the run", async () => {
    const patch = { changes: [{ path: "a.ts", before: "1", after: "2" }] };
    const agent = new ScriptedBaselineAgent({ default: { outcome: "pass", patch } });
    const result = await agent.run({ task: makeTask("t1"), fixture: {}, context: context() });
    expect(result.patch).toEqual(patch);
  });

  it("reports telemetry for every attempted repair", async () => {
    const agent = new ScriptedBaselineAgent({
      default: { attemptsToSucceed: 2, telemetry: { tokenUsage: 12 } },
    });
    const result = await agent.run({ task: makeTask("t1"), fixture: {}, context: context() });
    expect(result.telemetry.attemptedRepairs).toBe(1);
    expect(result.telemetry.tokenUsage).toBe(12);
  });
});

describe("cooperative checks in baselines", () => {
  it("throws CancelledError when the run is cancelled", async () => {
    const cancellation = new Cancellation();
    cancellation.cancel();
    const agent = new ScriptedBaselineAgent({ default: {} });
    await expect(
      agent.run({ task: makeTask("t1"), fixture: {}, context: context({ cancellation }) }),
    ).rejects.toThrow(CancelledError);
  });

  it("throws TimeoutError when the deadline has expired", async () => {
    const clock = new FakeClock(0);
    const deadline = new Deadline(0, 1, clock);
    clock.advance(2);
    const agent = new ScriptedBaselineAgent({ default: {} });
    await expect(
      agent.run({ task: makeTask("t1"), fixture: {}, context: context({ deadline }) }),
    ).rejects.toThrow(TimeoutError);
  });
});

describe("DeterministicBaselineAgent and factory helpers", () => {
  it("DeterministicBaselineAgent applies behavior to every task", async () => {
    const agent = new DeterministicBaselineAgent(
      { outcome: "fail" },
      { name: "always-fail", version: "2.0.0" },
    );
    expect(agent.name).toBe("always-fail");
    expect(agent.version).toBe("2.0.0");
    const result = await agent.run({ task: makeTask("any"), fixture: {}, context: context() });
    expect(result.status).toBe("failed");
  });

  it("createPassBaseline returns a matching agent", async () => {
    const agent = createPassBaseline({ name: "pass-me" });
    expect(agent.name).toBe("pass-me");
    const result = await agent.run({ task: makeTask("t"), fixture: {}, context: context() });
    expect(result.status).toBe("success");
  });

  it("createFailBaseline returns a failing agent", async () => {
    const agent = createFailBaseline({ name: "fail-me" });
    const result = await agent.run({ task: makeTask("t"), fixture: {}, context: context() });
    expect(result.status).toBe("failed");
  });

  it("pass baseline writes provided files", async () => {
    const agent = createPassBaseline({ files: { "docs/x.md": "hi" } });
    const result = await agent.run({ task: makeTask("t"), fixture: {}, context: context() });
    expect(result.filesWritten).toEqual({ "docs/x.md": "hi" });
  });
});