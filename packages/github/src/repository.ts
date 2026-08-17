/**
 * @devforge/github — Repository features + Repository Adapter (DF-021).
 *
 * Bridges the GitHub REST API and local git operations into the DevForge
 * Repository Context Engine. Reuses `@devforge/context-engine` for indexing
 * and `@devforge/execution`'s CommandRunner for local git operations
 * (clone/checkout). Nothing is duplicated.
 */

import { createCommandRunner } from '@devforge/execution';
import type { CommandRunner, GitService } from '@devforge/execution';
import { createGitService } from '@devforge/execution';
import { RepositoryContextService } from '@devforge/context-engine';
import type { RepositoryContext } from '@devforge/context-engine';
import type { GitHubClient } from './client.js';
import type {
  GitHubBranch,
  GitHubChangedFile,
  GitHubCommit,
  GitHubContributor,
  GitHubRepository,
  GitHubTag,
  GitHubUser,
  RepoRef,
} from './types.js';
import { GitHubValidationError } from './errors.js';

/** Options controlling a repository clone. */
export interface CloneOptions {
  /** Branch to check out after cloning. Defaults to the default branch. */
  readonly branch?: string;
  /** Whether to perform a shallow clone (--depth 1). */
  readonly shallow?: boolean;
  /** Directory name for the clone; defaults to the repo name. */
  readonly directory?: string;
  readonly timeoutMs?: number;
}

/** A repository cloned into the local workspace. */
export interface LocalRepository {
  readonly ref: RepoRef;
  /** Absolute path of the cloned working tree. */
  readonly path: string;
  readonly defaultBranch: string;
  readonly checkoutBranch: string;
}

/** Config for the repository adapter. */
export interface RepositoryAdapterConfig {
  readonly client: GitHubClient;
  /** Absolute workspace root where clones are created. */
  readonly workspaceRoot: string;
  /** Injected CommandRunner (deterministic tests). */
  readonly runner?: CommandRunner;
  /** Injected git service (deterministic tests). */
  readonly git?: GitService;
  /** Injectable clock. */
  readonly now?: () => number;
}

/**
 * The repository adapter. Owns the single connection point between GitHub
 * and the {@link RepositoryContextService} (the Repository Context Engine).
 */
export class RepositoryAdapter {
  private readonly client: GitHubClient;
  private readonly workspaceRoot: string;
  private readonly runner: CommandRunner;
  private readonly git: GitService;
  private readonly now: () => number;
  private readonly contextService: RepositoryContextService;

  constructor(config: RepositoryAdapterConfig) {
    if (!config.workspaceRoot) {
      throw new GitHubValidationError('workspaceRoot is required');
    }
    this.client = config.client;
    this.workspaceRoot = config.workspaceRoot;
    this.runner = config.runner ?? createCommandRunner({ workspaceRoot: config.workspaceRoot });
    this.git = config.git ?? createGitService({ workspaceRoot: config.workspaceRoot, runner: this.runner });
    this.now = config.now ?? (() => Date.now());
    this.contextService = new RepositoryContextService();
  }

  get contextEngine(): RepositoryContextService {
    return this.contextService;
  }

  // ── Repository metadata ────────────────────────────────────────────────

