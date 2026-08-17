/**
 * @devforge/autonomous — Error hierarchy for the autonomous agent (DF-019).
 */

export const AUTONOMOUS_ERROR_CODES = {
  INVALID_CONFIG: 'INVALID_CONFIG',
  CANCELLED: 'CANCELLED',
  TIMEOUT: 'TIMEOUT',
  CONFIDENCE_BELOW_THRESHOLD: 'CONFIDENCE_BELOW_THRESHOLD',
  DUPLICATE_PATCH: 'DUPLICATE_PATCH',
  MAX_ATTEMPTS: 'MAX_ATTEMPTS',
  ROLLBACK_FAILED: 'ROLLBACK_FAILED',
  PATCH_GENERATION_FAILED: 'PATCH_GENERATION_FAILED',
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  TERMINATED: 'TERMINATED',
  PLANNING_FAILED: 'PLANNING_FAILED',
} as const;

export type AutonomousErrorCode =
  (typeof AUTONOMOUS_ERROR_CODES)[keyof typeof AUTONOMOUS_ERROR_CODES];

export interface AutonomousErrorOptions {
  readonly code?: AutonomousErrorCode;
  readonly cause?: unknown;
  readonly attempt?: number;
}

/** Base class for all autonomous-agent errors. */
export class AutonomousError extends Error {
  readonly code: AutonomousErrorCode;
  readonly cause?: unknown;
  readonly attempt?: number;

  constructor(message: string, options: AutonomousErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.code = options.code ?? 'TERMINATED';
    this.cause = options.cause;
    this.attempt = options.attempt;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Raised when the agent configuration is invalid. */
export class AutonomousValidationError extends AutonomousError {
  constructor(message: string, options: AutonomousErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'INVALID_CONFIG' });
  }
}

/** Raised when the run is cancelled by the caller. */
export class AutonomousCancellationError extends AutonomousError {
  constructor(message: string, options: AutonomousErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'CANCELLED' });
  }
}

/** Raised when the run exceeds its wall-clock budget. */
export class AutonomousTimeoutError extends AutonomousError {
  constructor(message: string, options: AutonomousErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'TIMEOUT' });
  }
}

/** Raised when the confidence engine refuses to proceed. */
export class AutonomousConfidenceError extends AutonomousError {
  readonly threshold: number;
  readonly score: number;

  constructor(threshold: number, score: number, options: AutonomousErrorOptions = {}) {
    super(
      `Confidence ${score} is below threshold ${threshold}`,
      { ...options, code: options.code ?? 'CONFIDENCE_BELOW_THRESHOLD' },
    );
    this.threshold = threshold;
    this.score = score;
  }
}

/** Raised when a generated patch set duplicates an earlier attempt. */
export class AutonomousDuplicateError extends AutonomousError {
  readonly fingerprint: string;

  constructor(fingerprint: string, options: AutonomousErrorOptions = {}) {
    super(`Duplicate patch set detected: ${fingerprint}`, {
      ...options,
      code: options.code ?? 'DUPLICATE_PATCH',
    });
    this.fingerprint = fingerprint;
  }
}

/** Raised when the attempt budget is exhausted. */
export class AutonomousMaxAttemptsError extends AutonomousError {
  readonly limit: number;

  constructor(limit: number, options: AutonomousErrorOptions = {}) {
    super(`Maximum attempts (${limit}) reached`, {
      ...options,
      code: options.code ?? 'MAX_ATTEMPTS',
    });
    this.limit = limit;
  }
}

/** Raised when a workspace rollback fails. */
export class AutonomousRollbackError extends AutonomousError {
  constructor(message: string, options: AutonomousErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'ROLLBACK_FAILED' });
  }
}

/** Raised when patch generation fails (already a type in @devforge/execution). */
export class AutonomousPatchError extends AutonomousError {
  constructor(message: string, options: AutonomousErrorOptions = {}) {
    super(message, {
      ...options,
      code: options.code ?? 'PATCH_GENERATION_FAILED',
    });
  }
}

/** Raised when planning fails. */
export class AutonomousPlanningError extends AutonomousError {
  constructor(message: string, options: AutonomousErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'PLANNING_FAILED' });
  }
}