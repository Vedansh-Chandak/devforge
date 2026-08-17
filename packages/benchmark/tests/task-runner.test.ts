import { describe, expect, it } from "vitest";
import { Cancellation, type TaskRunContext } from "../src/execution.js";
import { FakeClock } from "../src/clock.js";
import { runTask } from "../src/task-runner.js";
import {
  FixtureCore,
  InMemoryRepositoryFixtureFactory,
} from "../src/repository-fixture.js";
import { InMemoryFileSystemIO } from "../src/file-system.js";
import { mulberry32 } from "../src/environment.js";
import type {
  AgentPlanResult,
  AgentRunResult,
  AgentStepResult,
  BenchmarkAgent,
  BenchmarkTask,
  CommandResult,
  DatasetRepository,
} from "../src/types.js";
import {
  makeRepository,
  makeTask,
  passAgent,
  ScriptedCommandRunner,
  TEST_REPOSITORY,
} from "./helpers.js";
import type { CommandRunner } from "../src/repository-fixture.js";

function plan(): AgentPlanResult {
  return { summary: "s", steps: [], durationMs: 0 };
}

function step(intent: string): AgentStepResult {
  return { intent, status: "success", message: "ok", commandsRun: [], durationMs: 0 };
}

class BasicAgent implements BenchmarkAgent {
  readonly name = "basic";
  readonly version = "1.0.0";
  constructor(
    private readonly filesWritten: Readonly<Record<string, string>> = {},
  ) {}

  async plan(): Promise<AgentPlanResult> {
    return plan();
  }
  async execute(): Promise<AgentStepResult> {
    return step("execute");
  }
  async run(): Promise<AgentRunResult> {
    return {
      status: "success",
      plan: plan(),
      steps: [],
      filesWritten: this.filesWritten,
      telemetry: {},
    };
  }
}

class ThrowingAgent implements BenchmarkAgent {
  readonly name = "throwing";
  readonly version = "1.0.0";
  async plan(): Promise<AgentPlanResult> {
    return plan();
  }
  async execute(): Promise<AgentStepResult> {
    return step("execute");
  }
  async run(): Promise<AgentRunResult> {
    throw new Error("adapter exploded");
  }
}

class ClockAdvancer implements BenchmarkAgent {
  readonly name = "advancer";
  readonly version = "1.0.0";
  async plan(): Promise<AgentPlanResult> {
    return plan();
  }
  async execute(): Promise<AgentStepResult> {
    return step("execute");
  }
  async run(input: { context: TaskRunContext }): Promise<AgentRunResult> {
    input.context.clock.advance(5000);
    return {
      status: "success",
      plan: plan(),
      steps: [],
      filesWritten: {},
      telemetry: {},
    };
  }
}

class RestoreObserver implements BenchmarkAgent {
  readonly name = "restore-observer";
  readonly version = "1.0.0";
  private attempts = 0;
  sawLeftover: boolean | null = null;

  async plan(): Promise<AgentPlanResult> {
    return plan();
  }
  async execute(): Promise<AgentStepResult> {
    return step("execute");
  }
  async run(input: {
    fixture: { writeFile(p: string, c: string): Promise<void>; readFile(p: string): Promise<string | null> };
  }): Promise<AgentRunResult> {
    this.attempts += 1;
    if (this.attempts === 1) {
      await input.fixture.writeFile("leftover-extra.txt", "pollution");
      return { status: "failed", plan: plan(), steps: [], filesWritten: {}, telemetry: {} };
    }
    this.sawLeftover = (await input.fixture.readFile("leftover-extra.txt")) !== null;
    return { status: "success", plan: plan(), steps: [], filesWritten: {}, telemetry: {} };
  }
}

class PatchMismatchingAgent implements BenchmarkAgent {
  readonly name = "bad-patch";
  readonly version = "1.0.0";
  async plan(): Promise<AgentPlanResult> {
    return plan();
  }
  async execute(): Promise<AgentStepResult> {
    return step("execute");
  }
  async run(): Promise<AgentRunResult> {
    return {
      status: "success",
      plan: plan(),
      steps: [],
      filesWritten: {},
      patch: { changes: [{ path: "src/a.ts", before: "WRONG", after: "right" }] },
      telemetry: {},
    };
  }
}

function repo(): DatasetRepository {
  return makeRepository(TEST_REPOSITORY.id, {
    "src/a.ts": "original",
    "README.md": "# r",
  });
}

const testsTask = makeTask("t1", { kind: "tests", mustPass: ["sum.test.js"] });

function passingRunner(): ScriptedCommandRunner {
  return new ScriptedCommandRunner({ "run-tests": { stdout: "PASS sum.test.js\n" } });
}

/** Fails the test run while a leftover fixture file is present. */
class FixtureAwareRunner implements CommandRunner {
  readonly name = "fixture-aware";

  constructor(private readonly io: InMemoryFileSystemIO) {}

