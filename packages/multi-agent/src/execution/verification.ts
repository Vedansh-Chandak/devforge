/**
 * @devforge/multi-agent — Verification adapter (DF-022).
 *
 * Reuses the existing executor verification (`runVerification`) from
 * @devforge/execution — no new verification engine. This module only adapts
 * its output to the multi-agent {@link VerificationSummary} shape and wires
 * the conversation messages.
 */

import {
  runVerification,
  type CommandRunner,
  type VerificationResult,
  type VerificationTarget,
} from '@devforge/execution';
import type { VerificationSummary } from '../types.js';
import {
  verificationStarted,
  verificationPassed,
  verificationFailed,
} from '../message.js';
import type { AgentContext } from '../context.js';

/** Contract for a verification provider. */
export interface Verifier {
  verify(context: AgentContext, options?: VerifyOptions): Promise<VerificationSummary>;
}

/** Per-run verification options. */
export interface VerifyOptions {
  readonly cwd?: string;
  readonly signal?: AbortSignal;
  readonly targets?: readonly VerificationTarget[];
  readonly attempts?: number;
}

/** Adapt the executor's result to a multi-agent summary. */
export function toSummary(result: VerificationResult): VerificationSummary {
  return {
    ok: result.ok,
    targets: result.targets.map((t) => t.targetId),
    failedTargetId: result.failedTargetId ?? null,
    durationMs: result.durationMs,
    attempts: 1,
    cancelled: result.cancelled,
  };
}

/**
 * Verifier that delegates to the reused executor verification pipeline. The
 * command runner and targets are injected so tests never touch the network.
 */
export class ExecutorVerifier implements Verifier {
  readonly runner: CommandRunner;
  readonly targets: readonly VerificationTarget[];
  private readonly now: () => number;

  constructor(runner: CommandRunner, targets: readonly VerificationTarget[], now?: () => number) {
    this.runner = runner;
    this.targets = targets;
    this.now = now ?? (() => Date.now());
  }

  async verify(context: AgentContext, options: VerifyOptions = {}): Promise<VerificationSummary> {
    const cwd = options.cwd ?? context.workspaceRoot;
    const targets = options.targets ?? this.targets;
    context.conversation.post(
      verificationStarted({
        at: this.now(),
        targets: targets.map((t) => t.id),
      }),
    );
    const result = await runVerification(this.runner, targets, {
      cwd,
      abortSignal: options.signal ?? context.signal,
      now: this.now,
    });
    const summary = { ...toSummary(result), attempts: options.attempts ?? 1 };

    if (summary.ok) {
      context.conversation.post(
        verificationPassed({ at: this.now(), durationMs: summary.durationMs }),
      );
    } else {
      context.conversation.post(
        verificationFailed({
          at: this.now(),
          failedTargetId: summary.failedTargetId,
          durationMs: summary.durationMs,
        }),
      );
    }
    return summary;
  }
}

/** Deterministic verifier that resolves a fixed outcome (for tests). */
export function fixedVerifier(ok: boolean, failedTargetId: string | null = null): Verifier {
  return {
    async verify(context: AgentContext, options: VerifyOptions = {}) {
      const attempts = options.attempts ?? 1;
      const durationMs = 0;
      if (ok) {
        context.conversation.post(verificationPassed({ at: 0, durationMs }));
      } else {
        context.conversation.post(
          verificationFailed({ at: 0, failedTargetId, durationMs }),
        );
      }
      return {
        ok,
        targets: [],
        failedTargetId,
        durationMs,
        attempts,
        cancelled: false,
      };
    },
  };
}
