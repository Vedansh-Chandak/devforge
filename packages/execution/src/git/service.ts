/**
 * @devforge/execution — The GitService (DF-015).
 *
 * The ONLY subsystem allowed to interact with Git. Every command is executed
 * through the CommandRunner; input is validated by the pure validator module
 * and output is converted to typed structures by the pure parser module.
 *
 * Only the following commands are ever issued:
 *   git status --porcelain=v1
 *   git diff / git diff --cached
 *   git rev-parse --is-inside-work-tree --show-toplevel
 *   git rev-parse HEAD
 *   git branch --show-current
 *   git branch --no-color --format=...
 *   git add -- <paths>
 *   git restore -- <paths>
 *   git commit -m <message>
 *
 * No checkout, merge, rebase, reset, push, fetch, pull, or clone.
 */
import type { CommandRunner, CommandResult } from '../command/types.js';
import { createCommandRunner } from '../command/runner.js';
import {
  CommandCancellationError,
  CommandExecutionError,
  CommandSandboxError,
  CommandTimeoutError,
  CommandValidationError,
} from '../command/errors.js';
import { GIT_ERROR_CODES, type GitError } from './errors.js';
import {
  GitCommandError,
  GitRepositoryError,
  GitValidationError,
} from './errors.js';
import {
  validateCommitMessage,
  validateGitPaths,
  validateRepoRoot,
} from './validator.js';
import {
  parseCurrentBranch,
  parseGitBranches,
  parseGitDiff,
  parseGitStatus,
  parseHead,
  parseRepositoryDetection,
} from './parser.js';
import {
  DEFAULT_MAX_COMMIT_LINES,
  DEFAULT_MAX_COMMIT_MESSAGE_LENGTH,
  type GitBranch,
  type GitCommit,
  type GitDiff,
  type GitRepositoryDetection,
  type GitRepositoryInfo,
  type GitService,
  type GitServiceConfig,
  type GitStatus,
} from './types.js';

const STATUS_ARGS = ['status', '--porcelain=v1'] as const;
const BRANCH_ARGS = [
  'branch',
  '--no-color',
  '--format=%(HEAD)%00%(refname:short)%00%(objectname:short)',
] as const;
const DETECTION_ARGS = [
  'rev-parse',
  '--is-inside-work-tree',
  '--show-toplevel',
] as const;

/** Concrete implementation returned by {@link createGitService}. */
export class GitServiceImpl implements GitService {
  readonly workspaceRoot: string;

  private readonly runner: CommandRunner;
  private readonly maxCommitMessageLength: number;
  private readonly maxCommitLines: number;
  private readonly timeoutMs: number | undefined;

  /**
   * In-flight or completed repository detection. Cached so repeated and
   * concurrent detection requests share a single git invocation. Cleared by
   * {@link invalidateRepositoryCache}.
   */
  private detectionCache: Promise<GitRepositoryDetection> | null = null;

  constructor(config: GitServiceConfig) {
    const rootCheck = validateRepoRoot(config.workspaceRoot);
    if (!rootCheck.ok) {
      throw new GitRepositoryError(rootCheck.reason, {
        code: GIT_ERROR_CODES.INVALID_REPOSITORY_ROOT,
      });
    }
    this.workspaceRoot = config.workspaceRoot;
    this.runner =
      config.runner ??
      createCommandRunner({ workspaceRoot: config.workspaceRoot });
    this.maxCommitMessageLength =
      config.maxCommitMessageLength ?? DEFAULT_MAX_COMMIT_MESSAGE_LENGTH;
    this.maxCommitLines = config.maxCommitLines ?? DEFAULT_MAX_COMMIT_LINES;
    this.timeoutMs = config.timeoutMs;
  }

  // ── Reads ───────────────────────────────────────────────────────────────

  async status(): Promise<GitStatus> {
    const result = await this.runGit(STATUS_ARGS);
    this.expectSuccess(result, STATUS_ARGS);
    return parseGitStatus(result.stdout);
  }

  async diff(): Promise<GitDiff> {
    const args = ['diff'];
    const result = await this.runGit(args);
    this.expectSuccess(result, args);
    return parseGitDiff(result.stdout);
  }

  async diffCached(): Promise<GitDiff> {
    const args = ['diff', '--cached'];
    const result = await this.runGit(args);
    this.expectSuccess(result, args);
    return parseGitDiff(result.stdout);
  }

  async changedFiles(): Promise<readonly string[]> {
    const status = await this.status();
    const paths = new Set<string>();
    for (const entry of status.entries) {
      paths.add(entry.path);
      if (entry.originalPath !== undefined) paths.add(entry.originalPath);
    }
    return [...paths].sort();
  }

  async currentBranch(): Promise<string | null> {
    const result = await this.runGit(['branch', '--show-current'], {
      allowFailure: true,
    });
    if (result.exitCode !== 0) return null;
    return parseCurrentBranch(result.stdout);
  }

  async branches(): Promise<readonly GitBranch[]> {
    const result = await this.runGit(BRANCH_ARGS, { allowFailure: true });
    if (result.exitCode !== 0) return [];
    return parseGitBranches(result.stdout);
  }

  async head(): Promise<GitCommit | null> {
    const result = await this.runGit(['rev-parse', 'HEAD'], {
      allowFailure: true,
    });
    if (result.exitCode !== 0 || result.stdout.trim() === '') return null;
    return parseHead(result.stdout);
  }

  // ── Mutations ───────────────────────────────────────────────────────────

  async add(paths: readonly string[]): Promise<void> {
    const validation = validateGitPaths(paths, this.workspaceRoot);
    if (!validation.ok) {
      throw new GitValidationError(validation.reason, {
        code: validation.code,
        path: validation.path,
      });
    }
    const args = ['add', '--', ...validation.paths];
    const result = await this.runGit(args);
    this.expectSuccess(result, args);
  }

