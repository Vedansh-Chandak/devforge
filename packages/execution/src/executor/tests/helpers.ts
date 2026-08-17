import type { ExecutionPlan, PlanStep } from '@devforge/planner';
import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from '../../command/types.js';

/** Build a minimal plan step with defaults overridable per test. */
export function makeStep(
  id: string,
  overrides: Partial<PlanStep> = {},
): PlanStep {
  return {
    id,
    title: `Step ${id}`,
    description: `Description for ${id}`,
    type: 'SEARCH',
    dependsOn: [],
    estimatedCost: 1,
    requiresConfirmation: false,
    ...overrides,
  };
}

/** Build a valid ExecutionPlan containing the given steps. */
export function makePlan(
  steps: readonly PlanStep[],
  overrides: Partial<ExecutionPlan> = {},
): ExecutionPlan {
  return {
    goal: 'Test goal',
    summary: 'Test summary',
    complexity: 'LOW',
    risk: 'LOW',
    requiresConfirmation: false,
    steps,
    assumptions: [],
    expectedOutputs: [],
    ...overrides,
  };
}

/** A default successful CommandResult. */
export function okResult(
  overrides: Partial<CommandResult> = {},
): CommandResult {
  return {
    success: true,
    stdout: '',
    stderr: '',
    exitCode: 0,
    durationMs: 0,
    timedOut: false,
    cancelled: false,
    truncated: false,
    command: 'node',
    args: [],
    ...overrides,
  };
}

/** A default failing CommandResult (exit code 1). */
export function failResult(
  overrides: Partial<CommandResult> = {},
): CommandResult {
  return okResult({ success: false, exitCode: 1, ...overrides });
}

export interface ScriptedRunner {
  readonly runner: CommandRunner;
  readonly calls: CommandRequest[];
}

/**
 * A deterministic fake CommandRunner that replays scripted results in order.
 * Each entry is either a fixed CommandResult or a function of the request.
 */
export function scriptedRunner(
  results: readonly (
    | CommandResult
    | ((request: CommandRequest) => CommandResult)
  )[] = [],
): ScriptedRunner {
  const calls: CommandRequest[] = [];
  const queue = [...results];
  const runner: CommandRunner = {
    async run(request: CommandRequest): Promise<CommandResult> {
      calls.push(request);
      const scripted = queue.shift();
      if (!scripted) {
        throw new Error(
          `Unexpected command call: ${request.command} ${request.args.join(' ')}`,
        );
      }
      return typeof scripted === 'function' ? scripted(request) : scripted;
    },
  };
  return { runner, calls };
}

/** Poll `predicate` until true or the timeout elapses. */
export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  await new Promise((resolve) => setTimeout(resolve, 0));
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('waitFor timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** A constant clock used to make durations and timestamps deterministic. */
export function fixedClock(base: number, tick = 1): () => number {
  let value = base;
  return () => {
    const current = value;
    value += tick;
    return current;
  };
}
