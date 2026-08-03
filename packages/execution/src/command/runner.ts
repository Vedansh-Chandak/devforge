/**
 * @devforge/execution — Secure, deterministic Command Runner (DF-014).
 *
 * The ONLY subsystem allowed to spawn child processes.
 * Uses spawn() with shell:false. Never exec()/execFile()/spawnSync()/shell.
 *
 * All side effects live here. Validation, sandbox path checks and the
 * environment builder are pure modules consumed by this runner.
 */

import { spawn, type SpawnOptions } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { CommandRequest, CommandResult, CommandRunner } from './types.js';
import { validateCommand } from './validator.js';
import { createSandbox } from './sandbox.js';
import { buildEnvironment } from './environment.js';
import {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  MAX_MAX_OUTPUT_BYTES,
} from './limits.js';
import {
  CommandValidationError,
  CommandSandboxError,
  CommandExecutionError,
  type CommandErrorCode,
} from './errors.js';

export interface CommandRunnerConfig {
  readonly workspaceRoot: string;
}

/** True when `target` is inside or equal to `root` (both absolute paths). */
function isInside(root: string, target: string): boolean {
  const normalizedRoot = path.normalize(root);
  const normalizedTarget = path.normalize(target);
  if (normalizedTarget === normalizedRoot) return true;
  return normalizedTarget.startsWith(normalizedRoot + path.sep);
}

/**
 * Runtime symlink containment check. The pure sandbox validates path shape;
 * this resolves the real path of the cwd and rejects when it lands outside
 * the real workspace root. A cwd that does not exist yet is left to spawn,
 * which surfaces the missing-directory error.
 */
async function assertCwdRealpathInside(cwd: string, root: string): Promise<void> {
  let realCwd: string;
  let realRoot: string;
  try {
    realCwd = await fs.realpath(cwd);
    realRoot = await fs.realpath(root);
  } catch {
    return;
  }
  if (!isInside(realRoot, realCwd)) {
    throw new CommandSandboxError(
      'Working directory resolves outside the workspace root (symlink escape)',
      { code: 'EXTERNAL_CWD' },
    );
  }
}

interface OutputCollector {
  readonly stdout: (chunk: Uint8Array) => void;
  readonly stderr: (chunk: Uint8Array) => void;
  readonly flush: () => { stdout: string; stderr: string; truncated: boolean };
}

/**
 * Captures stdout/stderr with a combined byte budget. Once the budget is
 * exhausted no further chunks are collected, but the process is left to run
 * (the caller keeps waiting for exit). Marks truncation when data was dropped.
 */
function createOutputCollector(maxBytes: number): OutputCollector {
  const stdoutChunks: Uint8Array[] = [];
  const stderrChunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  let closed = false;

  const push = (chunk: Uint8Array, sink: Uint8Array[]): void => {
    if (closed) return;
    const remaining = maxBytes - total;
    if (remaining <= 0) {
      truncated = true;
      closed = true;
      return;
    }
    if (chunk.length > remaining) {
      sink.push(chunk.subarray(0, remaining));
      total += remaining;
      truncated = true;
      closed = true;
      return;
    }
    sink.push(chunk);
    total += chunk.length;
  };

  return {
    stdout: (chunk) => push(chunk, stdoutChunks),
    stderr: (chunk) => push(chunk, stderrChunks),
    flush: () => ({
      stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
      stderr: Buffer.concat(stderrChunks).toString('utf-8'),
      truncated,
    }),
  };
}

export function createCommandRunner(config: CommandRunnerConfig): CommandRunner {
  const sandbox = createSandbox({ workspaceRoot: config.workspaceRoot });
  const canonicalRoot = path.resolve(config.workspaceRoot);

  return {
    async run(request: CommandRequest): Promise<CommandResult> {
      const validation = validateCommand(request);
      if (!validation.ok) {
        throw new CommandValidationError(validation.reason, {
          code: validation.code as CommandErrorCode,
        });
      }

      const cwdValidation = sandbox.validateCwd(request.cwd);
      if (!cwdValidation.ok) {
        throw new CommandSandboxError(cwdValidation.reason, {
          code: cwdValidation.code as CommandErrorCode,
        });
      }

      const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > MAX_TIMEOUT_MS) {
        throw new CommandValidationError(`Invalid timeout: must be between 0 and ${MAX_TIMEOUT_MS}ms`);
      }

      const maxOutputBytes = request.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
      if (typeof maxOutputBytes !== 'number' || !Number.isFinite(maxOutputBytes) || maxOutputBytes < 0 || maxOutputBytes > MAX_MAX_OUTPUT_BYTES) {
        throw new CommandValidationError(`Invalid maxOutputBytes: must be between 0 and ${MAX_MAX_OUTPUT_BYTES}`);
      }

      await assertCwdRealpathInside(cwdValidation.absoluteCwd, canonicalRoot);

      const filteredEnv = buildEnvironment(process.env as Record<string, string>, request.environment);
      const spawnOptions: SpawnOptions = {
        cwd: cwdValidation.absoluteCwd,
        env: filteredEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      };

      const child = spawn(request.command, request.args, spawnOptions);

      const collector = createOutputCollector(maxOutputBytes);
      child.stdout?.on('data', collector.stdout);
      child.stderr?.on('data', collector.stderr);

      const startTime = Date.now();
      let timedOut = false;
      let cancelled = false;

      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true;
              child.kill('SIGKILL');
            }, timeoutMs)
          : undefined;

      const onAbort = (): void => {
        cancelled = true;
        child.kill('SIGKILL');
      };
      let abortAttached = false;
      if (request.abortSignal) {
        if (request.abortSignal.aborted) {
          cancelled = true;
          child.kill('SIGKILL');
        } else {
          request.abortSignal.addEventListener('abort', onAbort, { once: true });
          abortAttached = true;
        }
      }

      try {
        const exitCode = await new Promise<number | null>((resolve, reject) => {
          child.once('error', (err) => {
            reject(err);
          });
          child.once('close', (code) => {
            resolve(code ?? null);
          });
        });

        const durationMs = Date.now() - startTime;
        const { stdout, stderr, truncated } = collector.flush();

        if (timedOut) {
          return {
            success: false,
            stdout,
            stderr,
            exitCode: null,
            durationMs,
            timedOut: true,
            cancelled: false,
            truncated,
            command: request.command,
            args: request.args,
          };
        }

        if (cancelled) {
          return {
            success: false,
            stdout,
            stderr,
            exitCode: null,
            durationMs,
            timedOut: false,
            cancelled: true,
            truncated,
            command: request.command,
            args: request.args,
          };
        }

        if (exitCode !== 0 && !request.allowFailure) {
          throw new CommandExecutionError(
            `Command "${request.command}" failed with exit code ${exitCode}`,
            { code: 'EXECUTION_FAILED' },
          );
        }

        return {
          success: exitCode === 0,
          stdout,
          stderr,
          exitCode,
          durationMs,
          timedOut: false,
          cancelled: false,
          truncated,
          command: request.command,
          args: request.args,
        };
      } catch (error) {
        if (error instanceof CommandExecutionError) {
          throw error;
        }
        throw new CommandExecutionError(
          `Failed to spawn command "${request.command}": ${error instanceof Error ? error.message : String(error)}`,
          { code: 'SPAWN_FAILED', cause: error },
        );
      } finally {
        if (timer) clearTimeout(timer);
        if (abortAttached && request.abortSignal) {
          request.abortSignal.removeEventListener('abort', onAbort);
        }
      }
    },
  };
}
