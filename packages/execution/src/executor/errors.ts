/**
 * @devforge/execution — Typed errors for the Executor subsystem (DF-016A).
 *
 * Error hierarchy:
 *
 *   ExecutorError (base)
 *   ├── ExecutorValidationError   — invalid plan, missing handler/command spec
 *   ├── ExecutorSchedulingError   — empty plan, duplicate ids, missing deps, cycles
 *   ├── ExecutorExecutionError    — a step failed while executing
 *   ├── ExecutorVerificationError — verification failed
 *   └── ExecutorCancellationError — the run was cancelled
 */

/** Machine-readable error codes for the Executor subsystem. */
export const EXECUTOR_ERROR_CODES = {
  /** Plan failed validation against the planner schema. */
  INVALID_PLAN: 'INVALID_PLAN',
  /** Plan contains no steps. */
  EMPTY_PLAN: 'EMPTY_PLAN',
  /** Two or more steps share an id. */
  DUPLICATE_STEP_ID: 'DUPLICATE_STEP_ID',
  /** A step depends on a step id that does not exist. */
  MISSING_DEPENDENCY: 'MISSING_DEPENDENCY',
  /** Step dependencies form a cycle. */
  DEPENDENCY_CYCLE: 'DEPENDENCY_CYCLE',
  /** No handler is registered for a step type. */
  NO_HANDLER: 'NO_HANDLER',
  /** A COMMAND step has no command specification. */
  COMMAND_SPEC_MISSING: 'COMMAND_SPEC_MISSING',
  /** A step failed while executing. */
  STEP_EXECUTION_FAILED: 'STEP_EXECUTION_FAILED',
  /** Verification targets failed. */
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  /** The run was cancelled. */
  CANCELLED: 'CANCELLED',
  /** A state transition was attempted that the state machine forbids. */
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  /** resume() was called while nothing was paused. */
  RESUME_INVALID: 'RESUME_INVALID',
} as const;

export type ExecutorErrorCode =
  (typeof EXECUTOR_ERROR_CODES)[keyof typeof EXECUTOR_ERROR_CODES];

export interface ExecutorErrorOptions {
  readonly code?: ExecutorErrorCode;
  /** The plan id involved, when known. */
  readonly planId?: string;
  /** The step id involved, when known. */
  readonly stepId?: string;
  /** Underlying cause, if any. */
  readonly cause?: unknown;
}

/** Base class for every error thrown by the Executor subsystem. */
export class ExecutorError extends Error {
  readonly code: ExecutorErrorCode;
  readonly planId?: string;
  readonly stepId?: string;
  readonly cause?: unknown;

  constructor(message: string, options: ExecutorErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.code = options.code ?? 'INVALID_PLAN';
    this.planId = options.planId;
    this.stepId = options.stepId;
    this.cause = options.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Raised when input (the plan or its configuration) fails deterministic validation. */
export class ExecutorValidationError extends ExecutorError {
  constructor(message: string, options: ExecutorErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'INVALID_PLAN' });
  }
}

/** Raised when a plan cannot be scheduled: empty, duplicates, missing deps, or cycles. */
export class ExecutorSchedulingError extends ExecutorError {
  constructor(message: string, options: ExecutorErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'EMPTY_PLAN' });
  }
}

/** Raised when a step fails while executing. */
export class ExecutorExecutionError extends ExecutorError {
  constructor(message: string, options: ExecutorErrorOptions = {}) {
    super(message, {
      ...options,
      code: options.code ?? 'STEP_EXECUTION_FAILED',
    });
  }
}

/** Raised when a VERIFY step's targets fail. */
export class ExecutorVerificationError extends ExecutorError {
  constructor(message: string, options: ExecutorErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'VERIFICATION_FAILED' });
  }
}

/** Raised when a run is cancelled. */
export class ExecutorCancellationError extends ExecutorError {
  constructor(message: string, options: ExecutorErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'CANCELLED' });
  }
}
