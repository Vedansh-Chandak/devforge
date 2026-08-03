/**
 * @devforge/execution — Command Runner subsystem (DF-014).
 *
 * Secure, deterministic command execution with:
 * - Allowlist-based executable validation
 * - Sandbox containment (workspace-root only)
 * - Timeout and cancellation support
 * - Output capture with truncation
 * - Environment filtering
 * - No shell execution (spawn with shell:false)
 */

export { createCommandRunner, type CommandRunnerConfig } from './runner.js';
export { validateCommand, type CommandValidation } from './validator.js';
export { createSandbox, type SandboxValidation, type SandboxConfig } from './sandbox.js';
export { buildEnvironment, buildEnvironmentFromProcess, type EnvironmentMap, type BuildEnvironmentInput } from './environment.js';
export type { Command, CommandRequest, CommandResult, CommandRunner } from './types.js';
export { ALLOWED_COMMANDS, ALLOWLIST_ENV_VARS } from './types.js';
export {
  CommandError,
  CommandValidationError,
  CommandSandboxError,
  CommandTimeoutError,
  CommandCancellationError,
  CommandExecutionError,
  COMMAND_ERROR_CODES,
} from './errors.js';
export type { CommandErrorCode, CommandErrorOptions } from './errors.js';
export {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  MAX_MAX_OUTPUT_BYTES,
} from './limits.js';