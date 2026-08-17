import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createGitService } from '../service.js';
import { renderUnifiedDiff, parseGitDiff } from '../parser.js';
import {
  GitValidationError,
  GitRepositoryError,
  GitCommandError,
  GIT_ERROR_CODES,
} from '../errors.js';
import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from '../../command/types.js';
import { CommandExecutionError } from '../../command/errors.js';

const execFileAsync = promisify(execFile);

const HASH = '0123456789abcdef0123456789abcdef01234567';

function result(overrides: Partial<CommandResult> = {}): CommandResult {
  return {
    success: true,
    stdout: '',
    stderr: '',
    exitCode: 0,
    durationMs: 1,
    timedOut: false,
    cancelled: false,
    truncated: false,
    command: 'git',
    args: [],
    ...overrides,
  };
}

interface FakeRunner extends CommandRunner {
  readonly calls: CommandRequest[];
}

function fakeRunner(
  handler: (request: CommandRequest) => CommandResult | Promise<CommandResult>,
): FakeRunner {
  const calls: CommandRequest[] = [];
  return {
    calls,
    async run(request: CommandRequest): Promise<CommandResult> {
      calls.push(request);
      return handler(request);
    },
  };
}

const okRunner = fakeRunner(() => result());

async function initRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'devforge-git-'));
  await execFileAsync('git', ['init', '-b', 'main', '-q'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 'test@devforge.local'], {
    cwd: dir,
  });
  await execFileAsync('git', ['config', 'user.name', 'DevForge Test'], {
    cwd: dir,
  });
  await execFileAsync('git', ['config', 'commit.gpgsign', 'false'], {
    cwd: dir,
  });
  return dir;
}