  async run(
    _dir: string,
    command: string,
  ): Promise<CommandResult> {
    const leftover = await this.io.has(_dir, "leftover-extra.txt");
    if (command === "run-tests" && leftover) {
      return { command, exitCode: 1, stdout: "FAIL leftover.test.js\n", stderr: "", durationMs: 0 };
    }
    return { command, exitCode: 0, stdout: "PASS sum.test.js\n", stderr: "", durationMs: 0 };
  }
}

async function runner(io: InMemoryFileSystemIO, commandRunner: ScriptedCommandRunner) {
  return new InMemoryRepositoryFixtureFactory({ io, commandRunner });
}

describe("runTask — happy path", () => {
  it("passes a task end-to-end with a scripted test run", async () => {
    const io = InMemoryFileSystemIO.create();
    const result = await runTask({
      task: testsTask,
      repository: repo(),
      adapter: passAgent(),
      fixtureFactory: await runner(io, passingRunner()),
      clock: new FakeClock(0),
      cancellation: new Cancellation(),
      random: mulberry32(1),
    });
    expect(result.status).toBe("passed");
    expect(result.score).toBe(1);
    expect(result.attempts).toBe(1);
    expect(result.grader.kind).toBe("tests");
  });

  it("writes agent files into the fixture and grades them", async () => {
    const io = InMemoryFileSystemIO.create();
    const task = makeTask("files", { kind: "files", expected: ["docs/notes.md"] });
    const result = await runTask({
      task,
      repository: repo(),
      adapter: new BasicAgent({ "docs/notes.md": "hello" }),
      fixtureFactory: await runner(io, new ScriptedCommandRunner()),
      clock: new FakeClock(0),
      cancellation: new Cancellation(),
      random: mulberry32(1),
    });
    expect(result.status).toBe("passed");
  });

  it("records verification failure when tests do not pass", async () => {
    const io = InMemoryFileSystemIO.create();
    const result = await runTask({
      task: testsTask,
      repository: repo(),
      adapter: new BasicAgent(),
      fixtureFactory: await runner(io, new ScriptedCommandRunner()),
      clock: new FakeClock(0),
      cancellation: new Cancellation(),
      random: mulberry32(1),
    });
    expect(result.status).toBe("verification_failed");
    expect(result.score).toBe(0);
  });

  it("scores partial test progress", async () => {
    const io = InMemoryFileSystemIO.create();
    const task = makeTask("t", { kind: "tests", mustPass: ["a.test.js", "b.test.js"] });
    const result = await runTask({
      task,
      repository: repo(),
      adapter: new BasicAgent(),
      fixtureFactory: await runner(
        io,
        new ScriptedCommandRunner({ "run-tests": { stdout: "PASS a.test.js\n" } }),
      ),
      clock: new FakeClock(0),
      cancellation: new Cancellation(),
      random: mulberry32(1),
    });
    expect(result.status).toBe("verification_failed");
    expect(result.score).toBe(0.5);
  });

  it("writes the task result back with telemetry", async () => {
    const io = InMemoryFileSystemIO.create();
    const result = await runTask({
      task: testsTask,
      repository: repo(),
      adapter: new BasicAgent(),
      fixtureFactory: await runner(io, passingRunner()),
      clock: new FakeClock(0),
      cancellation: new Cancellation(),
      random: mulberry32(1),
    });
    expect(result.taskId).toBe("t1");
    expect(result.repositoryId).toBe("sample-ts");
    expect(result.baseRevision).toBe("main");
    expect(result.category).toBe("FEATURE");
  });
});

describe("runTask — retries and isolation", () => {
  it("restores base state and retries when configured", async () => {
    const observer = new RestoreObserver();
    const io = InMemoryFileSystemIO.create();
    const result = await runTask({
      task: testsTask,
      repository: repo(),
      adapter: observer,
      fixtureFactory: await runner(io, new FixtureAwareRunner(io)),
      clock: new FakeClock(0),
      cancellation: new Cancellation(),
      random: mulberry32(1),
      retries: 2,
    });
    expect(result.status).toBe("passed");
    expect(result.attempts).toBe(2);
    expect(observer.sawLeftover).toBe(false);
  });

  it("stops at the first passing attempt", async () => {
    const io = InMemoryFileSystemIO.create();
    const result = await runTask({
      task: testsTask,
      repository: repo(),
      adapter: passAgent(),
      fixtureFactory: await runner(io, new FixtureAwareRunner(io)),
      clock: new FakeClock(0),
      cancellation: new Cancellation(),
      random: mulberry32(1),
    });
    expect(result.attempts).toBe(1);
  });

  it("cleans up the fixture after execution", async () => {
    const io = InMemoryFileSystemIO.create();
    await runTask({
      task: testsTask,
      repository: repo(),
      adapter: new BasicAgent({ "docs/notes.md": "hello" }),
      fixtureFactory: await runner(io, passingRunner()),
      clock: new FakeClock(0),
      cancellation: new Cancellation(),
      random: mulberry32(1),
    });
    expect(io.paths()).toEqual([]);
  });

  it("removes patch-removed files from the fixture", async () => {
    const io = InMemoryFileSystemIO.create();
    const removeAgent = {
      name: "remover",
      version: "1.0.0",
      async plan(): Promise<AgentPlanResult> {
        return plan();
      },
      async execute(): Promise<AgentStepResult> {
        return step("execute");
      },
      async run(): Promise<AgentRunResult> {
        return {
          status: "success",
          plan: plan(),
          steps: [],
          filesWritten: {},
          patch: { changes: [{ path: "src/a.ts", before: "original", after: undefined }] },
          telemetry: {},
        };
      },
    };
    await runTask({
      task: testsTask,
      repository: repo(),
      adapter: removeAgent,
      fixtureFactory: await runner(io, passingRunner()),
      clock: new FakeClock(0),
      cancellation: new Cancellation(),
      random: mulberry32(1),
    });
    expect(io.paths()).toEqual([]);
  });
});

