/**
 * Comments service tests (DF-021).
 *
 * Covers issue comments (list/create/update/delete) and PR review comments
 * (list/create/delete) including input validation.
 */

import { describe, expect, it } from 'vitest';
import { CommentsService } from '../src/comments.js';
import { GitHubValidationError } from '../src/errors.js';
import { makeClient, json } from './helpers/mock.js';
import type { RepoRef } from '../src/types.js';

const REF: RepoRef = { owner: 'acme', name: 'widget' };

function commentPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    body: 'Nice work',
    user: { login: 'ada', id: 1 },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    html_url: 'https://github.com/acme/widget/issues/5#issuecomment-1',
    ...overrides,
  };
}

describe('CommentsService issue comments', () => {
  it('lists comments on an issue', async () => {
    const { client, fetch } = makeClient({
      '/repos/acme/widget/issues/5/comments?per_page=100': json([commentPayload(), commentPayload({ id: 2, body: 'Second' })]),
    });
    const service = new CommentsService(client);
    const comments = await service.listIssueComments(REF, 5);
    expect(comments).toHaveLength(2);
    expect(fetch.requests[0]?.url).toContain('issues/5/comments');
  });

  it('creates an issue comment with a JSON body', async () => {
    const { client, fetch } = makeClient({
      '/repos/acme/widget/issues/5/comments': json(commentPayload({ id: 10 })),
    });
    const service = new CommentsService(client);
    const comment = await service.createIssueComment(REF, 5, 'Hello');
    expect(comment.id).toBe(10);
    const body = JSON.parse(fetch.lastRequest()?.body ?? '{}') as Record<string, unknown>;
    expect(body).toEqual({ body: 'Hello' });
  });

  it('updates an existing issue comment', async () => {
    const { client, fetch } = makeClient({
      '/repos/acme/widget/issues/comments/10': json(commentPayload({ body: 'Edited' })),
    });
    const service = new CommentsService(client);
    await service.updateIssueComment(REF, 10, 'Edited');
    expect(fetch.lastRequest()?.method).toBe('PATCH');
  });

  it('deletes an issue comment', async () => {
    const { client, fetch } = makeClient({ '/repos/acme/widget/issues/comments/10': { status: 204 } });
    const service = new CommentsService(client);
    await service.deleteIssueComment(REF, 10);
    expect(fetch.lastRequest()?.method).toBe('DELETE');
  });

  it('rejects empty comment bodies', async () => {
    const { client } = makeClient();
    const service = new CommentsService(client);
    await expect(service.createIssueComment(REF, 5, '   ')).rejects.toBeInstanceOf(GitHubValidationError);
  });

  it('rejects invalid issue numbers', async () => {
    const { client } = makeClient();
    const service = new CommentsService(client);
    await expect(service.listIssueComments(REF, 0)).rejects.toBeInstanceOf(GitHubValidationError);
    await expect(service.createIssueComment(REF, -2, 'x')).rejects.toBeInstanceOf(GitHubValidationError);
  });
});

describe('CommentsService review comments', () => {
  const reviewPayload = {
    id: 20,
    body: 'Move this above the guard',
    path: 'src/a.ts',
    line: 12,
    commit_id: 'abc123',
    user: { login: 'ada', id: 1 },
    diff_hunk: '@@ -10,3 +12,4 @@',
  };

  it('lists inline review comments on a PR', async () => {
    const { client } = makeClient({
      '/repos/acme/widget/pulls/42/comments?per_page=100': json([reviewPayload]),
    });
    const service = new CommentsService(client);
    const comments = await service.listReviewComments(REF, 42);
    expect(comments[0]?.path).toBe('src/a.ts');
    expect(comments[0]?.line).toBe(12);
    expect(comments[0]?.diffHunk).toContain('@@ -10,3');
  });

  it('creates an inline review comment anchored to a line', async () => {
    const { client, fetch } = makeClient({
      '/repos/acme/widget/pulls/42/comments': json(reviewPayload),
    });
    const service = new CommentsService(client);
    const comment = await service.createReviewComment(REF, 42, {
      body: 'suggestion',
      path: 'src/a.ts',
      line: 12,
      commitId: 'abc123',
    });
    expect(comment.id).toBe(20);
    const body = JSON.parse(fetch.lastRequest()?.body ?? '{}') as Record<string, unknown>;
    expect(body['line']).toBe(12);
    expect(body['commit_id']).toBe('abc123');
    expect(body['path']).toBe('src/a.ts');
  });

  it('validates review comment inputs', async () => {
    const { client } = makeClient();
    const service = new CommentsService(client);
    await expect(service.createReviewComment(REF, 42, { body: '', path: 'p', line: 1, commitId: 'c' })).rejects.toBeInstanceOf(GitHubValidationError);
    await expect(service.createReviewComment(REF, 42, { body: 'ok', path: '', line: 1, commitId: 'c' })).rejects.toBeInstanceOf(GitHubValidationError);
    await expect(service.createReviewComment(REF, 42, { body: 'ok', path: 'p', line: 0, commitId: 'c' })).rejects.toBeInstanceOf(GitHubValidationError);
    await expect(service.createReviewComment(REF, 42, { body: 'ok', path: 'p', line: 1, commitId: '' })).rejects.toBeInstanceOf(GitHubValidationError);
  });

  it('deletes an inline review comment', async () => {
    const { client, fetch } = makeClient({ '/repos/acme/widget/pulls/comments/20': { status: 204 } });
    const service = new CommentsService(client);
    await service.deleteReviewComment(REF, 20);
    expect(fetch.lastRequest()?.method).toBe('DELETE');
    expect(fetch.lastRequest()?.url).toContain('pulls/comments/20');
  });
});