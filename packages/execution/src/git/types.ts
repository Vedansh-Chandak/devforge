/**
 * @devforge/execution — Git subsystem types (DF-015).
 *
 * The Git subsystem is the ONLY component allowed to interact with Git.
 * It runs commands through the CommandRunner and exposes typed repository
 * operations built by the pure parser and validator modules.
 */

import type { CommandRunner } from '../command/types.js';

/** Default maximum length (characters) of a single commit message. */
export const DEFAULT_MAX_COMMIT_MESSAGE_LENGTH = 500;

/** Default maximum number of lines allowed in a commit message. */
export const DEFAULT_MAX_COMMIT_LINES = 1;

/** Categorical status of a single file reported by `git status --porcelain=v1`. */
export type GitFileStatusKind =
  | 'untracked'
  | 'ignored'
  | 'unmerged'
  | 'renamed'
  | 'copied'
  | 'added'
  | 'deleted'
  | 'typechange'
  | 'modified'
  | 'unknown';

/**
 * A single file entry from `git status --porcelain=v1`.
 *
 * `indexStatus` is the X column (staging area) and `worktreeStatus` is the
 * Y column (working tree). For renamed/copied entries `path` is the new path
 * and `originalPath` is the pre-rename path.
 */
export interface GitFileStatus {
  /** Porcelain X column: modification state in the index. */
  readonly indexStatus: string;
  /** Porcelain Y column: modification state in the working tree. */
  readonly worktreeStatus: string;
  /** The current (new) path of the file. */
  readonly path: string;
  /** The pre-rename path for renamed/copied entries. */
  readonly originalPath?: string;
  /** Derived categorical status. */
  readonly kind: GitFileStatusKind;
  readonly isUntracked: boolean;
  readonly isIgnored: boolean;
  readonly isUnmerged: boolean;
  readonly isRenamed: boolean;
  readonly isCopied: boolean;
  readonly isAdded: boolean;
  readonly isDeleted: boolean;
  readonly isModified: boolean;
  readonly isTypeChange: boolean;
}

/** Typed result of {@link GitService.status}. */
export interface GitStatus {
  /** True when the working tree and index are clean. */
  readonly clean: boolean;
  /** One entry per reported path, in git's own (path-sorted) order. */
  readonly entries: readonly GitFileStatus[];
}

export type GitDiffLineKind =
  | 'context'
  | 'addition'
  | 'deletion'
  | 'no-newline';

/** A single content line inside a diff hunk. */
export interface GitDiffLine {
  readonly kind: GitDiffLineKind;
  /** Line content without the leading `+`/`-`/` ` marker. */
  readonly content: string;
}

/** A `@@ -a,b +c,d @@` hunk block. */
export interface GitDiffHunk {
  /** The raw hunk header line, e.g. `@@ -1,3 +1,4 @@ func()`. */
  readonly header: string;
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly GitDiffLine[];
}

export type GitDiffFileStatus =
  | 'added'
  | 'deleted'
  | 'modified'
  | 'renamed'
  | 'copied';

/**
 * A single `diff --git` section. Header lines are preserved verbatim so
 * {@link renderUnifiedDiff} can reproduce the original output losslessly.
 */
export interface GitDiffFile {
  /** Old path (`--- a/...`), or `/dev/null` for added files. */
  readonly oldPath: string;
  /** New path (`+++ b/...`), or `/dev/null` for deleted files. */
  readonly newPath: string;
  readonly status: GitDiffFileStatus;
  readonly oldMode?: string;
  readonly newMode?: string;
  /** Similarity percentage for renamed/copied files. */
  readonly similarity?: number;
  readonly isBinary: boolean;
  /** Raw header block: `diff --git` through `---`/`+++` (or binary note). */
  readonly headerLines: readonly string[];
  readonly hunks: readonly GitDiffHunk[];
}

