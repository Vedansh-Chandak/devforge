/**
 * Pull requests service tests (DF-021).
 *
 * Covers get/list/create/update, changed files, deterministic description
 * generation, issue auto-linking, checkout with a mocked runner, and review
 * header helpers.
 */

import { describe, expect, it } from 'vitest';
import { PullRequestsService, reviewHeader, normalizePullRequest } from '../src/pull-requests.js';
import { GitHubValidationError } from '../src/errors.js';
import { makeClient, json, MockCommandRunner } from './helpers/mock.js';
import type { GitHubChangedFile, RepoRef } from '../src/types.js';

const REF: RepoRef = { owner: 'acme', name: 'widget' };

function prPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    number: 42,
    title: 'Add feature',
    body: 'Implements #7',
    state: 'open',
    user: { login: 'carol', id: 9 },
    labels: [],
    html_url: 'https://github.com/acme/widget/pull/42',
    diff_url: 'https://github.com/acme/widget/pull/42.diff',
    patch_url: 'https://github.com/acme/widget/pull/42.patch',
    base: { ref: 'main', sha: 'aaaa' },
    head: { ref: 'feature/x', sha: 'bbbb' },
    merged: false,
    mergeable: true,
    changed_files: 2,
    additions: 10,
    deletions: 2,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    closed_at: null,
    merged_at: null,
    ...overrides,
  };
}

function changedFile(overrides: Partial<GitHubChangedFile> = {}): GitHubChangedFile {
  return {
    filename: 'src/app.ts',
    status: 'modified',
    additions: 4,
    deletions: 1,
    changes: 5,
    patch: '@@ -1,3 +1,4 @@\n const a = 1;\n-add();\n+add(2);\n const b = a;\n',
    ...overrides,
  };
}

describe('PullRequestsService get/list', () => {
  it('fetches a single PR and normalizes base/head', async () => {
    const { client } = makeClient({ '/repos/acme/widget/pulls/42': json(prPayload()) });
    const service = new PullRequestsService(client);
    const pr = await service.get(REF, 42);
    expect(pr.number).toBe(42);
    expect(pr.baseBranch).toBe('main');
    expect(pr.headBranch).toBe('feature/x');
    expect(pr.headSha).toBe('bbbb');
    expect(pr.mergeable).toBe(true);
  });

  it('lists PRs honoring state and limit', async () => {
    const { client, fetch } = makeClient({
      '/repos/acme/widget/pulls?state=open&per_page=100&sort=created&direction=desc': json(
        [prPayload({ number: 1 }), prPayload({ number: 2 })],
      ),
    });
    const service = new PullRequestsService(client);
    const prs = await service.list(REF);
    expect(prs.map((p) => p.number)).toEqual([1, 2]);
    expect(fetch.requests[0]?.url).toContain('state=open');
  });

  it('rejects bad PR numbers', async () => {
    const { client } = makeClient();
    const service = new PullRequestsService(client);
    await expect(service.get(REF, -1)).rejects.toBeInstanceOf(GitHubValidationError);
  });
});

