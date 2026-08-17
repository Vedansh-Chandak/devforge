/**
 * @devforge/github — Pull Requests (DF-021).
 *
 * Create, update, fetch changed files, checkout PR branches, generate PR
 * descriptions, and auto-link issues. Reuses `@devforge/execution`'s
 * CommandRunner for local checkout operations and `@devforge/planner`-style
 * deterministic description generation (no model required).
 */

import { createCommandRunner } from '@devforge/execution';
import type { CommandRunner } from '@devforge/execution';
import type { GitHubClient } from './client.js';
import type {
  GitHubChangedFile,
  GitHubIssue,
  GitHubPullRequest,
  GitHubReviewState,
  RepoRef,
} from './types.js';
import { GitHubValidationError } from './errors.js';

/** Options for creating a pull request. */
export interface CreatePullRequestOptions {
  readonly title: string;
  readonly body?: string;
  readonly head: string;
  readonly base: string;
  readonly draft?: boolean;
}

/** Options for updating a pull request. */
export interface UpdatePullRequestOptions {
  readonly title?: string;
  readonly body?: string;
  readonly state?: 'open' | 'closed';
  readonly base?: string;
}

/** A generated PR description. */
export interface PullRequestDescription {
  readonly title: string;
  readonly body: string;
  /** Issue numbers auto-detected from the description, ascending. */
  readonly linkedIssues: readonly number[];
}

/** The pull requests service. */
export class PullRequestsService {
  private readonly client: GitHubClient;
  private readonly runner?: CommandRunner;

  constructor(client: GitHubClient, options: { runner?: CommandRunner; workspaceRoot?: string } = {}) {
    this.client = client;
    this.runner =
      options.runner ??
      (options.workspaceRoot
        ? createCommandRunner({ workspaceRoot: options.workspaceRoot })
        : undefined);
  }

