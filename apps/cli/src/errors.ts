/**
 * @vedansh78/cli — CLI error types (M1).
 *
 * Typed errors with a stable machine code plus a human-facing rendering layer.
 * Stack traces are only rendered in --debug mode.
 */

import { redactSecrets } from '@devforge/config';

/** Machine-readable error codes for the CLI layer. */
export type CliErrorCode =
  | 'CONFIG_ERROR'
  | 'DISCOVERY_ERROR'
  | 'PLANNER_ERROR'
  | 'EXECUTOR_ERROR'
  | 'BRAIN_ERROR'
  | 'PROVIDER_ERROR'
  | 'NOT_A_REPOSITORY'
  | 'NOT_FOUND'
  | 'USAGE_ERROR'
  | 'UNKNOWN';

/** Base class for all DevForge CLI errors. */
export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly exitCode: number;

  constructor(message: string, code: CliErrorCode = 'UNKNOWN', exitCode = 1) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.exitCode = exitCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Configuration loading or validation failed. */
export class ConfigError extends CliError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR', 2);
  }
}

/** Repository discovery failed (no git repo / not a repository). */
export class DiscoveryError extends CliError {
  constructor(message: string, code: CliErrorCode = 'DISCOVERY_ERROR') {
    super(message, code, 3);
  }
}

/** Planner produced an invalid or failed plan. */
export class PlannerError extends CliError {
  constructor(message: string) {
    super(message, 'PLANNER_ERROR', 4);
  }
}

/** Executor failed to run a plan or coding loop. */
export class ExecutorError extends CliError {
  constructor(message: string) {
    super(message, 'EXECUTOR_ERROR', 5);
  }
}

/** Brain pipeline failed. */
export class BrainError extends CliError {
  constructor(message: string) {
    super(message, 'BRAIN_ERROR', 6);
  }
}

/** Model provider was misconfigured or failed. */
export class ProviderError extends CliError {
  constructor(message: string) {
    super(message, 'PROVIDER_ERROR', 7);
  }
}

/** The user passed invalid arguments. */
export class UsageError extends CliError {
  constructor(message: string) {
    super(message, 'USAGE_ERROR', 8);
  }
}

/**
 * Render an unknown error to a single human-readable line with a stable code.
 * Stack traces are only emitted when debug is true. Secret-shaped values are
 * masked before the line is shown.
 */
export function formatError(error: unknown, debug: boolean): string {
  let rendered: string;
  if (error instanceof CliError) {
    const prefix = `[${error.code}]`;
    if (debug && error.stack) {
      rendered = `${prefix} ${error.message}\n${error.stack}`;
    } else {
      rendered = `${prefix} ${error.message}`;
    }
  } else if (error instanceof Error) {
    if (debug && error.stack) {
      rendered = `[UNKNOWN] ${error.message}\n${error.stack}`;
    } else {
      rendered = `[UNKNOWN] ${error.message}`;
    }
  } else {
    rendered = `[UNKNOWN] ${String(error)}`;
  }
  return redactSecrets(rendered);
}