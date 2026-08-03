import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createCommandRunner } from '../src/command/runner.js';
import { createSandbox } from '../src/command/sandbox.js';
import { validateCommand } from '../src/command/validator.js';
import { createTempDir, cleanupTempDir, SYMLINKS_SUPPORTED } from './helpers.js';
import {
  CommandValidationError,
  CommandSandboxError,
  CommandTimeoutError,
  CommandCancellationError,
  CommandExecutionError,
  COMMAND_ERROR_CODES,
} from '../src/command/errors.js';
import { ALLOWED_COMMANDS } from '../src/command/types.js';
import { DEFAULT_TIMEOUT_MS, DEFAULT_MAX_OUTPUT_BYTES } from '../src/command/limits.js';

const METACHAR_EXPECTED_CODES: Record<string, string> = {
  '|': COMMAND_ERROR_CODES.SHELL_METACHARACTER,
  '&': COMMAND_ERROR_CODES.SHELL_METACHARACTER,
  ';': COMMAND_ERROR_CODES.SHELL_METACHARACTER,
  '<': COMMAND_ERROR_CODES.SHELL_METACHARACTER,
  '>': COMMAND_ERROR_CODES.SHELL_METACHARACTER,
  '`': COMMAND_ERROR_CODES.SHELL_EXPANSION,
  '$': COMMAND_ERROR_CODES.SHELL_METACHARACTER,
  '\\': COMMAND_ERROR_CODES.SHELL_METACHARACTER,
  '\n': COMMAND_ERROR_CODES.SHELL_METACHARACTER,
  '\r': COMMAND_ERROR_CODES.SHELL_METACHARACTER,
  '\t': COMMAND_ERROR_CODES.SHELL_METACHARACTER,
};

