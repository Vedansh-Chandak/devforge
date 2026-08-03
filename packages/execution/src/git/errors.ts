/**
 * @devforge/execution — Typed errors for the Git subsystem (DF-015).
 *
 * Error hierarchy:
 *
 *   GitError (base)
 *   ├── GitValidationError   — invalid path/commit-message input
 *   ├── GitRepositoryError   — invalid root, not a repository, sandbox escape
 *   ├── GitCommandError      — git failed, timed out, cancelled, or failed to spawn
 *   └── GitParseError        — git output could not be interpreted
 */

/** Machine-readable error codes for the Git subsystem. */
export const GIT_ERROR_CODES = {
  /** Repository root is empty, non-string, or not an absolute path. */
  INVALID_REPOSITORY_ROOT: 'INVALID_REPOSITORY_ROOT',
  /** Operation requires a repository but none exists. */
  NOT_A_REPOSITORY: 'NOT_A_REPOSITORY',
  /** Path is empty, non-string, or otherwise unusable. */
  INVALID_PATH: 'INVALID_PATH',
  /** Path is absolute (POSIX or Windows drive form). */
  ABSOLUTE_PATH: 'ABSOLUTE_PATH',
  /** Path contains `..` traversal. */
  TRAVERSAL: 'TRAVERSAL',
  /** Path resolves outside the repository root. */
  PATH_OUTSIDE_REPOSITORY: 'PATH_OUTSIDE_REPOSITORY',
  /** The same normalized path was supplied more than once. */
  DUPLICATE_PATH: 'DUPLICATE_PATH',
  /** Path contains a NUL byte. */
  INVALID_CHARACTER: 'INVALID_CHARACTER',
  /** Path/message contains control characters. */
  CONTROL_CHARACTER: 'CONTROL_CHARACTER',
  /** Path/message contains characters the command runner rejects. */
  SHELL_METACHARACTER: 'SHELL_METACHARACTER',
  /** Commit message is empty or whitespace-only. */
  EMPTY_COMMIT_MESSAGE: 'EMPTY_COMMIT_MESSAGE',
  /** Commit message exceeds the configured maximum length. */
  COMMIT_MESSAGE_TOO_LONG: 'COMMIT_MESSAGE_TOO_LONG',
  /** Commit message contains more lines than the configured limit. */
  MULTILINE_COMMIT_MESSAGE: 'MULTILINE_COMMIT_MESSAGE',
  /** The git process exited non-zero. */
  COMMAND_FAILED: 'COMMAND_FAILED',
  /** The git process could not be spawned. */
  SPAWN_FAILED: 'SPAWN_FAILED',
  /** The working directory escaped the workspace root. */
  EXTERNAL_CWD: 'EXTERNAL_CWD',
  /** The git process exceeded its timeout. */
  TIMEOUT: 'TIMEOUT',
  /** The git process was cancelled. */
  CANCELLED: 'CANCELLED',
  /** Git output could not be parsed into a typed structure. */
  PARSE_ERROR: 'PARSE_ERROR',
} as const;

export type GitErrorCode =
  (typeof GIT_ERROR_CODES)[keyof typeof GIT_ERROR_CODES];

export interface GitErrorOptions {
  readonly code?: GitErrorCode;
  readonly cause?: unknown;
  /** The workspace-relative path involved, when relevant. */
  readonly path?: string;
  /** Exit code of the failed git process, when known. */
  readonly exitCode?: number | null;
  readonly stdout?: string;
  readonly stderr?: string;
  /** The command that failed (always `git` for this subsystem). */
  readonly command?: string;
  readonly args?: readonly string[];
}

/** Base class for every error thrown by the Git subsystem. */
export class GitError extends Error {
  readonly code: GitErrorCode;
  readonly path?: string;
  readonly exitCode?: number | null;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly cause?: unknown;

  constructor(message: string, options: GitErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.code = options.code ?? 'COMMAND_FAILED';
    this.path = options.path;
    this.exitCode = options.exitCode;
    this.stdout = options.stdout;
    this.stderr = options.stderr;
    this.command = options.command;
    this.args = options.args;
    this.cause = options.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Raised when input fails deterministic validation. */
export class GitValidationError extends GitError {
  constructor(message: string, options: GitErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'INVALID_PATH' });
  }
}

/** Raised for repository-boundary problems: invalid root, not a repository, sandbox escape. */
export class GitRepositoryError extends GitError {
  constructor(message: string, options: GitErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'NOT_A_REPOSITORY' });
  }
}

/** Raised when the git process fails, times out, is cancelled, or cannot spawn. */
export class GitCommandError extends GitError {
  constructor(message: string, options: GitErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'COMMAND_FAILED' });
  }
}

/** Raised when git output cannot be converted into a typed structure. */
export class GitParseError extends GitError {
  constructor(message: string, options: GitErrorOptions = {}) {
    super(message, { ...options, code: 'PARSE_ERROR' });
  }
}
