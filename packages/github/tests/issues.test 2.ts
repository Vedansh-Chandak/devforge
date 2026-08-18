/**
 * Issues service tests (DF-021).
 *
 * Covers read/list/create/update/close/reopen, session linking, input
 * validation, and payload normalization. All network interactions use the
 * deterministic MockFetch.
 */

import { describe, expect, it } from 'vitest';
import { IssuesService, normalizeIssue } from '../src/issues.js';
import { GitHubValidationError } from '../src/errors.js';
import { makeClient, json } from './helpers/mock.js';
import type { RepoRef } from '../src/types.js';

const REF: RepoRef = { owner: 'acme', name: 'widget' };

function issuePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 101,
    number: 5,
    title: 'Fix the thing',
    body: 'Details here',
    state: 'open',
    user: { login: 'alice', id: 1 },
    labels: [{ name: 'bug', color: 'd73a4a' }],
    assignees: [{ login: 'bob', id: 2 }],
    locked: false,
    comments: 3,
    html_url: 'https://github.com/acme/widget/issues/5',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    closed_at: null,
    milestone: null,
    ...overrides,
  };
}

describe('IssuesService get/list', () => {
  it('reads a single issue and normalizes it', async () => {
    const { client } = makeClient({ '/repos/acme/widget/issues/5': json(issuePayload()) });
    const service = new IssuesService(client);
    const issue = await service.get(REF, 5);
    expect(issue.number).toBe(5);
    expect(issue.title).toBe('Fix the thing');
    expect(issue.user?.login).toBe('alice');
    expect(issue.labels[0]?.name).toBe('bug');
    expect(issue.state).toBe('open');
    expect(issue.pullRequest).toBe(false);
  });

  it('lists issues with pagination until the limit', async () => {
    const { client, fetch } = makeClient({
      '/repos/acme/widget/issues?state=open&per_page=100&sort=created&direction=desc': json(
        [issuePayload({ number: 1 }), issuePayload({ number: 2 })],
        { headers: { link: '<https://api.github.com/repos/acme/widget/issues?page=2&state=open&per_page=100&sort=created&direction=desc>; rel="next"' } },
      ),
      '/repos/acme/widget/issues?page=2&state=open&per_page=100&sort=created&direction=desc': json(
        [issuePayload({ number: 3 })],
      ),
    });
    const service = new IssuesService(client);
    const issues = await service.list(REF, { limit: 2 });
    expect(issues.map((i) => i.number)).toEqual([1, 2]);
    expect(fetch.requests).toHaveLength(2);
  });

  it('lists closed issues when requested', async () => {
    const { client, fetch } = makeClient({
      '/repos/acme/widget/issues?state=closed&per_page=100&sort=created&direction=desc': json(
        [issuePayload({ number: 9, state: 'closed', closed_at: '2026-02-01T00:00:00Z' })],
      ),
    });
    const service = new IssuesService(client);
    const issues = await service.list(REF, { state: 'closed' });
    expect(issues[0]?.state).toBe('closed');
    expect(issues[0]?.closedAt).toBe('2026-02-01T00:00:00Z');
    expect(fetch.requests[0]?.url).toContain('state=closed');
  });

  it('rejects non-positive issue numbers', async () => {
    const { client } = makeClient();
    const service = new IssuesService(client);
    await expect(service.get(REF, 0)).rejects.toBeInstanceOf(GitHubValidationError);
    await expect(service.get(REF, -3)).rejects.toBeInstanceOf(GitHubValidationError);
  });
});

