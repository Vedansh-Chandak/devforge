/**
 * @devforge/github — Issues (DF-021).
 *
 * Read, create, update, close, and link issues. Linking attaches an issue to
 * an execution session by recording the association in memory; the caller
 * decides how to persist the link (e.g. via check output or PR body).
 */

import type { GitHubClient } from './client.js';
import type { GitHubIssue, GitHubIssueState, GitHubLabel, GitHubUser, RepoRef } from './types.js';
import { GitHubValidationError } from './errors.js';

/** Options for creating an issue. */
export interface CreateIssueOptions {
  readonly title: string;
  readonly body?: string;
  readonly labels?: readonly string[];
  readonly assignees?: readonly string[];
}

/** Options for updating an issue. */
export interface UpdateIssueOptions {
  readonly title?: string;
  readonly body?: string;
  readonly state?: GitHubIssueState;
  readonly labels?: readonly string[];
  readonly assignees?: readonly string[];
}

/** An issue linked to an execution session. */
export interface LinkedIssue {
  readonly ref: RepoRef;
  readonly issue: GitHubIssue;
  readonly sessionId: string;
  readonly linkedAt: number;
}

/** The issues service. */
export class IssuesService {
  private readonly client: GitHubClient;
  /** Issues fetched or created so far, keyed by issue number. */
  private readonly registry = new Map<number, GitHubIssue>();
  private readonly links = new Map<number, LinkedIssue>();

  constructor(client: GitHubClient) {
    this.client = client;
  }

  /** Read a single issue by number. */
  async get(ref: RepoRef, issueNumber: number): Promise<GitHubIssue> {
    validateNumber(issueNumber, 'issue number');
    const response = await this.client.get<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/issues/${issueNumber}`,
    );
    const issue = normalizeIssue(response.body);
    this.registry.set(issue.number, issue);
    return issue;
  }

  /** List issues for a repository, newest first. */
  async list(ref: RepoRef, options: { state?: GitHubIssueState; limit?: number } = {}): Promise<readonly GitHubIssue[]> {
    const state = options.state ?? 'open';
    const limit = options.limit ?? 30;
    const issues: GitHubIssue[] = [];
    let count = 0;
    for await (const raw of this.client.paginate<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/issues`,
      { query: { state, per_page: 100, sort: 'created', direction: 'desc' } },
    )) {
      if (count >= limit) break;
      issues.push(normalizeIssue(raw));
      count += 1;
    }
    return issues;
  }

  /** Create an issue. */
  async create(ref: RepoRef, options: CreateIssueOptions): Promise<GitHubIssue> {
    if (!options.title || options.title.trim().length === 0) {
      throw new GitHubValidationError('Issue title is required');
    }
    const response = await this.client.post<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/issues`,
      { body: { title: options.title, ...(options.body ? { body: options.body } : {}), ...(options.labels ? { labels: options.labels } : {}), ...(options.assignees ? { assignees: options.assignees } : {}) } },
    );
    const issue = normalizeIssue(response.body);
    this.registry.set(issue.number, issue);
    return issue;
  }

  /** Update an issue. */
  async update(ref: RepoRef, issueNumber: number, options: UpdateIssueOptions): Promise<GitHubIssue> {
    validateNumber(issueNumber, 'issue number');
    const body: Record<string, unknown> = {};
    if (options.title !== undefined) body['title'] = options.title;
    if (options.body !== undefined) body['body'] = options.body;
    if (options.state !== undefined) body['state'] = options.state;
    if (options.labels !== undefined) body['labels'] = options.labels;
    if (options.assignees !== undefined) body['assignees'] = options.assignees;
    const response = await this.client.patch<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/issues/${issueNumber}`,
      { body },
    );
    const issue = normalizeIssue(response.body);
    this.registry.set(issue.number, issue);
    return issue;
  }

  /** Close an issue. */
  async close(ref: RepoRef, issueNumber: number): Promise<GitHubIssue> {
    return this.update(ref, issueNumber, { state: 'closed' });
  }

  /** Reopen a closed issue. */
  async reopen(ref: RepoRef, issueNumber: number): Promise<GitHubIssue> {
    return this.update(ref, issueNumber, { state: 'open' });
  }

  /** Link an issue to an execution session. */
  linkToSession(ref: RepoRef, issueNumber: number, sessionId: string, now: () => number = Date.now): LinkedIssue {
    validateNumber(issueNumber, 'issue number');
    if (!sessionId || sessionId.trim().length === 0) {
      throw new GitHubValidationError('sessionId is required');
    }
    const issue = this.registry.get(issueNumber);
    if (!issue) {
      throw new GitHubValidationError(`Issue #${issueNumber} must be fetched or created before linking`);
    }
    const linked: LinkedIssue = {
      ref,
      issue,
      sessionId,
      linkedAt: now(),
    };
    this.links.set(issueNumber, linked);
    return linked;
  }

  /** Record an issue in the in-memory registry (used after creation). */
  record(issue: GitHubIssue): void {
    this.registry.set(issue.number, issue);
  }

  /** List all linked issues. */
  linkedIssues(): readonly LinkedIssue[] {
    return Array.from(this.links.values()).filter((entry) => entry.sessionId.length > 0);
  }
}

/** Normalize a raw issue payload. */
export function normalizeIssue(raw: Record<string, unknown>): GitHubIssue {
  const userRaw = (raw['user'] as Record<string, unknown> | null) ?? null;
  const labels = Array.isArray(raw['labels']) ? (raw['labels'] as Record<string, unknown>[]).map(normalizeLabel) : [];
  const assignees = Array.isArray(raw['assignees']) ? (raw['assignees'] as Record<string, unknown>[]).map((u) => ({ login: typeof u['login'] === 'string' ? u['login'] : '', id: typeof u['id'] === 'number' ? u['id'] : 0 })) : [];
  const milestone = (raw['milestone'] as Record<string, unknown> | null) ?? null;
  return {
    id: typeof raw['id'] === 'number' ? raw['id'] : 0,
    number: typeof raw['number'] === 'number' ? raw['number'] : 0,
    title: typeof raw['title'] === 'string' ? raw['title'] : '',
    body: typeof raw['body'] === 'string' ? raw['body'] : null,
    state: raw['state'] === 'closed' ? 'closed' : 'open',
    user: userRaw ? { login: typeof userRaw['login'] === 'string' ? userRaw['login'] : '', id: typeof userRaw['id'] === 'number' ? userRaw['id'] : 0 } : null,
    labels,
    assignees,
    locked: raw['locked'] === true,
    comments: typeof raw['comments'] === 'number' ? raw['comments'] : 0,
    htmlUrl: typeof raw['html_url'] === 'string' ? raw['html_url'] : '',
    createdAt: typeof raw['created_at'] === 'string' ? raw['created_at'] : undefined,
    updatedAt: typeof raw['updated_at'] === 'string' ? raw['updated_at'] : undefined,
    closedAt: typeof raw['closed_at'] === 'string' ? raw['closed_at'] : null,
    pullRequest: typeof raw['pull_request'] === 'object' && raw['pull_request'] !== null,
    milestone: milestone && typeof milestone['title'] === 'string' ? { title: milestone['title'] } : null,
  };
}

function normalizeLabel(raw: Record<string, unknown>): GitHubLabel {
  return {
    name: typeof raw['name'] === 'string' ? raw['name'] : '',
    color: typeof raw['color'] === 'string' ? raw['color'] : undefined,
    description: typeof raw['description'] === 'string' ? raw['description'] : null,
  };
}

function validateNumber(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new GitHubValidationError(`${label} must be a positive integer`);
  }
}