async function cleanup(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

async function git(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', args, { cwd });
}

describe('createGitService', () => {
  it('throws GitRepositoryError for a non-absolute workspace root', () => {
    expect(() => createGitService({ workspaceRoot: 'relative/path' })).toThrow(
      GitRepositoryError,
    );
  });

  it('throws GitRepositoryError for an empty workspace root', () => {
    expect(() => createGitService({ workspaceRoot: '' })).toThrow(
      GitRepositoryError,
    );
  });

  it('accepts an absolute workspace root', () => {
    const service = createGitService({
      workspaceRoot: '/workspace',
      runner: okRunner,
    });
    expect(service.workspaceRoot).toBe('/workspace');
  });
});

describe('repository detection', () => {
  it('returns true when inside a work tree', async () => {
    const runner = fakeRunner((request) => {
      expect(request.args).toEqual([
        'rev-parse',
        '--is-inside-work-tree',
        '--show-toplevel',
      ]);
      return result({ stdout: 'true\n/workspace\n' });
    });
    const service = createGitService({ workspaceRoot: '/workspace', runner });
    await expect(service.isRepository()).resolves.toBe(true);
  });

  it('returns false when git exits non-zero', async () => {
    const runner = fakeRunner(() =>
      result({
        success: false,
        exitCode: 128,
        stdout: '',
        stderr: 'fatal: not a git repository',
      }),
    );
    const service = createGitService({ workspaceRoot: '/workspace', runner });
    await expect(service.isRepository()).resolves.toBe(false);
  });

  it('exposes the detected repository root', async () => {
    const runner = fakeRunner(() =>
      result({ stdout: 'true\n/private/tmp/repo\n' }),
    );
    const service = createGitService({ workspaceRoot: '/workspace', runner });
    await expect(service.repositoryRoot()).resolves.toBe('/private/tmp/repo');
  });

  it('throws GitRepositoryError from repositoryRoot when not a repository', async () => {
    const runner = fakeRunner(() => result({ success: false, exitCode: 128 }));
    const service = createGitService({ workspaceRoot: '/workspace', runner });
    await expect(service.repositoryRoot()).rejects.toBeInstanceOf(
      GitRepositoryError,
    );
  });

  it('caches detection across repeated calls', async () => {
    const runner = fakeRunner(() => result({ stdout: 'true\n/workspace\n' }));
    const service = createGitService({ workspaceRoot: '/workspace', runner });
    await service.isRepository();
    await service.isRepository();
    await service.repositoryRoot();
    const revParseCalls = runner.calls.filter(
      (call) => call.args[0] === 'rev-parse',
    );
    expect(revParseCalls).toHaveLength(1);
  });

  it('invalidates the cached detection when requested', async () => {
    const runner = fakeRunner(() => result({ stdout: 'true\n/workspace\n' }));
    const service = createGitService({ workspaceRoot: '/workspace', runner });
    await service.isRepository();
    service.invalidateRepositoryCache();
    await service.isRepository();
    const revParseCalls = runner.calls.filter(
      (call) => call.args[0] === 'rev-parse',
    );
    expect(revParseCalls).toHaveLength(2);
  });

  it('shares a single detection across concurrent reads', async () => {
    const delay = 15;
    const runner = fakeRunner(async () => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return result({ stdout: 'true\n/workspace\n' });
    });
    const service = createGitService({ workspaceRoot: '/workspace', runner });
    const [a, b, c] = await Promise.all([
      service.isRepository(),
      service.isRepository(),
      service.isRepository(),
    ]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(c).toBe(true);
    const revParseCalls = runner.calls.filter(
      (call) => call.args[0] === 'rev-parse',
    );
    expect(revParseCalls).toHaveLength(1);
  });

  it('re-detects after a failed detection', async () => {
    let failing = true;
    const runner = fakeRunner(() => {
      if (failing) {
        failing = false;
        throw new CommandExecutionError('git not found', {
          code: 'SPAWN_FAILED',
        });
      }
      return result({ stdout: 'true\n/workspace\n' });
    });
    const service = createGitService({ workspaceRoot: '/workspace', runner });
    await expect(service.isRepository()).rejects.toBeInstanceOf(
      GitCommandError,
    );
    await expect(service.isRepository()).resolves.toBe(true);
  });
});

describe('command invocation', () => {
  const workspaceRoot = '/workspace';

  it('runs status with porcelain=v1 in the workspace root', async () => {
    const runner = fakeRunner(() => result());
    const service = createGitService({ workspaceRoot, runner });
    await service.status();
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]).toMatchObject({
      command: 'git',
      args: ['status', '--porcelain=v1'],
      cwd: workspaceRoot,
    });
  });

  it('runs diff with no arguments', async () => {
    const runner = fakeRunner(() => result());
    const service = createGitService({ workspaceRoot, runner });
    await service.diff();
    expect(runner.calls[0]!.args).toEqual(['diff']);
  });

  it('runs diff --cached', async () => {
    const runner = fakeRunner(() => result());
    const service = createGitService({ workspaceRoot, runner });
    await service.diffCached();
    expect(runner.calls[0]!.args).toEqual(['diff', '--cached']);
  });

  it('runs branch --show-current', async () => {
    const runner = fakeRunner(() => result({ stdout: 'main\n' }));
    const service = createGitService({ workspaceRoot, runner });
    await expect(service.currentBranch()).resolves.toBe('main');
    expect(runner.calls[0]!.args).toEqual(['branch', '--show-current']);
  });

  it('runs branch --format for the branch list', async () => {
    const runner = fakeRunner(() =>
      result({ stdout: '*\u0000main\u0000abc1234\n' }),
    );
    const service = createGitService({ workspaceRoot, runner });
    const branches = await service.branches();
    expect(branches).toEqual([
      { isCurrent: true, name: 'main', shortHash: 'abc1234' },
    ]);
    expect(runner.calls[0]!.args).toEqual([
      'branch',
      '--no-color',
      '--format=%(HEAD)%00%(refname:short)%00%(objectname:short)',
    ]);
  });

  it('runs rev-parse HEAD for the head lookup', async () => {
    const runner = fakeRunner(() => result({ stdout: `${HASH}\n` }));
    const service = createGitService({ workspaceRoot, runner });
    await expect(service.head()).resolves.toEqual({
      hash: HASH,
      shortHash: HASH.slice(0, 7),
    });
    expect(runner.calls[0]!.args).toEqual(['rev-parse', 'HEAD']);
  });

  it('runs add -- with validated paths', async () => {
    const runner = fakeRunner(() => result());
    const service = createGitService({ workspaceRoot, runner });
    await service.add(['a.txt', 'src/b.ts']);
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]!.args).toEqual(['add', '--', 'a.txt', 'src/b.ts']);
  });

  it('runs restore -- with validated paths', async () => {
    const runner = fakeRunner(() => result());
    const service = createGitService({ workspaceRoot, runner });
    await service.restore(['a.txt']);
    expect(runner.calls[0]!.args).toEqual(['restore', '--', 'a.txt']);
  });

  it('runs commit -m with the message as a single argument', async () => {
    const runner = fakeRunner((request) => {
      if (request.args[0] === 'commit') return result();
      return result({ stdout: `${HASH}\n` });
    });
    const service = createGitService({ workspaceRoot, runner });
    const commit = await service.commit('Fix the bug');
    expect(commit.hash).toBe(HASH);
    expect(runner.calls[0]!.args).toEqual(['commit', '-m', 'Fix the bug']);
    expect(runner.calls[1]!.args).toEqual(['rev-parse', 'HEAD']);
  });
});

