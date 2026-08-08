/**
 * @devforge/autonomous — Termination controller (DF-019).
 *
 * Decides, before each iteration, whether the run must stop. Stop reasons:
 * success, cancellation, external repository change, timeout, maximum
 * attempts, repeated identical patches, or confidence below threshold.
 * Evaluation order is fixed so results are deterministic.
 */

import type { TerminationReason } from './types.js';

/** Complete state inspected by the controller. */
export interface TerminationState {
  /** 1-based current attempt being evaluated (1 = first). */
  readonly attempt: number;
  readonly startedAt: number;
  readonly now: number;
  readonly maxAttempts: number;
  readonly timeoutMs: number;
  readonly confidenceThreshold: number;
  /** Fingerprint of the most recently generated patch set. */
  readonly lastFingerprint?: string;
  /** Window size over which identical fingerprints terminate (default 2). */
  readonly duplicateWindow: number;
  readonly confidence?: number;
  readonly cancelled: boolean;
  readonly verificationPassed: boolean;
  readonly repositoryChangedExternally: boolean;
  /** Fingerprint collision count so far this run. */
  readonly fingerprintCount: number;
}

/** All usable keys of the state (used to derive defaults for partial states). */
const STATE_KEYS = [
  'attempt',
  'startedAt',
  'now',
  'maxAttempts',
  'timeoutMs',
  'confidenceThreshold',
  'lastFingerprint',
  'duplicateWindow',
  'confidence',
  'cancelled',
  'verificationPassed',
  'repositoryChangedExternally',
  'fingerprintCount',
] as const;

/** A stop decision. `stop` true means the loop must halt. */
export interface TerminationDecision {
  readonly stop: boolean;
  /** Relevant only when `stop` is true. 'CONTINUE' signals no stop. */
  readonly reason: TerminationReason | 'CONTINUE';
  readonly message: string;
}

/** Static rules handed to the controller. */
export interface TerminationRules {
  readonly maxAttempts: number;
  readonly timeoutMs: number;
  readonly confidenceThreshold: number;
  readonly duplicateWindow?: number;
}

/** Default state when a field is not supplied. */
function emptyState(): TerminationState {
  return {
    attempt: 1,
    startedAt: 0,
    now: 0,
    maxAttempts: 1,
    timeoutMs: 0,
    confidenceThreshold: 0.7,
    duplicateWindow: 2,
    cancelled: false,
    verificationPassed: false,
    repositoryChangedExternally: false,
    fingerprintCount: 0,
  };
}

/** Deterministic stop-condition evaluator. */
export class TerminationController {
  private readonly rules: Required<TerminationRules>;

  constructor(rules: Partial<TerminationRules> = {}) {
    this.rules = {
      maxAttempts: rules.maxAttempts ?? 1,
      timeoutMs: rules.timeoutMs ?? 0,
      confidenceThreshold: rules.confidenceThreshold ?? 0.7,
      duplicateWindow: rules.duplicateWindow ?? 2,
    };
  }

  get maxAttempts(): number {
    return this.rules.maxAttempts;
  }

  get confidenceThreshold(): number {
    return this.rules.confidenceThreshold;
  }

  evaluate(input: Partial<TerminationState> = {}): TerminationDecision {
    const state: TerminationState = { ...emptyState(), ...this.rules, ...input };

    if (state.verificationPassed) {
      return { stop: true, reason: 'VERIFICATION_PASSED', message: 'verification passed' };
    }

    if (state.cancelled) {
      return { stop: true, reason: 'USER_CANCELLED', message: 'user cancelled the run' };
    }

    if (state.repositoryChangedExternally) {
      return {
        stop: true,
        reason: 'REPOSITORY_CHANGED_EXTERNALLY',
        message: 'the repository changed externally',
      };
    }

    if (
      state.timeoutMs > 0 &&
      state.now - state.startedAt >= state.timeoutMs
    ) {
      return {
        stop: true,
        reason: 'TIMEOUT',
        message: `wall-clock budget of ${state.timeoutMs}ms exceeded`,
      };
    }

    if (state.attempt > state.maxAttempts) {
      return {
        stop: true,
        reason: 'MAX_ATTEMPTS_REACHED',
        message: `attempt ${state.attempt} exceeds max ${state.maxAttempts}`,
      };
    }

    if (state.fingerprintCount >= state.duplicateWindow) {
      return {
        stop: true,
        reason: 'DUPLICATE_PATCH',
        message: `fingerprint repeated ${state.fingerprintCount} times`,
      };
    }

    if (
      state.confidence !== undefined &&
      state.confidence < state.confidenceThreshold
    ) {
      return {
        stop: true,
        reason: 'CONFIDENCE_BELOW_THRESHOLD',
        message: `confidence ${state.confidence} below ${state.confidenceThreshold}`,
      };
    }

    return { stop: false, reason: 'CONTINUE', message: 'continue' };
  }

  /** Convenience: does a candidate attempt still fit inside the budget? */
  attemptAllowed(attempt: number): boolean {
    return attempt <= this.rules.maxAttempts;
  }
}