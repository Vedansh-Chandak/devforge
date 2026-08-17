/**
 * @devforge/execution — Typed errors for the Workspace subsystem.
 *
 * Error hierarchy:
 *
 *   WorkspaceError (base)
 *   ├── WorkspaceValidationError   — invalid path/content/operation input
 *   ├── WorkspacePermissionError   — outside-root, traversal, symlink escape, sensitive file
 *   ├── WorkspaceConflictError     — existing/non-existing target conflicts
 *   └── WorkspaceTransactionError  — transaction lifecycle failures
 */

/**
 * Machine-readable error codes for the workspace subsystem.
 * Codes are stable so callers can branch deterministically.
 */
export const WORKSPACE_ERROR_CODES = {
  /** Path is empty, absolute, or otherwise not a workspace-relative path. */
  INVALID_PATH: 'INVALID_PATH',
  /** Path escapes the workspace root or contains `..` traversal. */
  TRAVERSAL: 'TRAVERSAL',
  /** Path escapes the workspace root via a symlink. */
  SYMLINK_ESCAPE: 'SYMLINK_ESCAPE',
  /** Content exceeds the configured maximum file size. */
  OVERSIZED: 'OVERSIZED',
  /** Content is not valid UTF-8 text. */
  INVALID_UTF8: 'INVALID_UTF8',
  /** Target does not exist when it must, or exists when it must not. */
  NOT_FOUND: 'NOT_FOUND',
  /** Target already exists. */
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  /** Multiple operations in one transaction target the same path. */
  DUPLICATE_OPERATION: 'DUPLICATE_OPERATION',
  /** Transaction commit failed and was rolled back. */
  COMMIT_FAILED: 'COMMIT_FAILED',
  /** Transaction operation was attempted after the transaction finished. */
  TRANSACTION_FINISHED: 'TRANSACTION_FINISHED',
} as const;

export type WorkspaceErrorCode =
  (typeof WORKSPACE_ERROR_CODES)[keyof typeof WORKSPACE_ERROR_CODES];

export interface WorkspaceErrorOptions {
  /** Machine-readable error code. */
  readonly code?: WorkspaceErrorCode;
  /** The workspace-relative path involved, if any. */
  readonly path?: string;
  /** Underlying cause, if any. */
  readonly cause?: unknown;
}

/**
 * Base class for every error thrown by the workspace subsystem.
 */
export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;
  readonly path?: string;
  readonly cause?: unknown;

  constructor(
    message: string,
    options: WorkspaceErrorOptions = {},
  ) {
    super(message);
    this.name = new.target.name;
    this.code = options.code ?? 'INVALID_PATH';
    this.path = options.path;
    this.cause = options.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Raised when input fails deterministic validation:
 * traversal, absolute paths, oversized content, invalid UTF-8.
 */
export class WorkspaceValidationError extends WorkspaceError {
  constructor(
    message: string,
    options: WorkspaceErrorOptions = {},
  ) {
    super(message, { ...options, code: options.code ?? 'INVALID_PATH' });
  }
}

/**
 * Raised when an operation is not permitted for the workspace boundary:
 * escapes the root, symlink escape, or sensitive-file access.
 */
export class WorkspacePermissionError extends WorkspaceError {
  constructor(
    message: string,
    options: WorkspaceErrorOptions = {},
  ) {
    super(message, { ...options, code: options.code ?? 'TRAVERSAL' });
  }
}

/**
 * Raised when the target path is in the wrong existence state:
 * file missing for read/delete/rename, or already present for create.
 */
export class WorkspaceConflictError extends WorkspaceError {
  constructor(
    message: string,
    options: WorkspaceErrorOptions = {},
  ) {
    super(message, { ...options, code: options.code ?? 'NOT_FOUND' });
  }
}

/**
 * Raised for transaction lifecycle failures, including failed commits
 * that have been automatically rolled back.
 */
export class WorkspaceTransactionError extends WorkspaceError {
  constructor(
    message: string,
    options: WorkspaceErrorOptions = {},
  ) {
    super(message, { ...options, code: options.code ?? 'TRANSACTION_FINISHED' });
  }
}
