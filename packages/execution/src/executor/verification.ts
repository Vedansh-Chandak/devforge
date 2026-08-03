/**
 * @devforge/execution — Verification pipeline (DF-016A).
 *
 * Verification runs an ordered list of targets (typecheck, build, test, lint)
 * exclusively through the CommandRunner — the executor itself never spawns a
 * process. Targets run sequentially and the pipeline stops at the first
 * failure, matching the deterministic "fail fast" contract.
 */

import type { CommandRunner } from '../command/types.js';
import type {
  VerificationOutcome,
  VerificationResult,
  VerificationTarget,
} from './types.js';

/** Options accepted by {@link runVerification}. */
export interface RunVerificationOptions {
  /** Default working directory for targets without an explicit cwd. */
  readonly cwd: string;
  readonly abortSignal?: AbortSignal;
  /** Time source for deterministic durations. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/**
 * Run each target in order, stopping at the first failure or cancellation.
 * The CommandRunner returns cancelled results rather than throwing, so this
 * pipeline is resilient and always resolves with a {@link VerificationResult}.
 */
export async function runVerification(
  runner: CommandRunner,
  targets: readonly VerificationTarget[],
  options: RunVerificationOptions,
): Promise<VerificationResult> {
  const now = options.now ?? (() => Date.now());
  const started = now();
  const outcomes: VerificationOutcome[] = [];
  let cancelled = false;

  for (const target of targets) {
    const targetStart = now();
    const result = await runner.run({
      command: target.command,
      args: target.args,
      cwd: target.cwd ?? options.cwd,
      timeoutMs: target.timeoutMs,
      maxOutputBytes: target.maxOutputBytes,
      allowFailure: true,
      abortSignal: options.abortSignal,
    });
    const durationMs = now() - targetStart;
    const outcome: VerificationOutcome = {
      targetId: target.id,
      success: result.success,
      exitCode: result.exitCode,
      durationMs,
      output: [result.stdout, result.stderr]
        .filter((part) => part.length > 0)
        .join('\n'),
      timedOut: result.timedOut,
      cancelled: result.cancelled,
    };
    outcomes.push(outcome);

    if (result.cancelled) {
      cancelled = true;
      break;
    }
    if (!result.success) {
      break;
    }
  }

  const ok = outcomes.every((outcome) => outcome.success);
  const failed = outcomes.find((outcome) => !outcome.success);
  return {
    ok,
    targets: outcomes,
    failedTargetId: failed?.targetId,
    durationMs: now() - started,
    cancelled,
  };
}

/** Build a single-target typecheck verification config (default behavior). */
export function typecheckTarget(cwd: string): VerificationTarget {
  return { id: 'typecheck', command: 'tsc', args: ['--noEmit'], cwd };
}

/** Derive a default set of verification targets for a workspace root. */
export function defaultVerificationTargets(
  root: string,
): readonly VerificationTarget[] {
  return [typecheckTarget(root)];
}
