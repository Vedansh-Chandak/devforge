/**
 * @devforge/execution — Command Runner types.
 */

export type Command =
  | 'pnpm'
  | 'npm'
  | 'node'
  | 'git'
  | 'tsc'
  | 'vitest'
  | 'eslint'
  | 'prettier'
  | 'turbo';

export interface CommandRequest {
  readonly command: Command;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly allowFailure?: boolean;
  readonly abortSignal?: AbortSignal;
}

export interface CommandResult {
  /** True when the process exited 0 and was neither timed out nor cancelled. */
  readonly success: boolean;
  readonly stdout: string;
  readonly stderr: string;
  /** Process exit code, or null when the run timed out or was cancelled. */
  readonly exitCode: number | null;
  /** Wall-clock duration of the run in milliseconds. */
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly truncated: boolean;
  /** The command that was executed (echoed from the request). */
  readonly command: Command;
  /** The arguments passed to the command (echoed from the request). */
  readonly args: readonly string[];
}

export interface CommandRunner {
  run(request: CommandRequest): Promise<CommandResult>;
}

export const ALLOWED_COMMANDS: readonly Command[] = [
  'pnpm',
  'npm',
  'node',
  'git',
  'tsc',
  'vitest',
  'eslint',
  'prettier',
  'turbo',
] as const;

export const ALLOWLIST_ENV_VARS = [
  'PATH',
  'HOME',
  'TMPDIR',
  'CI',
  'NODE_ENV',
  'TERM',
  'LANG',
] as const;