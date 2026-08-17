import { describe, expect, it } from "vitest";
import { collectVerificationOutputs, parseTestOutput } from "../src/verification.js";
import { Deadline } from "../src/execution.js";
import { FakeClock } from "../src/clock.js";
import { TimeoutError } from "../src/errors.js";
import { InMemoryFileSystemIO } from "../src/file-system.js";
import {
  makeFixture,
  makeRepository,
  makeTask,
  ScriptedCommandRunner,
} from "./helpers.js";

describe("parseTestOutput", () => {
  it("parses PASS and FAIL lines", () => {
    const summary = parseTestOutput("PASS a.test.js\nFAIL b.test.js\n", "");
    expect(summary).not.toBeNull();
    expect(summary!.total).toBe(2);
    expect(summary!.passed).toBe(1);
    expect(summary!.failed).toBe(1);
    expect(summary!.byName["a.test.js"]).toBe(true);
    expect(summary!.byName["b.test.js"]).toBe(false);
    expect(summary!.failureNames).toEqual(["b.test.js"]);
  });

  it("accepts OK and ERROR tokens case-insensitively", () => {
    const summary = parseTestOutput("ok lower.js\nerror bad.js\n", "");
    expect(summary!.passed).toBe(1);
    expect(summary!.failed).toBe(1);
  });

  it("combines stdout and stderr", () => {
    const summary = parseTestOutput("PASS stdout.js\n", "FAIL stderr.js\n");
    expect(summary!.total).toBe(2);
    expect(summary!.byName["stderr.js"]).toBe(false);
  });

  it("keeps the last result per test name", () => {
    const summary = parseTestOutput("PASS dup.js\nFAIL dup.js\n", "");
    expect(summary!.byName["dup.js"]).toBe(false);
    expect(summary!.total).toBe(1);
  });

  it("returns null when nothing test-shaped is found", () => {
    expect(parseTestOutput("hello world", "")).toBeNull();
    expect(parseTestOutput("", "")).toBeNull();
  });

  it("ignores non-test lines but keeps test lines", () => {
    const summary = parseTestOutput("building…\nPASS only.js\n", "");
    expect(summary!.total).toBe(1);
    expect(summary!.byName["only.js"]).toBe(true);
  });
});

describe("collectVerificationOutputs", () => {
  it("runs the canonical test command and derives a summary", async () => {
    const io = InMemoryFileSystemIO.create();
    const runner = new ScriptedCommandRunner({
      "run-tests": { exitCode: 0, stdout: "PASS sum.test.js\nFAIL other.test.js\n" },
    });
    const repository = makeRepository("sample", { "src/a.ts": "1" });
    const fixture = await makeFixture(io, runner, makeTask("t1"), repository);
    await fixture.initialize();
    const outputs = await collectVerificationOutputs(
      makeTask("t1", { kind: "tests", mustPass: ["sum.test.js"] }),
      fixture,
      null,
      { deadline: new Deadline(0, 60_000, new FakeClock()) },
    );
    expect(outputs.testSummary).not.toBeNull();
    expect(outputs.testSummary!.byName["sum.test.js"]).toBe(true);
    expect(outputs.commandResults["run-tests"]!.exitCode).toBe(0);
  });

  it("runs build and command verifications exactly once each", async () => {
    const io = InMemoryFileSystemIO.create();
    const calls: string[] = [];
    const runner = new ScriptedCommandRunner({
      "npm run build": { exitCode: 0 },
      "npm run config-check": { exitCode: 1 },
    });
    runner.run = async (dir, command) => {
      calls.push(command);
      const scripted = { "npm run build": { exitCode: 0 }, "npm run config-check": { exitCode: 1 } }[command] ?? {};
      return {
        command,
        exitCode: scripted.exitCode ?? 0,
        stdout: scripted.stdout ?? "",
        stderr: scripted.stderr ?? "",
        durationMs: scripted.durationMs ?? 0,
      };
    };
    const fixture = await makeFixture(io, runner, makeTask("t1"), makeRepository("r"));
    await fixture.initialize();
    const outputs = await collectVerificationOutputs(
      makeTask("t1", { kind: "composite", all: [
        { kind: "build", command: "npm run build" },
        { kind: "command", command: "npm run config-check", expectExitCode: 0 },
      ] }),
      fixture,
      null,
      { deadline: new Deadline(0, 60_000, new FakeClock()) },
    );
    expect(calls).toContain("npm run build");
    expect(calls).toContain("npm run config-check");
    expect(outputs.buildStatus).toBe(true);
    expect(outputs.commandResults["npm run config-check"]!.exitCode).toBe(1);
  });

  it("lists present files recursively with contents", async () => {
    const io = InMemoryFileSystemIO.create();
    const runner = new ScriptedCommandRunner();
    const repository = makeRepository("r", {
      "src/a.ts": "a",
      "docs/guide.md": "g",
      "top.txt": "t",
    });
    const fixture = await makeFixture(io, runner, makeTask("t1"), repository);
    await fixture.initialize();
    const outputs = await collectVerificationOutputs(
      makeTask("t1", { kind: "files", expected: ["docs/guide.md"] }),
      fixture,
      null,
      { deadline: new Deadline(0, 60_000, new FakeClock()) },
    );
    expect(outputs.presentFiles).toEqual(["docs/guide.md", "src/a.ts", "top.txt"]);
    expect(outputs.contents["docs/guide.md"]).toBe("g");
  });

  it("carries provided patches into outputs", async () => {
    const io = InMemoryFileSystemIO.create();
    const fixture = await makeFixture(io, new ScriptedCommandRunner(), makeTask("t1"), makeRepository("r"));
    await fixture.initialize();
    const patch = { changes: [{ path: "src/a.ts", after: "b" }] };
    const outputs = await collectVerificationOutputs(
      makeTask("t1"),
      fixture,
      patch,
      { deadline: new Deadline(0, 60_000, new FakeClock()) },
    );
    expect(outputs.patch).toEqual(patch);
  });

  it("throws TimeoutError when the deadline expires mid-collection", async () => {
    const clock = new FakeClock(0);
    const deadline = new Deadline(0, 1, clock);
    clock.advance(10);
    const fixture = await makeFixture(
      InMemoryFileSystemIO.create(),
      new ScriptedCommandRunner(),
      makeTask("t1"),
      makeRepository("r"),
    );
    await fixture.initialize();
    await expect(
      collectVerificationOutputs(
        makeTask("t1", { kind: "tests", mustPass: ["x"] }),
        fixture,
        null,
        { deadline },
      ),
    ).rejects.toThrow(TimeoutError);
  });

  it("produces a null build status when no build verification exists", async () => {
    const fixture = await makeFixture(
      InMemoryFileSystemIO.create(),
      new ScriptedCommandRunner(),
      makeTask("t1"),
      makeRepository("r"),
    );
    await fixture.initialize();
    const outputs = await collectVerificationOutputs(
      makeTask("t1", { kind: "files", expected: ["README.md"] }),
      fixture,
      null,
      { deadline: new Deadline(0, 60_000, new FakeClock()) },
    );
    expect(outputs.buildStatus).toBeNull();
  });
});