describe('IssuesService create/update/close', () => {
  it('creates an issue with title, body, labels, and assignees', async () => {
    const { client, fetch } = makeClient({
      '/repos/acme/widget/issues': json(issuePayload({ number: 12 })),
    });
    const service = new IssuesService(client);
    const issue = await service.create(REF, {
      title: 'New issue',
      body: 'Body',
      labels: ['bug', 'enhancement'],
      assignees: ['alice'],
    });
    expect(issue.number).toBe(12);
    const body = JSON.parse(fetch.lastRequest()?.body ?? '{}') as Record<string, unknown>;
    expect(body['title']).toBe('New issue');
    expect(body['labels']).toEqual(['bug', 'enhancement']);
  });

  it('rejects an empty title when creating', async () => {
    const { client } = makeClient();
    const service = new IssuesService(client);
    await expect(service.create(REF, { title: '  ' })).rejects.toBeInstanceOf(GitHubValidationError);
  });

  it('updates an issue with a partial payload', async () => {
    const { client, fetch } = makeClient({
      '/repos/acme/widget/issues/5': json(issuePayload({ title: 'Renamed' })),
    });
    const service = new IssuesService(client);
    await service.update(REF, 5, { title: 'Renamed' });
    const body = JSON.parse(fetch.lastRequest()?.body ?? '{}') as Record<string, unknown>;
    expect(fetch.lastRequest()?.method).toBe('PATCH');
    expect(body).toEqual({ title: 'Renamed' });
  });

  it('closes an issue via state=closed', async () => {
    const { client, fetch } = makeClient({
      '/repos/acme/widget/issues/5': json(issuePayload({ state: 'closed' })),
    });
    const service = new IssuesService(client);
    const issue = await service.close(REF, 5);
    const body = JSON.parse(fetch.lastRequest()?.body ?? '{}') as Record<string, unknown>;
    expect(body['state']).toBe('closed');
    expect(issue.state).toBe('closed');
  });

  it('reopens a closed issue via state=open', async () => {
    const { client, fetch } = makeClient({
      '/repos/acme/widget/issues/5': json(issuePayload({ state: 'open' })),
    });
    const service = new IssuesService(client);
    const issue = await service.reopen(REF, 5);
    const body = JSON.parse(fetch.lastRequest()?.body ?? '{}') as Record<string, unknown>;
    expect(body['state']).toBe('open');
    expect(issue.state).toBe('open');
  });
});

describe('IssuesService session linking', () => {
  it('links a fetched issue to a session', async () => {
    const { client } = makeClient({
      '/repos/acme/widget/issues/5': json(issuePayload()),
    });
    const service = new IssuesService(client);
    await service.get(REF, 5);
    const linked = service.linkToSession(REF, 5, 'session-abc', () => 1234);
    expect(linked.sessionId).toBe('session-abc');
    expect(linked.ref).toEqual(REF);
    expect(linked.linkedAt).toBe(1234);
    expect(linked.issue.number).toBe(5);
    expect(service.linkedIssues()).toHaveLength(1);
  });

  it('refuses to link an issue that was never fetched', () => {
    const { client } = makeClient();
    const service = new IssuesService(client);
    expect(() => service.linkToSession(REF, 42, 's')).toThrow(GitHubValidationError);
  });

  it('refuses an empty session id', async () => {
    const { client } = makeClient({
      '/repos/acme/widget/issues/5': json(issuePayload()),
    });
    const service = new IssuesService(client);
    await service.get(REF, 5);
    expect(() => service.linkToSession(REF, 5, '')).toThrow(GitHubValidationError);
  });

  it('replaces an existing link on re-link', async () => {
    const { client } = makeClient({
      '/repos/acme/widget/issues/5': json(issuePayload()),
    });
    const service = new IssuesService(client);
    await service.get(REF, 5);
    service.linkToSession(REF, 5, 'first', () => 1);
    service.linkToSession(REF, 5, 'second', () => 2);
    expect(service.linkedIssues()).toHaveLength(1);
    expect(service.linkedIssues()[0]?.sessionId).toBe('second');
  });

  it('records an issue directly into the registry for linking', () => {
    const { client } = makeClient();
    const service = new IssuesService(client);
    service.record(normalizeIssue(issuePayload()));
    const linked = service.linkToSession(REF, 5, 's', () => 99);
    expect(linked.sessionId).toBe('s');
  });
});

describe('normalizeIssue', () => {
  it('handles minimal payloads with defaulted fields', () => {
    const issue = normalizeIssue({ id: 1, number: 2, title: 't' });
    expect(issue.body).toBeNull();
    expect(issue.state).toBe('open');
    expect(issue.user).toBeNull();
    expect(issue.labels).toEqual([]);
    expect(issue.assignees).toEqual([]);
    expect(issue.locked).toBe(false);
    expect(issue.comments).toBe(0);
    expect(issue.milestone).toBeNull();
    expect(issue.pullRequest).toBe(false);
  });

  it('detects a pull request payload', () => {
    const issue = normalizeIssue(issuePayload({ pull_request: { url: 'x' } }));
    expect(issue.pullRequest).toBe(true);
  });

  it('extracts milestone titles', () => {
    const issue = normalizeIssue(issuePayload({ milestone: { title: 'v2' } }));
    expect(issue.milestone?.title).toBe('v2');
  });

  it('normalizes closed state and closedAt', () => {
    const issue = normalizeIssue(issuePayload({ state: 'closed', closed_at: '2026-03-01T00:00:00Z' }));
    expect(issue.state).toBe('closed');
    expect(issue.closedAt).toBe('2026-03-01T00:00:00Z');
  });
});