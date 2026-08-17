/**
 * @devforge/github — Comments (DF-021).
 *
 * Issue comments and pull request review comments. Both read and write
 * operations are pure HTTP calls through the GitHub client.
 */

import type { GitHubClient } from './client.js';
import type { GitHubComment, GitHubReviewComment, GitHubUser, RepoRef } from './types.js';
import { GitHubValidationError } from './errors.js';

/** The comments service (issue + PR review comments). */
export class CommentsService {
  private readonly client: GitHubClient;

  constructor(client: GitHubClient) {
    this.client = client;
  }

  // ── Issue comments ─────────────────────────────────────────────────────

  /** List comments on an issue. */
  async listIssueComments(ref: RepoRef, issueNumber: number): Promise<readonly GitHubComment[]> {
    validateNumber(issueNumber, 'issue number');
    const comments: GitHubComment[] = [];
    for await (const raw of this.client.paginate<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/issues/${issueNumber}/comments`,
      { query: { per_page: 100 } },
    )) {
      comments.push(normalizeComment(raw));
    }
    return comments;
  }

  /** Post a comment on an issue. */
  async createIssueComment(ref: RepoRef, issueNumber: number, body: string): Promise<GitHubComment> {
    validateNumber(issueNumber, 'issue number');
    validateBody(body);
    const response = await this.client.post<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/issues/${issueNumber}/comments`,
      { body: { body } },
    );
    return normalizeComment(response.body);
  }

  /** Update an existing issue comment. */
  async updateIssueComment(ref: RepoRef, commentId: number, body: string): Promise<GitHubComment> {
    validateNumber(commentId, 'comment id');
    validateBody(body);
    const response = await this.client.patch<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/issues/comments/${commentId}`,
      { body: { body } },
    );
    return normalizeComment(response.body);
  }

  /** Delete an issue comment. */
  async deleteIssueComment(ref: RepoRef, commentId: number): Promise<void> {
    validateNumber(commentId, 'comment id');
    await this.client.delete(`/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/issues/comments/${commentId}`);
  }

  // ── PR review comments ─────────────────────────────────────────────────

  /** List inline review comments on a pull request. */
  async listReviewComments(ref: RepoRef, pullNumber: number): Promise<readonly GitHubReviewComment[]> {
    validateNumber(pullNumber, 'pull request number');
    const comments: GitHubReviewComment[] = [];
    for await (const raw of this.client.paginate<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/pulls/${pullNumber}/comments`,
      { query: { per_page: 100 } },
    )) {
      comments.push(normalizeReviewComment(raw));
    }
    return comments;
  }

  /** Create an inline review comment on a specific diff line. */
  async createReviewComment(
    ref: RepoRef,
    pullNumber: number,
    options: {
      readonly body: string;
      readonly path: string;
      readonly line: number;
      readonly commitId: string;
    },
  ): Promise<GitHubReviewComment> {
    validateNumber(pullNumber, 'pull request number');
    validateBody(options.body);
    if (!options.path) throw new GitHubValidationError('Review comment path is required');
    if (!Number.isInteger(options.line) || options.line <= 0) {
      throw new GitHubValidationError('Review comment line must be a positive integer');
    }
    if (!options.commitId) throw new GitHubValidationError('Review comment commitId is required');
    const response = await this.client.post<Record<string, unknown>>(
      `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/pulls/${pullNumber}/comments`,
      {
        body: {
          body: options.body,
          path: options.path,
          line: options.line,
          commit_id: options.commitId,
        },
      },
    );
    return normalizeReviewComment(response.body);
  }

  /** Delete an inline review comment. */
  async deleteReviewComment(ref: RepoRef, commentId: number): Promise<void> {
    validateNumber(commentId, 'comment id');
    await this.client.delete(`/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/pulls/comments/${commentId}`);
  }
}

function normalizeComment(raw: Record<string, unknown>): GitHubComment {
  const userRaw = (raw['user'] as Record<string, unknown> | null) ?? null;
  return {
    id: typeof raw['id'] === 'number' ? raw['id'] : 0,
    body: typeof raw['body'] === 'string' ? raw['body'] : '',
    user: normalizeUser(userRaw),
    createdAt: typeof raw['created_at'] === 'string' ? raw['created_at'] : undefined,
    updatedAt: typeof raw['updated_at'] === 'string' ? raw['updated_at'] : undefined,
    htmlUrl: typeof raw['html_url'] === 'string' ? raw['html_url'] : undefined,
  };
}

function normalizeReviewComment(raw: Record<string, unknown>): GitHubReviewComment {
  const userRaw = (raw['user'] as Record<string, unknown> | null) ?? null;
  return {
    id: typeof raw['id'] === 'number' ? raw['id'] : 0,
    body: typeof raw['body'] === 'string' ? raw['body'] : '',
    path: typeof raw['path'] === 'string' ? raw['path'] : '',
    line: typeof raw['line'] === 'number' ? raw['line'] : undefined,
    position: typeof raw['position'] === 'number' ? raw['position'] : undefined,
    user: normalizeUser(userRaw),
    createdAt: typeof raw['created_at'] === 'string' ? raw['created_at'] : undefined,
    updatedAt: typeof raw['updated_at'] === 'string' ? raw['updated_at'] : undefined,
    diffHunk: typeof raw['diff_hunk'] === 'string' ? raw['diff_hunk'] : undefined,
  };
}

function normalizeUser(raw: Record<string, unknown> | null): GitHubUser | null {
  if (!raw) return null;
  return {
    login: typeof raw['login'] === 'string' ? raw['login'] : '',
    id: typeof raw['id'] === 'number' ? raw['id'] : 0,
  };
}

function validateBody(body: string): void {
  if (!body || body.trim().length === 0) {
    throw new GitHubValidationError('Comment body is required');
  }
}

function validateNumber(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new GitHubValidationError(`${label} must be a positive integer`);
  }
}
