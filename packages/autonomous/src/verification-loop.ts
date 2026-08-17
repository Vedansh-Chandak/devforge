/**
 * @devforge/autonomous — Verification loop (DF-019).
 *
 * Runs the configured verification targets through the injected CommandRunner
 * only. Adds a deterministic overall wall-clock timeout and captures structured
 * diagnostics for the repair loop. Never spawns a process itself.
 */

import { captureDiagnostics, runVerification, type CommandRunner, type Diagnostics, type VerificationResult, type VerificationTarget } from '@devforge/execution';
import type { VerificationSnapshot } from './types.js';

/** Overall abort marker used to distinguish timeouts from user cancellation. */
export const TIMEOUT_ABORT_REASON = 'autonomous:timeout';

/** Configuration for a verification loop. */
export interface VerificationLoopConfig {
  readonly runner: CommandRunner;
  readonly cwd: string;
  readonly targets: readonly VerificationTarget[];
  /** Overall hard deadline for a single verification run (ms). */
  readonly totalTimeoutMs?: number;
  readonly now?: () => number;
}

/** Result of one verification run as observed by the agent. */
export interface VerificationRun {
  readonly ok: boolean;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly attempt: number;
  readonly snapshot: VerificationSnapshot;
  readonly diagnostics: ReturnType<typeof captureDiagnostics>;
}

/** Result synthesized when the overall timeout fires mid-flight. */
function timedOutResult(attempt: number, startedAt: number): VerificationRun {
  const result: VerificationResult = {
    ok: false,
    targets: [],
    durationMs: 0,
    cancelled: true,
  };
  return {
    ok: false,
    timedOut: true,
    cancelled: true,
    attempt,
    snapshot: {
      attempt,
      ok: false,
      timedOut: true,
      cancelled: true,
      result,
      startedAt,
      durationMs: 0,
    },
    diagnostics: {
      source: 'verification',
      diagnostics: [],
      stderr: [],
      verificationDurationMs: 0,
      summary: `Verification timed out before any target completed (attempt ${attempt})`,
    },
  };
}

/** Sequential verification runner with timeout supervision. */
export class VerificationLoop {
  private readonly runner: CommandRunner;
  private readonly cwd: string;
  private readonly targets: readonly VerificationTarget[];
  private readonly totalTimeoutMs: number | undefined;
  private readonly now: () => number;
  private readonly runs: VerificationRun[] = [];
  private sequence = 0;

  constructor(config: VerificationLoopConfig) {
    this.runner = config.runner;
    this.cwd = config.cwd;
    this.targets = config.targets;
    this.totalTimeoutMs = config.totalTimeoutMs;
    this.now = config.now ?? (() => Date.now());
  }

  /** Runs performed so far (per run, oldest first). */
  get snapshot(): readonly VerificationRun[] {
    return [...this.runs];
  }

  get count(): number {
    return this.runs.length;
  }

  /** Whether this loop has ever observed a successful verification. */
  get hasPassed(): boolean {
    return this.runs.some((run) => run.ok);
  }

  /** Run the configured targets once. Always resolves with a run. */
  async run(signal?: AbortSignal): Promise<VerificationRun> {
    this.sequence += 1;
    const attempt = this.sequence;
    const startedAt = this.now();

    const controller = new AbortController();
    const forwardAbort = (): void => {
      if (!controller.signal.aborted) controller.abort(signal?.reason ?? 'aborted');
    };
    if (signal?.aborted) {
      forwardAbort();
    } else {
      signal?.addEventListener('abort', forwardAbort, { once: true });
    }

    let timeoutSettled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (this.totalTimeoutMs !== undefined) {
      timer = setTimeout(() => {
        timeoutSettled = true;
        if (!controller.signal.aborted) controller.abort(TIMEOUT_ABORT_REASON);
      }, this.totalTimeoutMs);
    }

    let run: VerificationRun;
    try {
      const result = await runVerification(this.runner, this.targets, {
        cwd: this.cwd,
        abortSignal: controller.signal,
        now: this.now,
      });
      const timedOut = timeoutSettled && result.cancelled;
      const cancelled = result.cancelled;
      const ok = result.ok && !cancelled;
      run = {
        ok,
        timedOut,
        cancelled,
        attempt,
        snapshot: {
          attempt,
          ok,
          timedOut,
          cancelled,
          result,
          startedAt,
          durationMs: result.durationMs,
        },
        diagnostics: captureDiagnostics(result),
      };
    } catch (error) {
      run = {
        ok: false,
        timedOut: timeoutSettled,
        cancelled: controller.signal.aborted,
        attempt,
        snapshot: {
          attempt,
          ok: false,
          timedOut: timeoutSettled,
          cancelled: controller.signal.aborted,
          result: {
            ok: false,
            targets: [],
            durationMs: this.now() - startedAt,
            cancelled: controller.signal.aborted,
          },
          startedAt,
          durationMs: this.now() - startedAt,
        },
        diagnostics: {
          source: 'verification',
          diagnostics: [],
          stderr: [`Verification loop error: ${String(error instanceof Error ? error.message : error)}`],
          verificationDurationMs: this.now() - startedAt,
          summary: `Verification loop raised: ${String(error)}`,
        },
      };
    }

    if (timer !== null) clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);

    this.runs.push(run);
    return run;
  }
}