describe('validation wiring', () => {
  const workspaceRoot = '/workspace';

  it('rejects absolute paths before invoking git', async () => {
    const runner = fakeRunner(() => result());
    const service = createGitService({ workspaceRoot, runner });
    await expect(service.add(['/etc/passwd'])).rejects.toBeInstanceOf(
      GitValidationError,
    );
    expect(runner.calls).toHaveLength(0);
  });

  it('rejects traversal paths before invoking git', async () => {
    const runner = fakeRunner(() => result());
    const service = createGitService({ workspaceRoot, runner });
    await expect(service.restore(['../outside'])).rejects.toBeInstanceOf(
      GitValidationError,
    );
    expect(runner.calls).toHaveLength(0);
  });

  it('rejects duplicate paths before invoking git', async () => {
    const runner = fakeRunner(() => result());
    const service = createGitService({ workspaceRoot, runner });
    await expect(service.add(['a.txt', 'a.txt'])).rejects.toBeInstanceOf(
      GitValidationError,
    );
    expect(runner.calls).toHaveLength(0);
  });

  it('rejects empty path lists before invoking git', async () => {
    const runner = fakeRunner(() => result());
    const service = createGitService({ workspaceRoot, runner });
    await expect(service.add([])).rejects.toBeInstanceOf(GitValidationError);
    expect(runner.calls).toHaveLength(0);
  });

  it('rejects an empty commit message before invoking git', async () => {
    const runner = fakeRunner(() => result());
    const service = createGitService({ workspaceRoot, runner });
    await expect(service.commit('   ')).rejects.toBeInstanceOf(
      GitValidationError,
    );
    expect(runner.calls).toHaveLength(0);
  });

  it('rejects an oversized commit message with a custom limit', async () => {
    const runner = fakeRunner(() => result());
    const service = createGitService({
      workspaceRoot,
      runner,
      maxCommitMessageLength: 10,
    });
    await expect(
      service.commit('a very long message here'),
    ).rejects.toBeInstanceOf(GitValidationError);
    expect(runner.calls).toHaveLength(0);
  });

  it('rejects a multiline commit message before invoking git', async () => {
    const runner = fakeRunner(() => result());
    const service = createGitService({ workspaceRoot, runner });
    await expect(service.commit('line one\nline two')).rejects.toBeInstanceOf(
      GitValidationError,
    );
    expect(runner.calls).toHaveLength(0);
  });

  it('rejects a message with a shell metacharacter before invoking git', async () => {
    const runner = fakeRunner(() => result());
    const service = createGitService({ workspaceRoot, runner });
    await expect(service.commit('bad & message')).rejects.toBeInstanceOf(
      GitValidationError,
    );
    expect(runner.calls).toHaveLength(0);
  });
});