/** Typed result of {@link GitService.diff} and {@link GitService.diffCached}. */
export interface GitDiff {
  /** True when there are no differences. */
  readonly empty: boolean;
  /** The raw unified diff output as returned by git. */
  readonly text: string;
  readonly files: readonly GitDiffFile[];
}

/** A branch reported by {@link GitService.branches}. */
export interface GitBranch {
  readonly name: string;
  readonly isCurrent: boolean;
  /** Abbreviated tip hash, when git reported one. */
  readonly shortHash?: string;
}

/** A commit object identifier. */
export interface GitCommit {
  /** Full 40-character SHA-1 hash. */
  readonly hash: string;
  /** First 7 characters of the hash (stable, deterministic). */
  readonly shortHash: string;
}

/** Summary snapshot returned by {@link GitService.repositoryInfo}. */
export interface GitRepositoryInfo {
  readonly isRepository: boolean;
  /** Absolute path of the detected repository root, when applicable. */
  readonly root: string | null;
  readonly branch: string | null;
  readonly head: GitCommit | null;
  readonly changedFileCount: number;
  readonly clean: boolean;
}

/** Internal detection result produced by repository-root discovery. */
export interface GitRepositoryDetection {
  readonly isRepository: boolean;
  /** Absolute repository root, or null when not a repository. */
  readonly root: string | null;
}

/** Options accepted by {@link createGitService}. */
export interface GitServiceConfig {
  /** Absolute path of the workspace root from which git commands run. */
  readonly workspaceRoot: string;
  /**
   * Injected CommandRunner. When omitted the service creates one scoped to
   * `workspaceRoot`. Injection is how tests observe/fake command execution.
   */
  readonly runner?: CommandRunner;
  /** Maximum commit message length. @defaultValue `DEFAULT_MAX_COMMIT_MESSAGE_LENGTH` */
  readonly maxCommitMessageLength?: number;
  /** Maximum commit message line count. @defaultValue `DEFAULT_MAX_COMMIT_LINES` */
  readonly maxCommitLines?: number;
  /** Per-command timeout in milliseconds (passed through to the runner). */
  readonly timeoutMs?: number;
}

/**
 * The Git subsystem's public surface. All commands are executed through the
 * CommandRunner; validation and parsing are delegated to pure modules.
 */
export interface GitService {
  /** Absolute path of the workspace root git commands run in. */
  readonly workspaceRoot: string;
  /** Typed `git status --porcelain=v1`. */
  status(): Promise<GitStatus>;
  /** Typed `git diff` (working tree vs index). */
  diff(): Promise<GitDiff>;
  /** Typed `git diff --cached` (index vs HEAD). */
  diffCached(): Promise<GitDiff>;
  /** Sorted, deduplicated list of changed file paths. */
  changedFiles(): Promise<readonly string[]>;
  /** Current branch name, or null when detached/unborn. */
  currentBranch(): Promise<string | null>;
  /** All branches with their current/abbreviated-hash metadata. */
  branches(): Promise<readonly GitBranch[]>;
  /** HEAD commit, or null when the repository has no commits yet. */
  head(): Promise<GitCommit | null>;
  /** Stage the given paths with `git add --`. */
  add(paths: readonly string[]): Promise<void>;
  /** Restore the given paths with `git restore --`. */
  restore(paths: readonly string[]): Promise<void>;
  /** Create a commit with `git commit -m` and return the new HEAD. */
  commit(message: string): Promise<GitCommit>;
  /** Whether the workspace root lies inside a git working tree. */
  isRepository(): Promise<boolean>;
  /** Absolute repository root; throws {@link GitRepositoryError} when absent. */
  repositoryRoot(): Promise<string>;
  /** A convenience summary combining repository detection and live queries. */
  repositoryInfo(): Promise<GitRepositoryInfo>;
  /** Drop the cached repository-detection result so the next call re-detects. */
  invalidateRepositoryCache(): void;
}