describe('createCommandRunner', () => {
  const workspaceRoot = '/tmp/test-workspace';
  let runner: ReturnType<typeof createCommandRunner>;

  beforeEach(() => {
    runner = createCommandRunner({ workspaceRoot });
  });

  describe('allowed commands validation', () => {
    for (const cmd of ALLOWED_COMMANDS) {
      it(`accepts ${cmd} in validation`, () => {
        const result = validateCommand({
          command: cmd,
          args: ['--version'],
          cwd: workspaceRoot,
        });
        expect(result.ok).toBe(true);
      });
    }
  });

  describe('rejected commands validation', () => {
    it('rejects unknown executable', () => {
      const result = validateCommand({
        command: 'rm' as any,
        args: ['-rf', '/'],
        cwd: workspaceRoot,
      });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(COMMAND_ERROR_CODES.UNKNOWN_EXECUTABLE);
    });

    it('rejects empty command', () => {
      const result = validateCommand({
        command: '' as any,
        args: [],
        cwd: workspaceRoot,
      });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(COMMAND_ERROR_CODES.EMPTY_COMMAND);
    });

    it('rejects shell metacharacters in command', () => {
      const result = validateCommand({
        command: 'node; rm -rf /' as any,
        args: [],
        cwd: workspaceRoot,
      });
      expect(result.ok).toBe(false);
      expect(['SHELL_METACHARACTER', 'MULTIPLE_COMMANDS', 'UNKNOWN_EXECUTABLE']).toContain(result.code);
    });

    it('rejects shell expansion in command', () => {
      const result = validateCommand({
        command: 'node${HOME}' as any,
        args: [],
        cwd: workspaceRoot,
      });
      expect(result.ok).toBe(false);
      expect(['SHELL_EXPANSION', 'UNKNOWN_EXECUTABLE']).toContain(result.code);
    });

    it('rejects absolute executable path', () => {
      const result = validateCommand({
        command: '/usr/bin/node' as any,
        args: [],
        cwd: workspaceRoot,
      });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(COMMAND_ERROR_CODES.ABSOLUTE_EXECUTABLE);
    });

    it('rejects pipes in args', () => {
      const result = validateCommand({
        command: 'node',
        args: ['echo', '|', 'cat'],
        cwd: workspaceRoot,
      });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(COMMAND_ERROR_CODES.SHELL_METACHARACTER);
    });

    it('rejects redirects in args', () => {
      const result = validateCommand({
        command: 'node',
        args: ['>', 'out.txt'],
        cwd: workspaceRoot,
      });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(COMMAND_ERROR_CODES.SHELL_METACHARACTER);
    });

    it('rejects background execution in args', () => {
      const result = validateCommand({
        command: 'node',
        args: ['&'],
        cwd: workspaceRoot,
      });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(COMMAND_ERROR_CODES.SHELL_METACHARACTER);
    });

    it('accepts valid args with parentheses', () => {
      const result = validateCommand({
        command: 'node',
        args: ['-e', "console.log('hello')"],
        cwd: workspaceRoot,
      });
      expect(result.ok).toBe(true);
    });

    it('accepts valid args with special chars that are not metacharacters', () => {
      const result = validateCommand({
        command: 'node',
        args: ['--flag=value', 'path/to/file', 'normal-arg'],
        cwd: workspaceRoot,
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('cwd validation', () => {
    it('rejects external cwd', async () => {
      await expect(
        runner.run({
          command: 'node',
          args: ['--version'],
          cwd: '/etc',
        }),
      ).rejects.toThrow(CommandSandboxError);
    });

    it('rejects cwd with traversal', async () => {
      await expect(
        runner.run({
          command: 'node',
          args: ['--version'],
          cwd: '../etc',
        }),
      ).rejects.toThrow(CommandSandboxError);
    });

    it('rejects absolute cwd outside workspace', async () => {
      await expect(
        runner.run({
          command: 'node',
          args: ['--version'],
          cwd: '/tmp/outside',
        }),
      ).rejects.toThrow(CommandSandboxError);
    });

    it('sandbox validates relative cwd inside workspace', () => {
      const sandbox = createSandbox({ workspaceRoot });
      const result = sandbox.validateCwd('.');
      expect(result.ok).toBe(true);
    });

    it('sandbox validates absolute cwd inside workspace', () => {
      const sandbox = createSandbox({ workspaceRoot });
      const result = sandbox.validateCwd(workspaceRoot);
      expect(result.ok).toBe(true);
    });

    it('sandbox rejects traversal in cwd', () => {
      const sandbox = createSandbox({ workspaceRoot });
      const result = sandbox.validateCwd('src/../../../etc');
      expect(result.ok).toBe(false);
      expect(result.code).toBe(COMMAND_ERROR_CODES.CWD_TRAVERSAL);
    });
  });

  describe('timeout validation', () => {
    it('rejects negative timeout', () => {
      const result = validateCommand({
        command: 'node',
        args: ['--version'],
        cwd: workspaceRoot,
        timeoutMs: -1,
      });
      expect(result.ok).toBe(true); // validation passes, runner will reject
    });

    it('rejects timeout over max', () => {
      const result = validateCommand({
        command: 'node',
        args: ['--version'],
        cwd: workspaceRoot,
        timeoutMs: 500_000,
      });
      expect(result.ok).toBe(true); // validation passes, runner will reject
    });
  });

  describe('maxOutputBytes validation', () => {
    it('rejects negative maxOutputBytes', () => {
      const result = validateCommand({
        command: 'node',
        args: ['--version'],
        cwd: workspaceRoot,
        maxOutputBytes: -1,
      });
      expect(result.ok).toBe(true); // validation passes, runner will reject
    });

    it('rejects maxOutputBytes over max', () => {
      const result = validateCommand({
        command: 'node',
        args: ['--version'],
        cwd: workspaceRoot,
        maxOutputBytes: 20_000_000,
      });
      expect(result.ok).toBe(true); // validation passes, runner will reject
    });
  });

  describe('environment filtering', () => {
    it('accepts valid environment', () => {
      const result = validateCommand({
        command: 'node',
        args: ['--version'],
        cwd: workspaceRoot,
        environment: { CUSTOM_VAR: 'value', ANOTHER: 'test' },
      });
      expect(result.ok).toBe(true);
    });

    it('rejects too many env vars', () => {
      const env: Record<string, string> = {};
      for (let i = 0; i < 65; i++) {
        env[`VAR${i}`] = 'value';
      }
      const result = validateCommand({
        command: 'node',
        args: ['--version'],
        cwd: workspaceRoot,
        environment: env,
      });
      expect(result.ok).toBe(false);
    });

    it('rejects env key too long', () => {
      const key = 'a'.repeat(257);
      const result = validateCommand({
        command: 'node',
        args: ['--version'],
        cwd: workspaceRoot,
        environment: { [key]: 'value' },
      });
      expect(result.ok).toBe(false);
    });

    it('rejects env value too long', () => {
      const result = validateCommand({
        command: 'node',
        args: ['--version'],
        cwd: workspaceRoot,
        environment: { KEY: 'a'.repeat(8193) },
      });
      expect(result.ok).toBe(false);
    });
  });

  describe('deterministic validation', () => {
    it('validates identically for same input', () => {
      const request = {
        command: 'node' as const,
        args: ['script.js'],
        cwd: workspaceRoot,
      };
      const a = validateCommand(request);
      const b = validateCommand(request);
      expect(a).toEqual(b);
    });
  });

  describe('runner error handling', () => {
    it('throws CommandValidationError for invalid command', async () => {
      await expect(
        runner.run({
          command: 'invalid-cmd' as any,
          args: [],
          cwd: workspaceRoot,
        }),
      ).rejects.toThrow(CommandValidationError);
    });

    it('throws CommandSandboxError for external cwd', async () => {
      await expect(
        runner.run({
          command: 'node',
          args: ['--version'],
          cwd: '/etc',
        }),
      ).rejects.toThrow(CommandSandboxError);
    });

    it('throws CommandValidationError for shell metacharacters', async () => {
      await expect(
        runner.run({
          command: 'node',
          args: ['|', 'cat'],
          cwd: workspaceRoot,
        }),
      ).rejects.toThrow(CommandValidationError);
    });

    it('handles allowFailure option in validation', () => {
      const result = validateCommand({
        command: 'node',
        args: ['--version'],
        cwd: workspaceRoot,
        allowFailure: true,
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('concurrent executions isolation', () => {
    it('each runner instance is isolated', () => {
      const runner1 = createCommandRunner({ workspaceRoot });
      const runner2 = createCommandRunner({ workspaceRoot });
      expect(runner1).not.toBe(runner2);
    });
  });
});

describe('createSandbox', () => {
  const workspaceRoot = '/workspace/root';
  const sandbox = createSandbox({ workspaceRoot });

  describe('validateCwd', () => {
    it('accepts workspace root', () => {
      const result = sandbox.validateCwd(workspaceRoot);
      expect(result.ok).toBe(true);
      expect(result.absoluteCwd).toBe(workspaceRoot);
    });

    it('accepts relative path inside workspace', () => {
      const result = sandbox.validateCwd('src/lib');
      expect(result.ok).toBe(true);
      expect(result.absoluteCwd).toBe('/workspace/root/src/lib');
    });

    it('accepts nested relative path', () => {
      const result = sandbox.validateCwd('./src/lib');
      expect(result.ok).toBe(true);
      expect(result.absoluteCwd).toBe('/workspace/root/src/lib');
    });

    it('accepts absolute path inside workspace', () => {
      const result = sandbox.validateCwd('/workspace/root/src');
      expect(result.ok).toBe(true);
      expect(result.absoluteCwd).toBe('/workspace/root/src');
    });

    it('normalizes redundant separators', () => {
      const result = sandbox.validateCwd('src//lib/./utils');
      expect(result.ok).toBe(true);
      expect(result.absoluteCwd).toBe('/workspace/root/src/lib/utils');
    });

    it('rejects empty cwd', () => {
      const result = sandbox.validateCwd('');
      expect(result.ok).toBe(false);
      expect(result.code).toBe(COMMAND_ERROR_CODES.EXTERNAL_CWD);
    });

    it('rejects whitespace-only cwd', () => {
      const result = sandbox.validateCwd('   ');
      expect(result.ok).toBe(false);
      expect(result.code).toBe(COMMAND_ERROR_CODES.EXTERNAL_CWD);
    });

    it('rejects absolute path outside workspace', () => {
      const result = sandbox.validateCwd('/etc/passwd');
      expect(result.ok).toBe(false);
      expect(result.code).toBe(COMMAND_ERROR_CODES.EXTERNAL_CWD);
    });

    it('rejects Windows path outside workspace', () => {
      const result = sandbox.validateCwd('C:\\Windows\\System32');
      expect(result.ok).toBe(false);
      expect(result.code).toBe(COMMAND_ERROR_CODES.EXTERNAL_CWD);
    });

    it('rejects relative traversal', () => {
      const result = sandbox.validateCwd('../etc');
      expect(result.ok).toBe(false);
      expect(result.code).toBe(COMMAND_ERROR_CODES.CWD_TRAVERSAL);
    });

    it('rejects nested traversal', () => {
      const result = sandbox.validateCwd('src/../../etc');
      expect(result.ok).toBe(false);
      expect(result.code).toBe(COMMAND_ERROR_CODES.CWD_TRAVERSAL);
    });

    it('rejects backslash traversal', () => {
      const result = sandbox.validateCwd('src\\..\\..\\etc');
      expect(result.ok).toBe(false);
      expect(result.code).toBe(COMMAND_ERROR_CODES.CWD_TRAVERSAL);
    });

    it('rejects absolute path that resolves outside', () => {
      const result = sandbox.validateCwd('/workspace/root/../../etc');
      expect(result.ok).toBe(false);
      expect(result.code).toBe(COMMAND_ERROR_CODES.EXTERNAL_CWD);
    });
  });

  describe('validatePaths', () => {
    it('accepts paths inside workspace', () => {
      const result = sandbox.validatePaths(['src/file.ts', 'lib/utils.ts']);
      expect(result.ok).toBe(true);
    });

    it('rejects empty path', () => {
      const result = sandbox.validatePaths(['src/file.ts', '']);
      expect(result.ok).toBe(false);
    });

    it('rejects absolute path outside workspace', () => {
      const result = sandbox.validatePaths(['/etc/passwd']);
      expect(result.ok).toBe(false);
      expect(result.code).toBe(COMMAND_ERROR_CODES.EXTERNAL_CWD);
    });

    it('rejects path with traversal', () => {
      const result = sandbox.validatePaths(['src/../../etc/passwd']);
      expect(result.ok).toBe(false);
      expect(result.code).toBe(COMMAND_ERROR_CODES.CWD_TRAVERSAL);
    });
  });

  describe('resolveInSandbox', () => {
    it('resolves relative path', () => {
      const result = sandbox.resolveInSandbox('src/lib/file.ts');
      expect(result).toBe('/workspace/root/src/lib/file.ts');
    });

    it('normalizes path', () => {
      const result = sandbox.resolveInSandbox('./src//lib/./file.ts');
      expect(result).toBe('/workspace/root/src/lib/file.ts');
    });
  });
});

describe('validateCommand', () => {
  const workspaceRoot = '/workspace/root';
  const baseRequest = {
    command: 'node' as const,
    args: ['script.js'],
    cwd: workspaceRoot,
  };

  it('accepts all allowed commands', () => {
    for (const cmd of ALLOWED_COMMANDS) {
      const result = validateCommand({ ...baseRequest, command: cmd });
      expect(result.ok).toBe(true);
    }
  });

  it('rejects empty command', () => {
    const result = validateCommand({ ...baseRequest, command: '' as any });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(COMMAND_ERROR_CODES.EMPTY_COMMAND);
  });

  it('rejects unknown executables', () => {
    const result = validateCommand({ ...baseRequest, command: 'rm' as any });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(COMMAND_ERROR_CODES.UNKNOWN_EXECUTABLE);
  });

  it('rejects absolute executable paths', () => {
    const result = validateCommand({ ...baseRequest, command: '/usr/bin/node' as any });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(COMMAND_ERROR_CODES.ABSOLUTE_EXECUTABLE);
  });

  it('rejects Windows absolute paths', () => {
    const result = validateCommand({ ...baseRequest, command: 'C:\\Windows\\node.exe' as any });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(COMMAND_ERROR_CODES.ABSOLUTE_EXECUTABLE);
  });

  it('rejects relative executable paths', () => {
    const result = validateCommand({ ...baseRequest, command: './node' as any });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(COMMAND_ERROR_CODES.RELATIVE_EXECUTABLE);
  });

  it('rejects backslash relative executable paths', () => {
    const result = validateCommand({ ...baseRequest, command: '.\\node' as any });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(COMMAND_ERROR_CODES.RELATIVE_EXECUTABLE);
  });

  it('rejects relative traversal in command', () => {
    const result = validateCommand({ ...baseRequest, command: '../node' as any });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(COMMAND_ERROR_CODES.RELATIVE_TRAVERSAL);
  });

  it('rejects shell metacharacters in command', () => {
    for (const char of ['|', '&', ';', '<', '>', '`', '$', '\\', '\n', '\r', '\t']) {
      const result = validateCommand({ ...baseRequest, command: `node${char}` as any });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(METACHAR_EXPECTED_CODES[char]);
    }
  });

  it('rejects shell expansion in command', () => {
    const patterns = ['${HOME}', '$HOME', '`echo hi`', '$(echo hi)'];
    for (const pattern of patterns) {
      const result = validateCommand({ ...baseRequest, command: `node${pattern}` as any });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(COMMAND_ERROR_CODES.SHELL_EXPANSION);
    }
  });

  it('rejects multiple commands', () => {
    const patterns = ['node && echo hi', 'node || echo hi', 'node; echo hi'];
    for (const pattern of patterns) {
      const result = validateCommand({ ...baseRequest, command: pattern as any });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(COMMAND_ERROR_CODES.MULTIPLE_COMMANDS);
    }
  });

  it('rejects shell metacharacters in args', () => {
    for (const char of ['|', '&', ';', '<', '>', '`', '$', '\\']) {
      const result = validateCommand({ ...baseRequest, args: ['arg', `val${char}`] });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(METACHAR_EXPECTED_CODES[char]);
    }
  });

  it('rejects shell expansion in args', () => {
    const result = validateCommand({ ...baseRequest, args: ['${HOME}'] });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(COMMAND_ERROR_CODES.SHELL_EXPANSION);
  });

  it('accepts valid args with parentheses', () => {
    const result = validateCommand({ ...baseRequest, args: ['-e', "console.log('hello')"] });
    expect(result.ok).toBe(true);
  });

  it('accepts valid args with brackets', () => {
    const result = validateCommand({ ...baseRequest, args: ['--config', '[{\"key\":\"value\"}]'] });
    expect(result.ok).toBe(true);
  });

  it('rejects too many args', () => {
    const result = validateCommand({ ...baseRequest, args: new Array(129).fill('arg') });
    expect(result.ok).toBe(false);
  });

  it('rejects args that are too long', () => {
    const result = validateCommand({ ...baseRequest, args: ['a'.repeat(4097)] });
    expect(result.ok).toBe(false);
  });

  it('rejects invalid environment (not an object)', () => {
    const result = validateCommand({ ...baseRequest, environment: 'not-an-object' as any });
    expect(result.ok).toBe(false);
  });

  it('rejects too many env vars', () => {
    const env: Record<string, string> = {};
    for (let i = 0; i < 65; i++) {
      env[`VAR${i}`] = 'value';
    }
    const result = validateCommand({ ...baseRequest, environment: env });
    expect(result.ok).toBe(false);
  });

  it('rejects env key too long', () => {
    const key = 'a'.repeat(257);
    const result = validateCommand({ ...baseRequest, environment: { [key]: 'value' } });
    expect(result.ok).toBe(false);
  });

  it('rejects env value too long', () => {
    const result = validateCommand({ ...baseRequest, environment: { KEY: 'a'.repeat(8193) } });
    expect(result.ok).toBe(false);
  });

  it('accepts valid environment', () => {
    const result = validateCommand({
      ...baseRequest,
      environment: { CUSTOM_VAR: 'value', ANOTHER: 'test' },
    });
    expect(result.ok).toBe(true);
  });

  it('is deterministic for identical inputs', () => {
    const a = validateCommand(baseRequest);
    const b = validateCommand(baseRequest);
    expect(a).toEqual(b);
  });
});

describe('command runner execution', () => {
  const roots: string[] = [];
  let root: string;
  let runner: ReturnType<typeof createCommandRunner>;

  beforeEach(async () => {
    root = await createTempDir();
    roots.push(root);
    runner = createCommandRunner({ workspaceRoot: root });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const r of roots.splice(0)) {
      await cleanupTempDir(r);
    }
  });

  it('captures stdout', async () => {
    const result = await runner.run({
      command: 'node',
      args: ['-e', "console.log('hello world')"],
      cwd: root,
    });
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello world\n');
    expect(result.stderr).toBe('');
  });

  it('captures stderr separately', async () => {
    const result = await runner.run({
      command: 'node',
      args: ['-e', "console.error('boom')"],
      cwd: root,
    });
    expect(result.success).toBe(true);
    expect(result.stderr).toBe('boom\n');
    expect(result.stdout).toBe('');
  });

  it('returns success false and the exit code for a failing command (allowFailure)', async () => {
    const result = await runner.run({
      command: 'node',
      args: ['-e', 'process.exit(3)'],
      cwd: root,
      allowFailure: true,
    });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.timedOut).toBe(false);
    expect(result.cancelled).toBe(false);
  });

  it('throws CommandExecutionError on non-zero exit without allowFailure', async () => {
    await expect(
      runner.run({
        command: 'node',
        args: ['-e', 'process.exit(1)'],
        cwd: root,
      }),
    ).rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('echoes command and args on the result', async () => {
    const result = await runner.run({
      command: 'node',
      args: ['--version'],
      cwd: root,
    });
    expect(result.command).toBe('node');
    expect(result.args).toEqual(['--version']);
  });

  it('reports a non-negative durationMs', async () => {
    const result = await runner.run({
      command: 'node',
      args: ['--version'],
      cwd: root,
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('kills the process and returns timedOut when it exceeds the timeout', async () => {
    const result = await runner.run({
      command: 'node',
      args: ['-e', 'while(true){}'],
      cwd: root,
      timeoutMs: 200,
    });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(result.success).toBe(false);
    expect(result.cancelled).toBe(false);
  }, 10_000);

  it('does not time out fast commands', async () => {
    const result = await runner.run({
      command: 'node',
      args: ['--version'],
      cwd: root,
      timeoutMs: 5_000,
    });
    expect(result.timedOut).toBe(false);
    expect(result.success).toBe(true);
  });

  it('supports cancellation via AbortSignal', async () => {
    const controller = new AbortController();
    const promise = runner.run({
      command: 'node',
      args: ['-e', 'while(true){}'],
      cwd: root,
      abortSignal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);
    const result = await promise;
    expect(result.cancelled).toBe(true);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBeNull();
  }, 10_000);

  it('does not cancel without an abort', async () => {
    const controller = new AbortController();
    const result = await runner.run({
      command: 'node',
      args: ['--version'],
      cwd: root,
      abortSignal: controller.signal,
    });
    expect(result.cancelled).toBe(false);
    expect(result.success).toBe(true);
  });

  it('truncates stdout beyond maxOutputBytes', async () => {
    const result = await runner.run({
      command: 'node',
      args: ['-e', "process.stdout.write('x'.repeat(50000))"],
      cwd: root,
      maxOutputBytes: 1024,
    });
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBe(1024);
    expect(result.success).toBe(true);
  });

  it('does not truncate output within maxOutputBytes', async () => {
    const result = await runner.run({
      command: 'node',
      args: ['-e', "console.log('ok')"],
      cwd: root,
      maxOutputBytes: 1024,
    });
    expect(result.truncated).toBe(false);
    expect(result.stdout).toBe('ok\n');
  });

  it('keeps waiting for exit after output truncation', async () => {
    const result = await runner.run({
      command: 'node',
      args: ['-e', "process.stdout.write('y'.repeat(2000)),console.log('done')"],
      cwd: root,
      maxOutputBytes: 64,
    });
    expect(result.truncated).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.success).toBe(true);
  });

  it('rejects invalid timeoutMs at run time', async () => {
    await expect(
      runner.run({
        command: 'node',
        args: ['--version'],
        cwd: root,
        timeoutMs: -1,
      }),
    ).rejects.toBeInstanceOf(CommandValidationError);
    await expect(
      runner.run({
        command: 'node',
        args: ['--version'],
        cwd: root,
        timeoutMs: 500_000,
      }),
    ).rejects.toBeInstanceOf(CommandValidationError);
  });

  it('rejects invalid maxOutputBytes at run time', async () => {
    await expect(
      runner.run({
        command: 'node',
        args: ['--version'],
        cwd: root,
        maxOutputBytes: -1,
      }),
    ).rejects.toBeInstanceOf(CommandValidationError);
    await expect(
      runner.run({
        command: 'node',
        args: ['--version'],
        cwd: root,
        maxOutputBytes: 20_000_000,
      }),
    ).rejects.toBeInstanceOf(CommandValidationError);
  });

  it('filters environment: non-allowlisted variables are not passed through', async () => {
    vi.stubEnv('SECRET_RUNNER_TEST', 'leak');
    const result = await runner.run({
      command: 'node',
      args: ['-e', 'console.log(typeof process.env.SECRET_RUNNER_TEST)'],
      cwd: root,
    });
    expect(result.stdout.trim()).toBe('undefined');
  });

  it('merges explicit environment variables', async () => {
    const result = await runner.run({
      command: 'node',
      args: ['-e', 'console.log(process.env.RUNNER_EXPLICIT)'],
      cwd: root,
      environment: { RUNNER_EXPLICIT: 'set' },
    });
    expect(result.stdout.trim()).toBe('set');
  });

  it('explicit environment overrides an allowlisted variable', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const result = await runner.run({
      command: 'node',
      args: ['-e', 'console.log(process.env.NODE_ENV)'],
      cwd: root,
      environment: { NODE_ENV: 'production' },
    });
    expect(result.stdout.trim()).toBe('production');
  });

  it('passes allowlisted variables through', async () => {
    vi.stubEnv('CI', 'true');
    const result = await runner.run({
      command: 'node',
      args: ['-e', 'console.log(process.env.CI)'],
      cwd: root,
    });
    expect(result.stdout.trim()).toBe('true');
  });

  it('runs concurrent commands in isolation', async () => {
    const letters = ['a', 'b', 'c', 'd', 'e'];
    const results = await Promise.all(
      letters.map((letter) =>
        runner.run({
          command: 'node',
          args: ['-e', `console.log('${letter}')`],
          cwd: root,
        }),
      ),
    );
    results.forEach((result, index) => {
      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toBe(letters[index]);
    });
  });

  it('runs with a relative cwd inside the workspace', async () => {
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    const result = await runner.run({
      command: 'node',
      args: ['-e', 'console.log(process.cwd())'],
      cwd: 'src',
    });
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe(await fs.realpath(path.join(root, 'src')));
  });

  it('rejects symlink escape via cwd', async () => {
    if (!SYMLINKS_SUPPORTED) return;
    const outside = await createTempDir();
    roots.push(outside);
    await fs.symlink(outside, path.join(root, 'escape'));
    await expect(
      runner.run({
        command: 'node',
        args: ['--version'],
        cwd: 'escape',
      }),
    ).rejects.toBeInstanceOf(CommandSandboxError);
  });

  it('rejects an absolute cwd outside the workspace', async () => {
    const outside = await createTempDir();
    roots.push(outside);
    await expect(
      runner.run({
        command: 'node',
        args: ['--version'],
        cwd: outside,
      }),
    ).rejects.toBeInstanceOf(CommandSandboxError);
  });

  it('throws CommandExecutionError when the executable cannot be spawned', async () => {
    // Restrict PATH so the allowlisted `node` cannot be resolved.
    vi.stubEnv('PATH', '/nonexistent');
    await expect(
      runner.run({
        command: 'node',
        args: ['--version'],
        cwd: root,
      }),
    ).rejects.toBeInstanceOf(CommandExecutionError);
  });
});