describe('command failure mapping', () => {
  const workspaceRoot = '/workspace';

  it('maps a non-zero exit to GitCommandError with COMMAND_FAILED', async () => {
    const runner = fakeRunner(() =>
      result({ success: false, exitCode: 128, stderr: 'fatal: whatever' }),
    );
    const service = createGitService({ workspaceRoot, runner });
    const error = await service.status().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(GitCommandError);
    if (error instanceof GitCommandError) {
      expect(error.code).toBe(GIT_ERROR_CODES.COMMAND_FAILED);
      expect(error.exitCode).toBe(128);
      expect(error.stderr).toContain('fatal: whatever');
      expect(error.args).toEqual(['status', '--porcelain=v1']);
    }
  });

  it('maps a runner execution failure to GitCommandError', async () => {
    const runner = fakeRunner(() => {
      throw new CommandExecutionError('boom', { code: 'EXECUTION_FAILED' });
    });
    const service = createGitService({ workspaceRoot, runner });
    await expect(service.diff()).rejects.toBeInstanceOf(GitCommandError);
  });

  it('maps a spawn failure to GitCommandError with SPAWN_FAILED', async () => {
    const runner = fakeRunner(() => {
      throw new CommandExecutionError('git not found', {
        code: 'SPAWN_FAILED',
      });
    });
    const service = createGitService({ workspaceRoot, runner });
    const error = await service.add(['a.txt']).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(GitCommandError);
    if (error instanceof GitCommandError)
      expect(error.code).toBe(GIT_ERROR_CODES.SPAWN_FAILED);
  });

  it('returns null from head for a non-zero exit (unborn HEAD)', async () => {
    const runner = fakeRunner(() => result({ success: false, exitCode: 128 }));
    const service = createGitService({ workspaceRoot, runner });
    await expect(service.head()).resolves.toBeNull();
  });

  it('returns null from currentBranch for a non-zero exit', async () => {
    const runner = fakeRunner(() => result({ success: false, exitCode: 128 }));
    const service = createGitService({ workspaceRoot, runner });
    await expect(service.currentBranch()).resolves.toBeNull();
  });

  it('returns an empty branch list for a non-zero exit', async () => {
    const runner = fakeRunner(() => result({ success: false, exitCode: 128 }));
    const service = createGitService({ workspaceRoot, runner });
    await expect(service.branches()).resolves.toEqual([]);
  });

  it('throws GitCommandError from commit when HEAD is unresolvable after success', async () => {
    const runner = fakeRunner(() => result({ success: false, exitCode: 128 }));
    const service = createGitService({ workspaceRoot, runner });
    await expect(service.commit('message')).rejects.toBeInstanceOf(
      GitCommandError,
    );
  });
});

describe('parsing integration through the service', () => {
  it('returns typed status entries', async () => {
    const runner = fakeRunner(() => result({ stdout: ' M a.txt\n?? b.txt\n' }));
    const service = createGitService({ workspaceRoot: '/workspace', runner });
    const status = await service.status();
    expect(status.clean).toBe(false);
    expect(status.entries.map((entry) => entry.path)).toEqual([
      'a.txt',
      'b.txt',
    ]);
  });

  it('returns typed diff structures', async () => {
    const output = [
      'diff --git a/a.txt b/a.txt',
      'index ce01362..25bab75 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1,2 @@',
      ' hello',
      '+again',
      '',
    ].join('\n');
    const runner = fakeRunner(() => result({ stdout: output }));
    const service = createGitService({ workspaceRoot: '/workspace', runner });
    const diff = await service.diff();
    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]!.hunks[0]!.lines[1]).toEqual({
      kind: 'addition',
      content: 'again',
    });
  });

  it('changedFiles returns sorted, deduplicated paths', async () => {
    const runner = fakeRunner(() =>
      result({ stdout: 'R  old.txt -> new.txt\n M z.txt\n?? a.txt\n' }),
    );
    const service = createGitService({ workspaceRoot: '/workspace', runner });
    await expect(service.changedFiles()).resolves.toEqual([
      'a.txt',
      'new.txt',
      'old.txt',
      'z.txt',
    ]);
  });
});