  /** Fetch a single pull request. */
  async get(ref: RepoRef, pullNumber: number): Promise<GitHubPullRequest> {
    validateNumber(pullNumber, 'pull request number');
    const response = await this.client.get<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/pulls/${pullNumber}`,
    );
    return normalizePullRequest(response.body);
  }

  /** List pull requests. */
  async list(ref: RepoRef, options: { state?: 'open' | 'closed' | 'all'; limit?: number } = {}): Promise<readonly GitHubPullRequest[]> {
    const state = options.state ?? 'open';
    const limit = options.limit ?? 30;
    const prs: GitHubPullRequest[] = [];
    let count = 0;
    for await (const raw of this.client.paginate<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/pulls`,
      { query: { state, per_page: 100, sort: 'created', direction: 'desc' } },
    )) {
      if (count >= limit) break;
      prs.push(normalizePullRequest(raw));
      count += 1;
    }
    return prs;
  }

  /** Create a pull request. */
  async create(ref: RepoRef, options: CreatePullRequestOptions): Promise<GitHubPullRequest> {
    if (!options.title || options.title.trim().length === 0) {
      throw new GitHubValidationError('Pull request title is required');
    }
    if (!options.head || !options.base) {
      throw new GitHubValidationError('Pull request head and base branches are required');
    }
    const body: Record<string, unknown> = {
      title: options.title,
      head: options.head,
      base: options.base,
    };
    if (options.body !== undefined) body['body'] = options.body;
    if (options.draft !== undefined) body['draft'] = options.draft;
    const response = await this.client.post<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/pulls`,
      { body },
    );
    return normalizePullRequest(response.body);
  }

  /** Update a pull request. */
  async update(ref: RepoRef, pullNumber: number, options: UpdatePullRequestOptions): Promise<GitHubPullRequest> {
    validateNumber(pullNumber, 'pull request number');
    const body: Record<string, unknown> = {};
    if (options.title !== undefined) body['title'] = options.title;
    if (options.body !== undefined) body['body'] = options.body;
    if (options.state !== undefined) body['state'] = options.state;
    if (options.base !== undefined) body['base'] = options.base;
    const response = await this.client.patch<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/pulls/${pullNumber}`,
      { body },
    );
    return normalizePullRequest(response.body);
  }

  /** Fetch the changed files for a pull request. */
  async changedFiles(ref: RepoRef, pullNumber: number): Promise<readonly GitHubChangedFile[]> {
    validateNumber(pullNumber, 'pull request number');
    const files: GitHubChangedFile[] = [];
    for await (const raw of this.client.paginate<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/pulls/${pullNumber}/files`,
      { query: { per_page: 100 } },
    )) {
      files.push(normalizeChangedFile(raw));
    }
    return files;
  }

  /**
   * Check out a PR head branch into the given workspace directory.
   * Requires a runner scoped to `workspaceRoot`.
   */
  async checkout(ref: RepoRef, pullNumber: number, workspaceRoot: string, options: { directory?: string } = {}): Promise<{ directory: string; branch: string; sha: string }> {
    if (!this.runner) {
      throw new GitHubValidationError(
        'checkout requires a CommandRunner; construct PullRequestsService with workspaceRoot',
      );
    }
    const pr = await this.get(ref, pullNumber);
    const directory = options.directory ?? `${ref.name}-pr-${pullNumber}`;
    const result = await this.runner.run({
      command: 'git',
      args: ['clone', '--branch', pr.headBranch, '--single-branch', repoCloneUrl(ref, pr), directory],
      cwd: workspaceRoot,
    });
    if (!result.success) {
      throw new GitHubValidationError(`git clone (PR #${pullNumber}) failed: ${result.stderr.trim()}`);
    }
    return { directory, branch: pr.headBranch, sha: pr.headSha };
  }

  /**
   * Generate a deterministic PR title and description from the changed files.
   * No model call is required; linked issues are detected from conventional
   * prefixes in branch/file names.
   */
  generateDescription(files: readonly GitHubChangedFile[], hints: { branch?: string; title?: string; body?: string } = {}): PullRequestDescription {
    if (files.length === 0) {
      throw new GitHubValidationError('Cannot generate a description for zero changed files');
    }
    const title = hints.title ?? describeTitle(files, hints.branch);
    const body = hints.body ?? describeBody(files);
    const linkedIssues = detectIssues([hints.branch ?? '', title, body, ...files.map((f) => f.filename)]);
    return { title, body, linkedIssues };
  }

  /** Auto-link issues by appending a standard footer referencing them. */
  autoLinkIssues(description: string, issueNumbers: readonly number[]): string {
    const numbers = Array.from(new Set(issueNumbers)).sort((a, b) => a - b);
    if (numbers.length === 0) return description;
    const footer = `\n\nCloses ${numbers.map((n) => `#${n}`).join(', ')}`;
    return description.replace(/\n*$/, '') + footer;
  }

  /** Convenience: fetch PR, compute description, optionally post a review comment. */
  async describe(ref: RepoRef, pullNumber: number, options: { title?: string; branch?: string } = {}): Promise<PullRequestDescription> {
    const pr = await this.get(ref, pullNumber);
    const files = await this.changedFiles(ref, pullNumber);
    return this.generateDescription(files, { title: options.title, branch: pr.headBranch, body: pr.body ?? undefined });
  }
}

/** A reviewer state helper for building review comments on PRs. */
export function reviewHeader(pr: GitHubPullRequest, state: GitHubReviewState): string {
  return `Review of #${pr.number} (${state}) — ${pr.title}`;
}