  async restore(paths: readonly string[]): Promise<void> {
    const validation = validateGitPaths(paths, this.workspaceRoot);
    if (!validation.ok) {
      throw new GitValidationError(validation.reason, {
        code: validation.code,
        path: validation.path,
      });
    }
    const args = ['restore', '--', ...validation.paths];
    const result = await this.runGit(args);
    this.expectSuccess(result, args);
  }

  async commit(message: string): Promise<GitCommit> {
    const validation = validateCommitMessage(message, {
      maxLength: this.maxCommitMessageLength,
      maxLines: this.maxCommitLines,
    });
    if (!validation.ok) {
      throw new GitValidationError(validation.reason, {
        code: validation.code,
      });
    }
    const args = ['commit', '-m', message];
    const result = await this.runGit(args);
    this.expectSuccess(result, args);
    const commit = await this.head();
    if (commit === null) {
      throw new GitCommandError(
        'Commit succeeded but HEAD could not be resolved',
        {
          code: GIT_ERROR_CODES.COMMAND_FAILED,
          args,
        },
      );
    }
    return commit;
  }

  // ── Repository detection ────────────────────────────────────────────────

  async isRepository(): Promise<boolean> {
    return (await this.detectRepository()).isRepository;
  }

  async repositoryRoot(): Promise<string> {
    const detection = await this.detectRepository();
    if (!detection.isRepository || detection.root === null) {
      throw new GitRepositoryError('Not a git repository', {
        code: GIT_ERROR_CODES.NOT_A_REPOSITORY,
      });
    }
    return detection.root;
  }

  async repositoryInfo(): Promise<GitRepositoryInfo> {
    const detection = await this.detectRepository();
    if (!detection.isRepository) {
      return {
        isRepository: false,
        root: null,
        branch: null,
        head: null,
        changedFileCount: 0,
        clean: true,
      };
    }
    const [branch, head, status] = await Promise.all([
      this.currentBranch(),
      this.head(),
      this.status().catch(() => null),
    ]);
    const entries = status?.entries ?? [];
    return {
      isRepository: true,
      root: detection.root,
      branch,
      head,
      changedFileCount: entries.length,
      clean: status?.clean ?? true,
    };
  }

  invalidateRepositoryCache(): void {
    this.detectionCache = null;
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private detectRepository(): Promise<GitRepositoryDetection> {
    if (this.detectionCache !== null) return this.detectionCache;
    const promise = this.performDetection();
    this.detectionCache = promise;
    promise.catch(() => {
      if (this.detectionCache === promise) this.detectionCache = null;
    });
    return promise;
  }

  private async performDetection(): Promise<GitRepositoryDetection> {
    const result = await this.runGit(DETECTION_ARGS, { allowFailure: true });
    if (result.exitCode !== 0) {
      return { isRepository: false, root: null };
    }
    return parseRepositoryDetection(result.stdout);
  }

  private async runGit(
    args: readonly string[],
    options: { readonly allowFailure?: boolean } = {},
  ): Promise<CommandResult> {
    try {
      return await this.runner.run({
        command: 'git',
        args,
        cwd: this.workspaceRoot,
        allowFailure: options.allowFailure ?? false,
        timeoutMs: this.timeoutMs,
      });
    } catch (error) {
      throw this.mapRunnerError(error);
    }
  }

  private mapRunnerError(error: unknown): GitError {
    if (error instanceof CommandValidationError) {
      return new GitValidationError(error.message, {
        code: GIT_ERROR_CODES.INVALID_PATH,
        cause: error,
      });
    }
    if (error instanceof CommandSandboxError) {
      return new GitRepositoryError(error.message, {
        code: GIT_ERROR_CODES.EXTERNAL_CWD,
        cause: error,
      });
    }
    if (error instanceof CommandTimeoutError) {
      return new GitCommandError(error.message, {
        code: GIT_ERROR_CODES.TIMEOUT,
        cause: error,
      });
    }
    if (error instanceof CommandCancellationError) {
      return new GitCommandError(error.message, {
        code: GIT_ERROR_CODES.CANCELLED,
        cause: error,
      });
    }
    if (error instanceof CommandExecutionError) {
      return new GitCommandError(error.message, {
        code:
          error.code === 'SPAWN_FAILED'
            ? GIT_ERROR_CODES.SPAWN_FAILED
            : GIT_ERROR_CODES.COMMAND_FAILED,
        cause: error,
      });
    }
    if (error instanceof Error) {
      return new GitCommandError(error.message, { cause: error });
    }
    return new GitCommandError(String(error));
  }

  private expectSuccess(result: CommandResult, args: readonly string[]): void {
    if (result.timedOut) {
      throw new GitCommandError('git command timed out', {
        code: GIT_ERROR_CODES.TIMEOUT,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        command: 'git',
        args,
      });
    }
    if (result.cancelled) {
      throw new GitCommandError('git command was cancelled', {
        code: GIT_ERROR_CODES.CANCELLED,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        command: 'git',
        args,
      });
    }
    if (result.exitCode !== 0) {
      const detail =
        result.stderr.trim() !== '' ? `: ${result.stderr.trim()}` : '';
      throw new GitCommandError(
        `git failed with exit code ${result.exitCode}${detail}`,
        {
          code: GIT_ERROR_CODES.COMMAND_FAILED,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          command: 'git',
          args,
        },
      );
    }
  }
}

/**
 * Create a {@link GitService}. A CommandRunner is created scoped to
 * `workspaceRoot` unless one is injected.
 */
export function createGitService(config: GitServiceConfig): GitService {
  return new GitServiceImpl(config);
}