describe('real git integration', () => {
  it('reports a non-repository directory', async () => {
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'devforge-git-nonrepo-'),
    );
    try {
      const service = createGitService({ workspaceRoot: dir });
      await expect(service.isRepository()).resolves.toBe(false);
      await expect(service.repositoryRoot()).rejects.toBeInstanceOf(
        GitRepositoryError,
      );
      await expect(service.status()).rejects.toBeInstanceOf(GitCommandError);
    } finally {
      await cleanup(dir);
    }
  });

  it('detects a real repository and its root', async () => {
    const dir = await initRepo();
    try {
      const service = createGitService({ workspaceRoot: dir });
      await expect(service.isRepository()).resolves.toBe(true);
      await expect(service.repositoryRoot()).resolves.toBe(
        await fs.realpath(dir),
      );
    } finally {
      await cleanup(dir);
    }
  });

  it('reports an empty status for a fresh repository', async () => {
    const dir = await initRepo();
    try {
      const service = createGitService({ workspaceRoot: dir });
      const status = await service.status();
      expect(status.clean).toBe(true);
      expect(status.entries).toEqual([]);
    } finally {
      await cleanup(dir);
    }
  });

  it('returns null head for a repository with no commits', async () => {
    const dir = await initRepo();
    try {
      const service = createGitService({ workspaceRoot: dir });
      await expect(service.head()).resolves.toBeNull();
    } finally {
      await cleanup(dir);
    }
  });

  it('reports an untracked file via status', async () => {
    const dir = await initRepo();
    try {
      await fs.writeFile(path.join(dir, 'untracked.txt'), 'x');
      const service = createGitService({ workspaceRoot: dir });
      const status = await service.status();
      expect(status.clean).toBe(false);
      expect(status.entries[0]).toMatchObject({
        path: 'untracked.txt',
        kind: 'untracked',
      });
    } finally {
      await cleanup(dir);
    }
  });

  it('add stages a file so the index reflects it', async () => {
    const dir = await initRepo();
    try {
      await fs.writeFile(path.join(dir, 'tracked.txt'), 'content');
      const service = createGitService({ workspaceRoot: dir });
      await service.add(['tracked.txt']);
      const status = await service.status();
      expect(status.entries[0]).toMatchObject({
        path: 'tracked.txt',
        indexStatus: 'A',
      });
    } finally {
      await cleanup(dir);
    }
  });

  it('commit creates a commit and returns the new HEAD', async () => {
    const dir = await initRepo();
    try {
      await fs.writeFile(path.join(dir, 'a.txt'), 'hello\n');
      const service = createGitService({ workspaceRoot: dir });
      await service.add(['a.txt']);
      const commit = await service.commit('initial commit');
      const realHead = await git(['rev-parse', 'HEAD'], dir);
      expect(commit.hash).toBe(realHead.stdout.trim());
      expect(commit.shortHash).toBe(commit.hash.slice(0, 7));
      await expect(service.head()).resolves.toEqual(commit);
    } finally {
      await cleanup(dir);
    }
  });

  it('commit rejects when there is nothing to commit', async () => {
    const dir = await initRepo();
    try {
      const service = createGitService({ workspaceRoot: dir });
      await expect(service.commit('nothing to commit')).rejects.toBeInstanceOf(
        GitCommandError,
      );
    } finally {
      await cleanup(dir);
    }
  });

  it('currentBranch returns the checked-out branch', async () => {
    const dir = await initRepo();
    try {
      await fs.writeFile(path.join(dir, 'a.txt'), 'hello\n');
      const service = createGitService({ workspaceRoot: dir });
      await service.add(['a.txt']);
      await service.commit('initial');
      await expect(service.currentBranch()).resolves.toBe('main');
    } finally {
      await cleanup(dir);
    }
  });

  it('branches lists the checked-out branch', async () => {
    const dir = await initRepo();
    try {
      await fs.writeFile(path.join(dir, 'a.txt'), 'hello\n');
      const service = createGitService({ workspaceRoot: dir });
      await service.add(['a.txt']);
      await service.commit('initial');
      const branches = await service.branches();
      expect(branches).toHaveLength(1);
      expect(branches[0]).toMatchObject({ name: 'main', isCurrent: true });
    } finally {
      await cleanup(dir);
    }
  });

  it('diff returns a typed diff for a modified file', async () => {
    const dir = await initRepo();
    try {
      await fs.writeFile(path.join(dir, 'a.txt'), 'hello\n');
      const service = createGitService({ workspaceRoot: dir });
      await service.add(['a.txt']);
      await service.commit('initial');
      await fs.appendFile(path.join(dir, 'a.txt'), 'world\n');
      const diff = await service.diff();
      expect(diff.empty).toBe(false);
      expect(diff.files[0]).toMatchObject({
        oldPath: 'a.txt',
        newPath: 'a.txt',
        status: 'modified',
      });
      expect(diff.files[0]!.hunks[0]!.lines).toContainEqual({
        kind: 'addition',
        content: 'world',
      });
    } finally {
      await cleanup(dir);
    }
  });

  it('diffCached returns a typed diff for staged changes', async () => {
    const dir = await initRepo();
    try {
      await fs.writeFile(path.join(dir, 'a.txt'), 'hello\n');
      const service = createGitService({ workspaceRoot: dir });
      await service.add(['a.txt']);
      await service.commit('initial');
      await fs.writeFile(path.join(dir, 'b.txt'), 'staged\n');
      await service.add(['b.txt']);
      const diff = await service.diffCached();
      expect(diff.files[0]).toMatchObject({
        oldPath: '/dev/null',
        newPath: 'b.txt',
        status: 'added',
      });
    } finally {
      await cleanup(dir);
    }
  });

  it('changedFiles reflects modified and untracked paths', async () => {
    const dir = await initRepo();
    try {
      await fs.writeFile(path.join(dir, 'a.txt'), 'hello\n');
      const service = createGitService({ workspaceRoot: dir });
      await service.add(['a.txt']);
      await service.commit('initial');
      await fs.appendFile(path.join(dir, 'a.txt'), 'more\n');
      await fs.writeFile(path.join(dir, 'new.txt'), 'x');
      await expect(service.changedFiles()).resolves.toEqual([
        'a.txt',
        'new.txt',
      ]);
    } finally {
      await cleanup(dir);
    }
  });

  it('restore reverts a modified file in the working tree', async () => {
    const dir = await initRepo();
    try {
      await fs.writeFile(path.join(dir, 'a.txt'), 'original\n');
      const service = createGitService({ workspaceRoot: dir });
      await service.add(['a.txt']);
      await service.commit('initial');
      await fs.writeFile(path.join(dir, 'a.txt'), 'modified\n');
      await service.restore(['a.txt']);
      await expect(fs.readFile(path.join(dir, 'a.txt'), 'utf-8')).resolves.toBe(
        'original\n',
      );
    } finally {
      await cleanup(dir);
    }
  });

  it('parses a rename from status after git mv', async () => {
    const dir = await initRepo();
    try {
      await fs.writeFile(path.join(dir, 'old.txt'), 'content\n');
      const service = createGitService({ workspaceRoot: dir });
      await service.add(['old.txt']);
      await service.commit('initial');
      await execFileAsync('git', ['mv', 'old.txt', 'new.txt'], { cwd: dir });
      const status = await service.status();
      expect(status.entries[0]).toMatchObject({
        path: 'new.txt',
        originalPath: 'old.txt',
        kind: 'renamed',
      });
    } finally {
      await cleanup(dir);
    }
  });

  it('repositoryInfo summarizes detection and live queries', async () => {
    const dir = await initRepo();
    try {
      await fs.writeFile(path.join(dir, 'a.txt'), 'hello\n');
      const service = createGitService({ workspaceRoot: dir });
      await service.add(['a.txt']);
      await service.commit('initial');
      await fs.appendFile(path.join(dir, 'a.txt'), 'more\n');
      const info = await service.repositoryInfo();
      expect(info.isRepository).toBe(true);
      expect(info.root).toBe(await fs.realpath(dir));
      expect(info.branch).toBe('main');
      expect(info.head).not.toBeNull();
      expect(info.clean).toBe(false);
      expect(info.changedFileCount).toBe(1);
    } finally {
      await cleanup(dir);
    }
  });

  it('repositoryInfo reports a clean, headless repository', async () => {
    const dir = await initRepo();
    try {
      const service = createGitService({ workspaceRoot: dir });
      const info = await service.repositoryInfo();
      expect(info).toMatchObject({
        isRepository: true,
        root: await fs.realpath(dir),
        branch: 'main',
        head: null,
        changedFileCount: 0,
        clean: true,
      });
    } finally {
      await cleanup(dir);
    }
  });

  it('renders a parsed real diff losslessly', async () => {
    const dir = await initRepo();
    try {
      await fs.writeFile(path.join(dir, 'a.txt'), 'line1\nline2\nline3\n');
      const service = createGitService({ workspaceRoot: dir });
      await service.add(['a.txt']);
      await service.commit('initial');
      await fs.writeFile(path.join(dir, 'a.txt'), 'line1\nchanged\nline3\n');
      const diff = await service.diff();
      expect(renderViaParser(diff.text)).toBe(diff.text.replace(/\n+$/, ''));
    } finally {
      await cleanup(dir);
    }
  });
});

function renderViaParser(text: string): string {
  return renderUnifiedDiff(parseGitDiff(text));
}