describe('PullRequestsService create/update', () => {
  it('creates a PR with title, head, base, body, and draft flag', async () => {
    const { client, fetch } = makeClient({
      '/repos/acme/widget/pulls': json(prPayload({ number: 100 })),
    });
    const service = new PullRequestsService(client);
    const pr = await service.create(REF, {
      title: 'Cool feature',
      head: 'feature/cool',
      base: 'main',
      body: 'Closes #3',
      draft: true,
    });
    expect(pr.number).toBe(100);
    const body = JSON.parse(fetch.lastRequest()?.body ?? '{}') as Record<string, unknown>;
    expect(body['title']).toBe('Cool feature');
    expect(body['head']).toBe('feature/cool');
    expect(body['base']).toBe('main');
    expect(body['draft']).toBe(true);
  });

  it('rejects a PR without head or base', async () => {
    const { client } = makeClient();
    const service = new PullRequestsService(client);
    await expect(service.create(REF, { title: 'x', head: '', base: 'main' })).rejects.toBeInstanceOf(GitHubValidationError);
    await expect(service.create(REF, { title: 'x', head: 'h', base: '' })).rejects.toBeInstanceOf(GitHubValidationError);
  });

  it('updates a PR title and state', async () => {
    const { client, fetch } = makeClient({
      '/repos/acme/widget/pulls/42': json(prPayload({ title: 'Renamed' })),
    });
    const service = new PullRequestsService(client);
    await service.update(REF, 42, { title: 'Renamed', state: 'open' });
    const body = JSON.parse(fetch.lastRequest()?.body ?? '{}') as Record<string, unknown>;
    expect(fetch.lastRequest()?.method).toBe('PATCH');
    expect(body['title']).toBe('Renamed');
    expect(body['state']).toBe('open');
  });
});

describe('PullRequestsService changed files & checkout', () => {
  it('fetches changed files with pagination', async () => {
    const { client } = makeClient({
      '/repos/acme/widget/pulls/42/files?per_page=100': json([
        { filename: 'a.ts', status: 'added', additions: 1, deletions: 0, changes: 1 },
        { filename: 'b.ts', status: 'removed', additions: 0, deletions: 3, changes: 3 },
      ]),
    });
    const service = new PullRequestsService(client);
    const files = await service.changedFiles(REF, 42);
    expect(files).toHaveLength(2);
    expect(files[0]?.status).toBe('added');
    expect(files[1]?.status).toBe('removed');
  });

  it('checks out the PR head with a command runner', async () => {
    const runner = new MockCommandRunner([{ stdout: '', stderr: '', exitCode: 0 }]);
    const { client } = makeClient({ '/repos/acme/widget/pulls/42': json(prPayload()) });
    const service = new PullRequestsService(client, { runner });
    const result = await service.checkout(REF, 42, '/tmp/ws');
    expect(result.branch).toBe('feature/x');
    expect(result.sha).toBe('bbbb');
    expect(runner.calls[0]?.command).toBe('git');
    expect(runner.calls[0]?.args).toContain('--branch');
    expect(runner.calls[0]?.cwd).toBe('/tmp/ws');
  });

  it('throws when checkout has no runner configured', async () => {
    const { client } = makeClient();
    const service = new PullRequestsService(client);
    await expect(service.checkout(REF, 42, '/tmp/ws')).rejects.toBeInstanceOf(GitHubValidationError);
  });

  it('throws when the clone fails', async () => {
    const runner = new MockCommandRunner([{ stderr: 'remote: Repository not found', exitCode: 128 }]);
    const { client } = makeClient({ '/repos/acme/widget/pulls/42': json(prPayload()) });
    const service = new PullRequestsService(client, { runner });
    await expect(service.checkout(REF, 42, '/tmp/ws')).rejects.toBeInstanceOf(GitHubValidationError);
  });
});

