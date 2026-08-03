/**
 * @devforge/execution — Error classes for autonomous coding (DF-016B).
 *
 * All errors are standalone (not extending ExecutorError) to keep the
 * coding layer independent. They carry structured metadata for debugging.
 */

export const CODING_ERROR_CODES = {
  PATCH_VALIDATION: 'PATCH_VALIDATION_FAILED',
  REPAIR_BUDGET_EXCEEDED: 'REPAIR_BUDGET_EXCEEDED',
  PATCH_GENERATION: 'PATCH_GENERATION_FAILED',
  DIAGNOSTICS: 'DIAGNOSTICS_FAILED',
  REASONING: 'REASONING_FAILED',
  CODING_MODEL: 'CODING_MODEL_FAILED',
  CANCELLED: 'CODING_CANCELLED',
} as const;

export type CodingErrorCode = (typeof CODING_ERROR_CODES)[keyof typeof CODING_ERROR_CODES];

export interface CodingErrorOptions {
  readonly code?: CodingErrorCode;
  readonly cause?: unknown;
  readonly budget?: string;
  readonly attempt?: number;
  readonly patchId?: string;
  readonly file?: string;
}

/** Base class for all autonomous coding errors. */
export class CodingError extends Error {
  readonly code: CodingErrorCode;
  readonly cause?: unknown;
  readonly budget?: string;
  readonly attempt?: number;
  readonly patchId?: string;
  readonly file?: string;

  constructor(message: string, options: CodingErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.code = options.code ?? 'CODING_MODEL_FAILED';
    this.cause = options.cause;
    this.budget = options.budget;
    this.attempt = options.attempt;
    this.patchId = options.patchId;
    this.file = options.file;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Raised when patch validation fails (structural or workspace-aware). */
export class PatchValidationError extends CodingError {
  readonly violations: readonly PatchValidationErrorViolation[];

  constructor(
    message: string,
    violations: readonly PatchValidationErrorViolation[],
    options: CodingErrorOptions = {},
  ) {
    super(message, { ...options, code: options.code ?? 'PATCH_VALIDATION_FAILED' });
    this.violations = violations;
  }
}

export interface PatchValidationErrorViolation {
  readonly code: string;
  readonly message: string;
  readonly patchId?: string;
  readonly file?: string;
}

/** Raised when a repair budget is exceeded. */
export class RepairBudgetExceededError extends CodingError {
  readonly budget: string;
  readonly limit: number;
  readonly actual: number;

  constructor(
    message: string,
    budget: string,
    limit: number,
    actual: number,
    options: CodingErrorOptions = {},
  ) {
    super(message, { ...options, code: options.code ?? 'REPAIR_BUDGET_EXCEEDED', budget });
    this.budget = budget;
    this.limit = limit;
    this.actual = actual;
  }
}

/** Raised when patch generation fails (model error, budget, cancellation). */
export class PatchGenerationError extends CodingError {
  constructor(message: string, options: CodingErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'PATCH_GENERATION_FAILED' });
  }
}

/** Raised when diagnostics capture fails. */
export class DiagnosticsError extends CodingError {
  constructor(message: string, options: CodingErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'DIAGNOSTICS_FAILED' });
  }
}

/** Raised when reasoning model fails. */
export class ReasoningError extends CodingError {
  constructor(message: string, options: CodingErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'REASONING_FAILED' });
  }
}

/** Raised when coding model fails. */
export class CodingModelError extends CodingError {
  constructor(message: string, options: CodingErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'CODING_MODEL_FAILED' });
  }
}