  /** Fetch repository metadata. */
  async metadata(ref: RepoRef): Promise<GitHubRepository> {
    validateRef(ref);
    const response = await this.client.get<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}`,
    );
    return normalizeRepository(response.body);
  }

  /** Default branch name of the repository. */
  async defaultBranch(ref: RepoRef): Promise<string> {
    return (await this.metadata(ref)).defaultBranch;
  }

  /** List remote branches. */
  async branches(ref: RepoRef): Promise<readonly GitHubBranch[]> {
    validateRef(ref);
    const branches: GitHubBranch[] = [];
    for await (const branch of this.client.paginate<GitHubBranch>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/branches`,
      { query: { per_page: 100 } },
    )) {
      branches.push(branch);
    }
    return branches;
  }

  /** Commit history for the default (or given) branch. */
  async commits(ref: RepoRef, options: { sha?: string; limit?: number } = {}): Promise<readonly GitHubCommit[]> {
    validateRef(ref);
    const sha = options.sha ?? 'HEAD';
    const limit = options.limit ?? 30;
    const commits: GitHubCommit[] = [];
    let count = 0;
    for await (const raw of this.client.paginate<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/commits`,
      { query: { sha, per_page: 100 } },
    )) {
      if (count >= limit) break;
      commits.push(normalizeCommit(raw));
      count += 1;
    }
    return commits;
  }

  /** List repository tags. */
  async tags(ref: RepoRef): Promise<readonly GitHubTag[]> {
    validateRef(ref);
    const tags: GitHubTag[] = [];
    for await (const raw of this.client.paginate<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/tags`,
      { query: { per_page: 100 } },
    )) {
      if (typeof raw['name'] === 'string') {
        tags.push({ name: raw['name'], sha: typeof raw['commit'] === 'object' && raw['commit'] !== null && typeof (raw['commit'] as Record<string, unknown>)['sha'] === 'string' ? ((raw['commit'] as Record<string, unknown>)['sha'] as string) : '' });
      }
    }
    return tags;
  }

  /** List repository contributors (sorted by contribution count, desc). */
  async contributors(ref: RepoRef): Promise<readonly GitHubContributor[]> {
    validateRef(ref);
    const contributors: GitHubContributor[] = [];
    for await (const raw of this.client.paginate<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/contributors`,
      { query: { per_page: 100 } },
    )) {
      if (typeof raw['login'] === 'string') {
        contributors.push({
          login: raw['login'],
          id: typeof raw['id'] === 'number' ? raw['id'] : 0,
          contributions: typeof raw['contributions'] === 'number' ? raw['contributions'] : 0,
        });
      }
    }
    return contributors.sort((a, b) => b.contributions - a.contributions);
  }

  /** The current user (used to link sessions to issues/PRs). */
  async currentUser(): Promise<GitHubUser> {
    const response = await this.client.get<Record<string, unknown>>('/user');
    return normalizeUser(response.body);
  }

  // ── Changed files (PR / branch) ────────────────────────────────────────

  /** Changed files for a pull request. */
  async pullRequestFiles(ref: RepoRef, pullNumber: number): Promise<readonly GitHubChangedFile[]> {
    validateRef(ref);
    const files: GitHubChangedFile[] = [];
    for await (const raw of this.client.paginate<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/pulls/${pullNumber}/files`,
      { query: { per_page: 100 } },
    )) {
      files.push(normalizeChangedFile(raw));
    }
    return files;
  }

  // ── Clone / open ───────────────────────────────────────────────────────

  /** Clone a repository into the workspace root. */
  async clone(ref: RepoRef, options: CloneOptions = {}): Promise<LocalRepository> {
    validateRef(ref);
    const metadata = await this.metadata(ref);
    const directory = options.directory ?? ref.name;
    const target = `${this.workspaceRoot}/${directory}`;
    const args = ['clone'];
    if (options.shallow) args.push('--depth', '1');
    args.push(metadata.cloneUrl, directory);

    const result = await this.runner.run({
      command: 'git',
      args,
      cwd: this.workspaceRoot,
      timeoutMs: options.timeoutMs,
    });
    if (!result.success) {
      throw new GitHubValidationError(
        `git clone failed: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`}`,
      );
    }

    let checkoutBranch = metadata.defaultBranch;
    if (options.branch) {
      checkoutBranch = options.branch;
      const checkout = await this.runner.run({
        command: 'git',
        args: ['checkout', checkoutBranch],
        cwd: target,
        timeoutMs: options.timeoutMs,
      });
      if (!checkout.success) {
        throw new GitHubValidationError(
          `git checkout ${checkoutBranch} failed: ${checkout.stderr.trim()}`,
        );
      }
    }

    return { ref, path: target, defaultBranch: metadata.defaultBranch, checkoutBranch };
  }

  /** Open an existing local repository (already on disk). */
  async open(ref: RepoRef, localPath: string): Promise<LocalRepository> {
    const info = await this.git.repositoryInfo();
    const branch = (await this.git.currentBranch()) ?? 'unknown';
    return {
      ref,
      path: localPath,
      defaultBranch: branch,
      checkoutBranch: branch,
    };
  }

  // ── Repository Context Engine integration ──────────────────────────────

  /** Index a local repository with the Repository Context Engine. */
  async indexLocal(localPath: string): Promise<RepositoryContext | null> {
    try {
      const index = await this.contextService.indexRepository(localPath);
      return this.contextService.buildContext('*', { maxFiles: 10 });
    } catch {
      return null;
    }
  }

  /** Index a repository in memory from file contents. */
  indexFromContents(files: ReadonlyMap<string, string>): void {
    this.contextService.indexFromContents(files);
  }
}

/** Validate a repo reference. */
export function validateRef(ref: RepoRef): void {
  if (!ref) throw new GitHubValidationError('Repository reference is required');
  if (!ref.owner || ref.owner.trim().length === 0) {
    throw new GitHubValidationError('Repository owner is required');
  }
  if (!ref.name || ref.name.trim().length === 0) {
    throw new GitHubValidationError('Repository name is required');
  }
}

/** Normalize a raw commit payload into a typed commit. */
export function normalizeCommit(raw: Record<string, unknown>): GitHubCommit {
  const sha = typeof raw['sha'] === 'string' ? raw['sha'] : '';
  const commit = (raw['commit'] as Record<string, unknown>) ?? {};
  const author = (commit['author'] as Record<string, unknown>) ?? {};
  const message = typeof commit['message'] === 'string' ? commit['message'] : '';
  const committer = (commit['committer'] as Record<string, unknown>) ?? {};
  const authorUser = (raw['author'] as Record<string, unknown>) ?? null;
  return {
    sha,
    shortSha: sha.slice(0, 7),
    message,
    authorName: typeof author['name'] === 'string' ? author['name'] : null,
    authorEmail: typeof author['email'] === 'string' ? author['email'] : null,
    authorLogin: authorUser && typeof authorUser['login'] === 'string' ? authorUser['login'] : null,
    authoredAt: typeof author['date'] === 'string' ? author['date'] : undefined,
    committedAt: typeof committer['date'] === 'string' ? committer['date'] : undefined,
  };
}

/** Normalize a raw user payload. */
export function normalizeUser(raw: Record<string, unknown>): GitHubUser {
  return {
    login: typeof raw['login'] === 'string' ? raw['login'] : '',
    id: typeof raw['id'] === 'number' ? raw['id'] : 0,
    avatarUrl: typeof raw['avatar_url'] === 'string' ? raw['avatar_url'] : undefined,
    url: typeof raw['html_url'] === 'string' ? raw['html_url'] : undefined,
    type: typeof raw['type'] === 'string' ? raw['type'] : undefined,
  };
}

/** Normalize a raw repository payload into the typed shape. */
export function normalizeRepository(raw: Record<string, unknown>): GitHubRepository {
  const ownerRaw = (raw['owner'] as Record<string, unknown> | null) ?? null;
  return {
    id: typeof raw['id'] === 'number' ? raw['id'] : 0,
    fullName: typeof raw['full_name'] === 'string' ? raw['full_name'] : '',
    owner: ownerRaw ? normalizeUser(ownerRaw) : { login: '', id: 0 },
    name: typeof raw['name'] === 'string' ? raw['name'] : '',
    description: typeof raw['description'] === 'string' ? raw['description'] : null,
    private: raw['private'] === true,
    fork: raw['fork'] === true,
    htmlUrl: typeof raw['html_url'] === 'string' ? raw['html_url'] : '',
    cloneUrl: typeof raw['clone_url'] === 'string' ? raw['clone_url'] : '',
    sshUrl: typeof raw['ssh_url'] === 'string' ? raw['ssh_url'] : '',
    defaultBranch: typeof raw['default_branch'] === 'string' ? raw['default_branch'] : '',
    pushedAt: typeof raw['pushed_at'] === 'string' ? raw['pushed_at'] : undefined,
    createdAt: typeof raw['created_at'] === 'string' ? raw['created_at'] : undefined,
    updatedAt: typeof raw['updated_at'] === 'string' ? raw['updated_at'] : undefined,
    size: typeof raw['size'] === 'number' ? raw['size'] : undefined,
    stargazersCount: typeof raw['stargazers_count'] === 'number' ? raw['stargazers_count'] : undefined,
    forksCount: typeof raw['forks_count'] === 'number' ? raw['forks_count'] : undefined,
    openIssuesCount: typeof raw['open_issues_count'] === 'number' ? raw['open_issues_count'] : undefined,
    language: typeof raw['language'] === 'string' ? raw['language'] : undefined,
    archived: raw['archived'] === true,
    disabled: raw['disabled'] === true,
  };
}

/** Normalize a raw PR-file payload. */
export function normalizeChangedFile(raw: Record<string, unknown>): GitHubChangedFile {
  const status = typeof raw['status'] === 'string' ? raw['status'] : 'modified';
  return {
    filename: typeof raw['filename'] === 'string' ? raw['filename'] : '',
    status: normalizeFileStatus(status),
    additions: typeof raw['additions'] === 'number' ? raw['additions'] : 0,
    deletions: typeof raw['deletions'] === 'number' ? raw['deletions'] : 0,
    changes: typeof raw['changes'] === 'number' ? raw['changes'] : 0,
    previousFilename: typeof raw['previous_filename'] === 'string' ? raw['previous_filename'] : undefined,
    contentsUrl: typeof raw['contents_url'] === 'string' ? raw['contents_url'] : undefined,
    rawUrl: typeof raw['raw_url'] === 'string' ? raw['raw_url'] : undefined,
    patch: typeof raw['patch'] === 'string' ? raw['patch'] : undefined,
  };
}

function normalizeFileStatus(status: string): GitHubChangedFile['status'] {
  switch (status) {
    case 'added':
    case 'removed':
    case 'modified':
    case 'renamed':
    case 'copied':
    case 'changed':
    case 'unchanged':
      return status;
    default:
      return 'modified';
  }
}