describe("runTask — failure modes", () => {
  it("marks fixture creation failures as errors", async () => {
    const result = await runTask({
      task: testsTask,
      repository: repo(),
      adapter: passAgent(),
      fixtureFactory: {
        name: "failing",
        create: async () => {
          throw new Error("cannot create");
        },
      },
      clock: new FakeClock(0),
      cancellation: new Cancellation(),
      random: mulberry32(1),
    });
    expect(result.status).toBe("error");
    expect(result.errors.join(" ")).toContain("cannot create");
  });

  it("marks fixture initialization failures as errors", async () => {
    const io = InMemoryFileSystemIO.create();
    const result = await runTask({
      task: testsTask,
      repository: repo(),
      adapter: passAgent(),
      fixtureFactory: {
        name: "init-throwing",
        create: async (task: BenchmarkTask, repository: DatasetRepository) => {
          return new FixtureCore({
            io,
            commandRunner: new ScriptedCommandRunner(),
            task,
            repository,
            rootDir: "/throwing",
            afterMaterialize: async () => {
              throw new Error("setup command failed");
            },
          });
        },
      },
      clock: new FakeClock(0),
      cancellation: new Cancellation(),
      random: mulberry32(1),
    });
    expect(result.status).toBe("error");
    expect(result.grader.reason).toContain("fixture initialization failed");
  });

  it("degrades adapter crashes into errors", async () => {
    const io = InMemoryFileSystemIO.create();
    const result = await runTask({
      task: testsTask,
      repository: repo(),
      adapter: new ThrowingAgent(),
      fixtureFactory: await runner(io, new ScriptedCommandRunner()),
      clock: new FakeClock(0),
      cancellation: new Cancellation(),
      random: mulberry32(1),
    });
    expect(result.status).toBe("error");
    expect(result.errors.join(" ")).toContain("adapter exploded");
  });

  it("rejects a patch that does not apply", async () => {
    const io = InMemoryFileSystemIO.create();
    const result = await runTask({
      task: testsTask,
      repository: repo(),
      adapter: new PatchMismatchingAgent(),
      fixtureFactory: await runner(io, new ScriptedCommandRunner()),
      clock: new FakeClock(0),
      cancellation: new Cancellation(),
      random: mulberry32(1),
    });
    expect(result.status).toBe("error");
    expect(result.errors.join(" ")).toContain("does not apply");
  });

  it("times out when the adapter blows past the deadline", async () => {
    const clock = new FakeClock(0);
    const result = await runTask({
      task: makeTask("slow", testsTask.verification, { timeoutMs: 10 }),
      repository: repo(),
      adapter: new ClockAdvancer(),
      fixtureFactory: await runner(InMemoryFileSystemIO.create(), passingRunner()),
      clock,
      cancellation: new Cancellation(),
      random: mulberry32(1),
    });
    expect(result.status).toBe("timeout");
    expect(result.outcome).toBe("timeout");
  });

  it("cancels before starting when already cancelled", async () => {
    const cancellation = new Cancellation();
    cancellation.cancel();
    const io = InMemoryFileSystemIO.create();
    const result = await runTask({
      task: testsTask,
      repository: repo(),
      adapter: passAgent(),
      fixtureFactory: await runner(io, new ScriptedCommandRunner()),
      clock: new FakeClock(0),
      cancellation,
      random: mulberry32(1),
    });
    expect(result.status).toBe("cancelled");
    expect(result.attempts).toBe(1);
    expect(result.grader.reason).toContain("cancelled");
  });

  it("produces an error result when the grader never ran", async () => {
    const result = await runTask({
      task: testsTask,
      repository: repo(),
      adapter: passAgent(),
      fixtureFactory: {
        name: "boom",
        create: async () => {
          throw new Error("boom");
        },
      },
      clock: new FakeClock(0),
      cancellation: new Cancellation(),
      random: mulberry32(1),
    });
    expect(result.grader.reason).toContain("fixture creation failed");
  });
});