/** Normalize a raw pull request payload. */
export function normalizePullRequest(raw: Record<string, unknown>): GitHubPullRequest {
  const base = (raw['base'] as Record<string, unknown> | null) ?? {};
  const head = (raw['head'] as Record<string, unknown> | null) ?? {};
  const userRaw = (raw['user'] as Record<string, unknown> | null) ?? null;
  const labels = Array.isArray(raw['labels'])
    ? (raw['labels'] as Record<string, unknown>[]).map((l) => ({ name: typeof l['name'] === 'string' ? l['name'] : '', ...(typeof l['color'] === 'string' ? { color: l['color'] } : {}) }))
    : [];
  return {
    id: typeof raw['id'] === 'number' ? raw['id'] : 0,
    number: typeof raw['number'] === 'number' ? raw['number'] : 0,
    title: typeof raw['title'] === 'string' ? raw['title'] : '',
    body: typeof raw['body'] === 'string' ? raw['body'] : null,
    state: raw['state'] === 'closed' ? 'closed' : 'open',
    user: userRaw ? { login: typeof userRaw['login'] === 'string' ? userRaw['login'] : '', id: typeof userRaw['id'] === 'number' ? userRaw['id'] : 0 } : null,
    labels,
    htmlUrl: typeof raw['html_url'] === 'string' ? raw['html_url'] : '',
    diffUrl: typeof raw['diff_url'] === 'string' ? raw['diff_url'] : '',
    patchUrl: typeof raw['patch_url'] === 'string' ? raw['patch_url'] : '',
    baseBranch: typeof base['ref'] === 'string' ? base['ref'] : '',
    baseSha: typeof base['sha'] === 'string' ? base['sha'] : '',
    headBranch: typeof head['ref'] === 'string' ? head['ref'] : '',
    headSha: typeof head['sha'] === 'string' ? head['sha'] : '',
    merged: raw['merged'] === true,
    mergeable: typeof raw['mergeable'] === 'boolean' ? raw['mergeable'] : null,
    changedFiles: typeof raw['changed_files'] === 'number' ? raw['changed_files'] : undefined,
    additions: typeof raw['additions'] === 'number' ? raw['additions'] : undefined,
    deletions: typeof raw['deletions'] === 'number' ? raw['deletions'] : undefined,
    createdAt: typeof raw['created_at'] === 'string' ? raw['created_at'] : undefined,
    updatedAt: typeof raw['updated_at'] === 'string' ? raw['updated_at'] : undefined,
    closedAt: typeof raw['closed_at'] === 'string' ? raw['closed_at'] : null,
    mergedAt: typeof raw['merged_at'] === 'string' ? raw['merged_at'] : null,
  };
}

function normalizeChangedFile(raw: Record<string, unknown>): GitHubChangedFile {
  const status = typeof raw['status'] === 'string' ? raw['status'] : 'modified';
  return {
    filename: typeof raw['filename'] === 'string' ? raw['filename'] : '',
    status: (['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged'] as const).includes(status as never) ? (status as GitHubChangedFile['status']) : 'modified',
    additions: typeof raw['additions'] === 'number' ? raw['additions'] : 0,
    deletions: typeof raw['deletions'] === 'number' ? raw['deletions'] : 0,
    changes: typeof raw['changes'] === 'number' ? raw['changes'] : 0,
    previousFilename: typeof raw['previous_filename'] === 'string' ? raw['previous_filename'] : undefined,
    patch: typeof raw['patch'] === 'string' ? raw['patch'] : undefined,
  };
}

function repoCloneUrl(ref: RepoRef, pr: GitHubPullRequest): string {
  return `https://github.com/${ref.owner}/${ref.name}.git`;
}

/** Deterministic title derived from files/branch. */
function describeTitle(files: readonly GitHubChangedFile[], branch?: string): string {
  if (branch && branch.length > 0) {
    const clean = branch.replace(/^feature\//, '').replace(/^fix\//, '');
    return clean.split(/[_-]/).map(capitalize).join(' ');
  }
  const names = files.map((f) => f.filename.split('/').pop() ?? f.filename);
  return names.slice(0, 3).join(', ');
}

/** Deterministic body: grouped by file status. */
function describeBody(files: readonly GitHubChangedFile[]): string {
  const sections: string[] = [];
  const byStatus = new Map<GitHubChangedFile['status'], GitHubChangedFile[]>();
  for (const file of files) {
    const list = byStatus.get(file.status) ?? [];
    list.push(file);
    byStatus.set(file.status, list);
  }
  for (const status of ['added', 'modified', 'removed', 'renamed'] as const) {
    const list = byStatus.get(status);
    if (list && list.length > 0) {
      sections.push(`**${capitalize(status)}**\n${list.map((f) => `- \`${f.filename}\``).join('\n')}`);
    }
  }
  return sections.join('\n\n');
}

/** Detect `#123` issue references. */
function detectIssues(parts: readonly string[]): readonly number[] {
  const found = new Set<number>();
  const re = /#(\d+)/g;
  for (const part of parts) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(part)) !== null) {
      const n = Number(match[1]);
      if (Number.isInteger(n) && n > 0) found.add(n);
    }
  }
  return Array.from(found).sort((a, b) => a - b);
}

function capitalize(word: string): string {
  if (word.length === 0) return word;
  return word[0]!.toUpperCase() + word.slice(1);
}

function validateNumber(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new GitHubValidationError(`${label} must be a positive integer`);
  }
}
