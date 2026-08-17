/**
 * @devforge/multi-agent — Error hierarchy (DF-022).
 *
 * All multi-agent failures derive from {@link MultiAgentError} and carry a
 * stable machine-readable code. Codes mirror the categories the coordinator
 * must distinguish: validation, graph, scheduling, execution, merge,
 * verification, cancellation and timeout.
 */

/** Stable error codes produced by the multi-agent subsystem. */
export type MultiAgentErrorCode =
  | 'MA_DECOMPOSITION'
  | 'MA_VALIDATION'
  | 'MA_GRAPH_CYCLE'
  | 'MA_GRAPH_DUPLICATE'
  | 'MA_GRAPH_MISSING_DEPENDENCY'
  | 'MA_SCHEDULING'
  | 'MA_AGENT_EXECUTION'
  | 'MA_ROLE_UNAVAILABLE'
  | 'MA_MERGE_CONFLICT'
  | 'MA_MERGE_VIOLATION'
  | 'MA_VERIFICATION'
  | 'MA_CANCELLED'
  | 'MA_TIMEOUT'
  | 'MA_CONFIRMATION_REJECTED'
  | 'MA_INTERNAL';

/** All valid error codes. */
export const MULTI_AGENT_ERROR_CODES: readonly MultiAgentErrorCode[] = [
  'MA_DECOMPOSITION',
  'MA_VALIDATION',
  'MA_GRAPH_CYCLE',
  'MA_GRAPH_DUPLICATE',
  'MA_GRAPH_MISSING_DEPENDENCY',
  'MA_SCHEDULING',
  'MA_AGENT_EXECUTION',
  'MA_ROLE_UNAVAILABLE',
  'MA_MERGE_CONFLICT',
  'MA_MERGE_VIOLATION',
  'MA_VERIFICATION',
  'MA_CANCELLED',
  'MA_TIMEOUT',
  'MA_CONFIRMATION_REJECTED',
  'MA_INTERNAL',
];

/** Base class for every multi-agent error. */
export class MultiAgentError extends Error {
  readonly code: MultiAgentErrorCode;

  constructor(code: MultiAgentErrorCode, message: string) {
    super(message);
    this.name = 'MultiAgentError';
    this.code = code;
  }
}

/** Raised when request decomposition fails. */
export class MultiAgentDecompositionError extends MultiAgentError {
  constructor(message: string) {
    super('MA_DECOMPOSITION', message);
    this.name = 'MultiAgentDecompositionError';
  }
}

/** Raised when inputs fail structural validation. */
export class MultiAgentValidationError extends MultiAgentError {
  constructor(message: string) {
    super('MA_VALIDATION', message);
    this.name = 'MultiAgentValidationError';
  }
}

/** Raised when the task graph contains a dependency cycle. */
export class MultiAgentCycleError extends MultiAgentError {
  constructor(message: string) {
    super('MA_GRAPH_CYCLE', message);
    this.name = 'MultiAgentCycleError';
  }
}

/** Raised when two tasks share the same id. */
export class MultiAgentDuplicateError extends MultiAgentError {
  constructor(message: string) {
    super('MA_GRAPH_DUPLICATE', message);
    this.name = 'MultiAgentDuplicateError';
  }
}

/** Raised when a task depends on a task that does not exist. */
export class MultiAgentMissingDependencyError extends MultiAgentError {
  constructor(message: string) {
    super('MA_GRAPH_MISSING_DEPENDENCY', message);
    this.name = 'MultiAgentMissingDependencyError';
  }
}

/** Raised when scheduling cannot proceed. */
export class MultiAgentSchedulingError extends MultiAgentError {
  constructor(message: string) {
    super('MA_SCHEDULING', message);
    this.name = 'MultiAgentSchedulingError';
  }
}

/** Raised when a role agent fails in a non-retryable way. */
export class MultiAgentExecutionError extends MultiAgentError {
  constructor(message: string) {
    super('MA_AGENT_EXECUTION', message);
    this.name = 'MultiAgentExecutionError';
  }
}

/** Raised when a requested role has no registered agent in the pool. */
export class MultiAgentRoleUnavailableError extends MultiAgentError {
  constructor(message: string) {
    super('MA_ROLE_UNAVAILABLE', message);
    this.name = 'MultiAgentRoleUnavailableError';
  }
}

/** Raised when a merge leaves an unresolved conflict. */
export class MultiAgentMergeConflictError extends MultiAgentError {
  constructor(message: string) {
    super('MA_MERGE_CONFLICT', message);
    this.name = 'MultiAgentMergeConflictError';
  }
}

/** Raised when a merge rule is violated (overlapping edits, dup writes). */
export class MultiAgentMergeViolationError extends MultiAgentError {
  constructor(message: string) {
    super('MA_MERGE_VIOLATION', message);
    this.name = 'MultiAgentMergeViolationError';
  }
}

/** Raised when verification fails after exhausting repair rounds. */
export class MultiAgentVerificationError extends MultiAgentError {
  constructor(message: string) {
    super('MA_VERIFICATION', message);
    this.name = 'MultiAgentVerificationError';
  }
}

/** Raised when a run is cancelled. */
export class MultiAgentCancellationError extends MultiAgentError {
  constructor(message: string) {
    super('MA_CANCELLED', message);
    this.name = 'MultiAgentCancellationError';
  }
}

/** Raised when a run exceeds its global or per-task deadline. */
export class MultiAgentTimeoutError extends MultiAgentError {
  constructor(message: string) {
    super('MA_TIMEOUT', message);
    this.name = 'MultiAgentTimeoutError';
  }
}

/** Raised when a required confirmation is rejected. */
export class MultiAgentConfirmationError extends MultiAgentError {
  constructor(message: string) {
    super('MA_CONFIRMATION_REJECTED', message);
    this.name = 'MultiAgentConfirmationError';
  }
}

/** Generic internal error. */
export class MultiAgentInternalError extends MultiAgentError {
  constructor(message: string) {
    super('MA_INTERNAL', message);
    this.name = 'MultiAgentInternalError';
  }
}

/** Convenience predicate to narrow thrown values to multi-agent errors. */
export function isMultiAgentError(error: unknown): error is MultiAgentError {
  return error instanceof MultiAgentError;
}
