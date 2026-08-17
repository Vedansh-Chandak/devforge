/**
 * @devforge/benchmark — Verification output collection (DF-024).
 *
 * Turns a finished task fixture into raw evidence for graders: command
 * results, parsed test summaries, present files, and the agent's patch.
 * Every read is deterministic for identical fixture state.
 */
import type {
  BenchmarkTask,
  CommandResult,
  TestSummary,
  VerificationOutputs,
} from "./types.js";
import type { RepositoryFixture } from "./repository-fixture.js";
import type { Deadline } from "./execution.js";
import { TimeoutError } from "./errors.js";
import { uniquePreserveSorted } from "./patch.js";

export interface CollectOutputsContext {
  readonly deadline: Deadline;
}

/** Parse test output lines `PASS name` / `FAIL name` deterministically. */
export function parseTestOutput(
  stdout: string,
  stderr: string,
): TestSummary | null {
  const byName: Record<string, boolean> = {};
  const order: string[] = [];
  const lines = `${stdout}\n${stderr}`.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const match = /^(PASS|FAIL|OK|ERROR)\s+(.+)$/i.exec(line);
    if (!match) continue;
    const kind = match[1]!.toUpperCase();
    const name = match[2]!.trim();
    if (name.length === 0) continue;
    const passed = kind === "PASS" || kind === "OK";
    if (!(name in byName)) order.push(name);
    byName[name] = passed;
  }
  if (order.length === 0) return null;
  const passed = order.filter((name) => byName[name]);
  const failed = order.filter((name) => !byName[name]);
  return {
    total: order.length,
    passed: passed.length,
    failed: failed.length,
    byName,
    failureNames: failed,
  };
}

function collectCommandOutput(
  verification: BenchmarkTask["verification"],
  fixture: RepositoryFixture,
  results: Record<string, CommandResult>,
  deadline: Deadline,
): Promise<void> {
  const commands: string[] = [];
  const walk = (node: BenchmarkTask["verification"]): void => {
    if (node.kind === "build") {
      commands.push(node.command);
    } else if (node.kind === "command") {
      commands.push(node.command);
    } else if (node.kind === "tests") {
      // Tests run via the fixture; the output parser derives the summary
      // below from any 'run-tests' command. When a tests verification is
      // present we always run the canonical test command.
      commands.push("run-tests");
    } else if (node.kind === "composite") {
      for (const branch of node.all ?? []) walk(branch);
      for (const branch of node.any ?? []) walk(branch);
    }
  };
  walk(verification);

  return (async () => {
    for (const command of uniquePreserveSorted(commands)) {
      if (results[command] !== undefined) continue;
      if (deadline.expired()) {
        throw new TimeoutError(`deadline exceeded collecting '${command}'`);
      }
      const result = await fixture.run(command);
      results[command] = result;
    }
  })();
}

/** Collect every observable from a finished fixture. */
export async function collectVerificationOutputs(
  task: BenchmarkTask,
  fixture: RepositoryFixture,
  patch: VerificationOutputs["patch"],
  context: CollectOutputsContext,
): Promise<VerificationOutputs> {
  const commandResults: Record<string, CommandResult> = {};
  await collectCommandOutput(task.verification, fixture, commandResults, context.deadline);

  const testSummary = parseTestOutput(
    commandResults["run-tests"]?.stdout ?? "",
    commandResults["run-tests"]?.stderr ?? "",
  );

  const buildCommand = findBuildCommand(task.verification);
  const buildStatus =
    buildCommand === null
      ? null
      : (commandResults[buildCommand]?.exitCode ?? null) === 0;

  const presentFiles = await fixture.listFiles();
  const contents: Record<string, string> = {};
  for (const filePath of presentFiles) {
    const content = await fixture.readFile(filePath);
    if (content !== null) contents[filePath] = content;
  }

  return {
    commandResults,
    testSummary,
    buildStatus,
    presentFiles: uniquePreserveSorted(presentFiles),
    contents,
    patch,
  };
}

function findBuildCommand(verification: BenchmarkTask["verification"]): string | null {
  const found: string[] = [];
  const walk = (node: BenchmarkTask["verification"]): void => {
    if (node.kind === "build") found.push(node.command);
    else if (node.kind === "composite") {
      for (const branch of node.all ?? []) walk(branch);
      for (const branch of node.any ?? []) walk(branch);
    }
  };
  walk(verification);
  return found.length === 0 ? null : uniquePreserveSorted(found)[0] ?? null;
}