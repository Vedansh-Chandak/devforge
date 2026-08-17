/**
 * @devforge/execution — Typed errors for the Command Runner.
 *
 * Error hierarchy:
 *
 *   CommandError (base)
 *   ├── CommandValidationError   — validation failures (empty, traversal, shell metacharacters, etc.)
 *   ├── CommandSandboxError      — sandbox escapes, external cwd
 *   ├── CommandTimeoutError      — execution timeout
 *   ├── CommandCancellationError — abort signal triggered
 *   └── CommandExecutionError    — spawn/execution failures
 */

export const COMMAND_ERROR_CODES = {
  EMPTY_COMMAND: 'EMPTY_COMMAND',
  ABSOLUTE_EXECUTABLE: 'ABSOLUTE_EXECUTABLE',
  RELATIVE_EXECUTABLE: 'RELATIVE_EXECUTABLE',
  RELATIVE_TRAVERSAL: 'RELATIVE_TRAVERSAL',
  SHELL_METACHARACTER: 'SHELL_METACHARACTER',
  SHELL_EXPANSION: 'SHELL_EXPANSION',
  PIPE_REDIRECT: 'PIPE_REDIRECT',
  BACKGROUND_EXECUTION: 'BACKGROUND_EXECUTION',
  MULTIPLE_COMMANDS: 'MULTIPLE_COMMANDS',
  UNKNOWN_EXECUTABLE: 'UNKNOWN_EXECUTABLE',
  EXTERNAL_CWD: 'EXTERNAL_CWD',
  CWD_TRAVERSAL: 'CWD_TRAVERSAL',
  TIMEOUT: 'TIMEOUT',
  CANCELLED: 'CANCELLED',
  SPAWN_FAILED: 'SPAWN_FAILED',
  EXECUTION_FAILED: 'EXECUTION_FAILED',
} as const;

export type CommandErrorCode =
  (typeof COMMAND_ERROR_CODES)[keyof typeof COMMAND_ERROR_CODES];

export interface CommandErrorOptions {
  readonly code?: CommandErrorCode;
  readonly cause?: unknown;
}

export class CommandError extends Error {
  readonly code: CommandErrorCode;
  readonly cause?: unknown;

  constructor(message: string, options: CommandErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.code = options.code ?? 'EXECUTION_FAILED';
    this.cause = options.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class CommandValidationError extends CommandError {
  constructor(message: string, options: CommandErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'EMPTY_COMMAND' });
  }
}

export class CommandSandboxError extends CommandError {
  constructor(message: string, options: CommandErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'EXTERNAL_CWD' });
  }
}

export class CommandTimeoutError extends CommandError {
  constructor(message: string, options: CommandErrorOptions = {}) {
    super(message, { ...options, code: 'TIMEOUT' });
  }
}

export class CommandCancellationError extends CommandError {
  constructor(message: string, options: CommandErrorOptions = {}) {
    super(message, { ...options, code: 'CANCELLED' });
  }
}

export class CommandExecutionError extends CommandError {
  constructor(message: string, options: CommandErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'EXECUTION_FAILED' });
  }
}