describe('PullRequestsService description generation', () => {
  it('generates a branch-derived title and a status-grouped body', () => {
    const service = new PullRequestsService(makeClient().client);
    const files = [
      changedFile({ filename: 'src/new.ts', status: 'added', additions: 5, deletions: 0 }),
      changedFile({ filename: 'src/old.ts', status: 'removed', additions: 0, deletions: 5 }),
      changedFile({ filename: 'src/app.ts', status: 'modified' }),
    ];
    const description = service.generateDescription(files, { branch: 'feature/awesome-thing' });
    expect(description.title).toBe('Awesome Thing');
    expect(description.body).toContain('**Added**');
    expect(description.body).toContain('**Removed**');
    expect(description.body).toContain('**Modified**');
    expect(description.body).toContain('src/new.ts');
  });

  it('falls back to filenames when no branch is given', () => {
    const service = new PullRequestsService(makeClient().client);
    const files = [changedFile({ filename: 'sr/lib.ts' }), changedFile({ filename: 'sr/api.ts' }), changedFile({ filename: 'sr/db.ts' })];
    const description = service.generateDescription(files);
    expect(description.title).toBe('lib.ts, api.ts, db.ts');
  });

  it('throws for zero changed files', () => {
    const service = new PullRequestsService(makeClient().client);
    expect(() => service.generateDescription([])).toThrow(GitHubValidationError);
  });

  it('detects issue references from branch, title, and filenames', () => {
    const service = new PullRequestsService(makeClient().client);
    const files = [changedFile({ filename: 'DF-021-gh.ts' })];
    const description = service.generateDescription(files, { branch: 'fix/#12', title: 'Tweak #3 and #7' });
    expect(description.linkedIssues).toEqual([3, 7, 12]);
  });

  it('strips feature/ and fix/ prefixes from branch titles', () => {
    const service = new PullRequestsService(makeClient().client);
    const files = [changedFile()];
    expect(service.generateDescription(files, { branch: 'fix/crash-handler' }).title).toBe('Crash Handler');
    expect(service.generateDescription(files, { branch: 'feature/app-shell' }).title).toBe('App Shell');
  });

  it('prefers an explicit title hint', () => {
    const service = new PullRequestsService(makeClient().client);
    const files = [changedFile()];
    expect(service.generateDescription(files, { branch: 'feature/x', title: 'Explicit' }).title).toBe('Explicit');
  });

  it('deduplicates and sorts auto-linked issues ascending', () => {
    const service = new PullRequestsService(makeClient().client);
    const body = service.autoLinkIssues('Do the thing', [9, 3, 3, 1]);
    expect(body).toBe('Do the thing\n\nCloses #1, #3, #9');
  });

  it('returns the description unchanged when no issues are present', () => {
    const service = new PullRequestsService(makeClient().client);
    expect(service.autoLinkIssues('Plain body', [])).toBe('Plain body');
  });

  it('describe() composes get + changedFiles + generateDescription', async () => {
    const { client } = makeClient({
      '/repos/acme/widget/pulls/42': json(prPayload()),
      '/repos/acme/widget/pulls/42/files?per_page=100': json([{ filename: 'x.ts', status: 'modified', additions: 1, deletions: 1, changes: 2 }]),
    });
    const service = new PullRequestsService(client);
    const description = await service.describe(REF, 42);
    // Title is derived from the PR head branch (feature/x), body is reused.
    expect(description.title).toBe('X');
    expect(description.body).toBe('Implements #7');
    expect(description.linkedIssues).toEqual([7]);
  });
});

describe('reviewHeader & normalizePullRequest', () => {
  it('builds a review header from a PR and state', () => {
    const pr = normalizePullRequest(prPayload());
    expect(reviewHeader(pr, 'APPROVED')).toBe('Review of #42 (APPROVED) — Add feature');
  });

  it('normalizes a minimal PR payload with defaults', () => {
    const pr = normalizePullRequest({ id: 1, number: 2, title: 't' });
    expect(pr.baseBranch).toBe('');
    expect(pr.headBranch).toBe('');
    expect(pr.merged).toBe(false);
    expect(pr.mergeable).toBeNull();
    expect(pr.labels).toEqual([]);
  });

  it('detects merged and closed state', () => {
    const pr = normalizePullRequest(prPayload({ state: 'closed', merged: true, merged_at: '2026-02-01T00:00:00Z' }));
    expect(pr.state).toBe('closed');
    expect(pr.merged).toBe(true);
    expect(pr.mergedAt).toBe('2026-02-01T00:00:00Z');
  });

  it('maps unknown file statuses to modified', () => {
    const service = new PullRequestsService(makeClient().client);
    const files = [changedFile({ filename: 'src/b.ts' })];
    const description = service.generateDescription(files, { branch: 'unknown' });
    expect(description.title).toBe('Unknown');
  });
});