/**
 * Repository adapter tests (DF-021).
 *
 * Covers repository metadata, branches, commits, tags, contributors, current
 * user, PR changed files, clone/open with mocked runners, and the Repository
 * Context Engine integration.
 */

import { describe, expect, it } from 'vitest';
import {
  RepositoryAdapter,
  validateRef,
  normalizeCommit,
  normalizeUser,
  normalizeChangedFile,
} from '../src/repository.js';
import { GitHubValidationError } from '../src/errors.js';
import { makeClient, json, MockCommandRunner, MockGitService } from './helpers/mock.js';
import type { RepoRef } from '../src/types.js';

const REF: RepoRef = { owner: 'acme', name: 'widget' };

function repoPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 7,
    full_name: 'acme/widget',
    owner: { login: 'acme', id: 70 },
    name: 'widget',
    description: 'Widgets',
    private: false,
    fork: false,
    html_url: 'https://github.com/acme/widget',
    clone_url: 'https://github.com/acme/widget.git',
    ssh_url: 'git@github.com:acme/widget.git',
    default_branch: 'main',
    language: 'TypeScript',
    ...overrides,
  };
}

const commitPayload = {
  sha: '0123456789abcdef0123456789abcdef01234567',
  commit: {
    message: 'Add tests',
    author: { name: 'Ada', email: 'ada@example.com', date: '2026-01-01T00:00:00Z' },
    committer: { name: 'Ada', email: 'ada@example.com', date: '2026-01-01T00:00:00Z' },
  },
  author: { login: 'ada', id: 1 },
};

describe('RepositoryAdapter metadata', () => {
  it('fetches repository metadata', async () => {
    const { client } = makeClient({ '/repos/acme/widget': json(repoPayload()) });
    const adapter = new RepositoryAdapter({ client, workspaceRoot: '/ws' });
    const repo = await adapter.metadata(REF);
    expect(repo.defaultBranch).toBe('main');
    expect(repo.cloneUrl).toBe('https://github.com/acme/widget.git');
    expect(repo.owner.login).toBe('acme');
  });

  it('returns the default branch', async () => {
    const { client } = makeClient({ '/repos/acme/widget': json(repoPayload({ default_branch: 'develop' })) });
    const adapter = new RepositoryAdapter({ client, workspaceRoot: '/ws' });
    expect(await adapter.defaultBranch(REF)).toBe('develop');
  });

  it('lists branches via pagination', async () => {
    const { client } = makeClient({
      '/repos/acme/widget/branches?per_page=100': json([
        { name: 'main', commit: { sha: 'aaa' }, protected: true },
        { name: 'dev', commit: { sha: 'bbb' }, protected: false },
      ]),
    });
    const adapter = new RepositoryAdapter({ client, workspaceRoot: '/ws' });
    const branches = await adapter.branches(REF);
    expect(branches).toHaveLength(2);
    expect(branches[0]?.protected).toBe(true);
    expect(branches[1]?.name).toBe('dev');
  });

  it('lists contributors sorted by contribution count descending', async () => {
    const { client } = makeClient({
      '/repos/acme/widget/contributors?per_page=100': json([
        { login: 'ada', id: 1, contributions: 3 },
        { login: 'bob', id: 2, contributions: 9 },
        { login: 'carol', id: 3, contributions: 5 },
      ]),
    });
    const adapter = new RepositoryAdapter({ client, workspaceRoot: '/ws' });
    const contributors = await adapter.contributors(REF);
    expect(contributors.map((c) => c.login)).toEqual(['bob', 'carol', 'ada']);
  });

  it('fetches the current user', async () => {
    const { client } = makeClient({ '/user': json({ login: 'ada', id: 1, html_url: 'https://github.com/ada' }) });
    const adapter = new RepositoryAdapter({ client, workspaceRoot: '/ws' });
    const user = await adapter.currentUser();
    expect(user.login).toBe('ada');
    expect(user.url).toBe('https://github.com/ada');
  });
});

describe('RepositoryAdapter commits & tags', () => {
  it('lists commits up to the configured limit', async () => {
    const { client } = makeClient({
      '/repos/acme/widget/commits?sha=HEAD&per_page=100': json([commitPayload, commitPayload]),
    });
    const adapter = new RepositoryAdapter({ client, workspaceRoot: '/ws' });
    const commits = await adapter.commits(REF, { limit: 10 });
    expect(commits).toHaveLength(2);
    expect(commits[0]?.shortSha).toBe('0123456');
    expect(commits[0]?.authorName).toBe('Ada');
    expect(commits[0]?.authorLogin).toBe('ada');
  });

  it('respects a one-commit limit', async () => {
    const { client } = makeClient({
      '/repos/acme/widget/commits?sha=HEAD&per_page=100': json([commitPayload, commitPayload]),
    });
    const adapter = new RepositoryAdapter({ client, workspaceRoot: '/ws' });
    const commits = await adapter.commits(REF, { limit: 1 });
    expect(commits).toHaveLength(1);
  });

  it('lists tags', async () => {
    const { client } = makeClient({
      '/repos/acme/widget/tags?per_page=100': json([
        { name: 'v1.0.0', commit: { sha: 'cafef00d' } },
        { name: 'v1.0.1', commit: { sha: 'deadbeef' } },
      ]),
    });
    const adapter = new RepositoryAdapter({ client, workspaceRoot: '/ws' });
    const tags = await adapter.tags(REF);
    expect(tags[0]).toEqual({ name: 'v1.0.0', sha: 'cafef00d' });
  });
});

describe('RepositoryAdapter changed files', () => {
  it('fetches pull request files', async () => {
    const { client } = makeClient({
      '/repos/acme/widget/pulls/9/files?per_page=100': json([
        { filename: 'a.ts', status: 'modified', additions: 2, deletions: 1, changes: 3, patch: '@@ -1 +1 @@\n-x\n+y\n' },
      ]),
    });
    const adapter = new RepositoryAdapter({ client, workspaceRoot: '/ws' });
    const files = await adapter.pullRequestFiles(REF, 9);
    expect(files[0]?.filename).toBe('a.ts');
    expect(files[0]?.status).toBe('modified');
    expect(files[0]?.patch).toContain('@@ -1 +1 @@');
  });
});

describe('RepositoryAdapter clone & open', () => {
  it('clones a repository and reports the local layout', async () => {
    const runner = new MockCommandRunner([{ stdout: '', stderr: '', exitCode: 0 }]);
    const { client } = makeClient({ '/repos/acme/widget': json(repoPayload()) });
    const adapter = new RepositoryAdapter({ client, workspaceRoot: '/ws', runner });
    const local = await adapter.clone(REF);
    expect(local.path).toBe('/ws/widget');
    expect(local.defaultBranch).toBe('main');
    expect(local.checkoutBranch).toBe('main');
    expect(runner.calls[0]?.args).toEqual(['clone', 'https://github.com/acme/widget.git', 'widget']);
  });

  it('applies shallow clone and branch checkout options', async () => {
    const runner = new MockCommandRunner([
      { exitCode: 0 },
      { exitCode: 0 },
    ]);
    const { client } = makeClient({ '/repos/acme/widget': json(repoPayload()) });
    const adapter = new RepositoryAdapter({ client, workspaceRoot: '/ws', runner });
    await adapter.clone(REF, { branch: 'develop', shallow: true, directory: 'w' });
    expect(runner.calls[0]?.args).toEqual(['clone', '--depth', '1', 'https://github.com/acme/widget.git', 'w']);
    expect(runner.calls[1]?.args).toEqual(['checkout', 'develop']);
    expect(runner.calls[1]?.cwd).toBe('/ws/w');
  });

  it('throws when the clone fails', async () => {
    const runner = new MockCommandRunner([{ stderr: 'fatal: could not connect', exitCode: 128 }]);
    const { client } = makeClient({ '/repos/acme/widget': json(repoPayload()) });
    const adapter = new RepositoryAdapter({ client, workspaceRoot: '/ws', runner });
    await expect(adapter.clone(REF)).rejects.toBeInstanceOf(GitHubValidationError);
  });

  it('throws when the branch checkout fails', async () => {
    const runner = new MockCommandRunner([
      { exitCode: 0 },
      { stderr: 'error: pathspec develop did not match', exitCode: 128 },
    ]);
    const { client } = makeClient({ '/repos/acme/widget': json(repoPayload()) });
    const adapter = new RepositoryAdapter({ client, workspaceRoot: '/ws', runner });
    await expect(adapter.clone(REF, { branch: 'develop' })).rejects.toBeInstanceOf(GitHubValidationError);
  });

  it('opens an existing local repository', async () => {
    const git = new MockGitService();
    git.currentBranchName = 'release/1.x';
    const { client } = makeClient();
    const adapter = new RepositoryAdapter({ client, workspaceRoot: '/ws', git });
    const local = await adapter.open(REF, '/ws/widget');
    expect(local.path).toBe('/ws/widget');
    expect(local.checkoutBranch).toBe('release/1.x');
    expect(local.defaultBranch).toBe('release/1.x');
  });

  it('requires a workspace root', () => {
    const { client } = makeClient();
    expect(() => new RepositoryAdapter({ client, workspaceRoot: '' })).toThrow(GitHubValidationError);
  });
});

describe('RepositoryAdapter context engine integration', () => {
  it('indexes files into the Repository Context Engine', () => {
    const { client } = makeClient();
    const adapter = new RepositoryAdapter({ client, workspaceRoot: '/ws' });
    adapter.indexFromContents(new Map([['a.ts', 'export const x = 1;']]));
    expect(adapter.contextEngine).toBeDefined();
  });

  it('returns null when indexing a nonexistent directory', async () => {
    const { client } = makeClient();
    const adapter = new RepositoryAdapter({ client, workspaceRoot: '/ws' });
    const context = await adapter.indexLocal('/does/not/exist');
    expect(context).toBeNull();
  });
});

describe('validateRef & normalizers', () => {
  it('rejects missing owner/name', () => {
    expect(() => validateRef({ owner: '', name: 'x' })).toThrow(GitHubValidationError);
    expect(() => validateRef({ owner: 'x', name: '' })).toThrow(GitHubValidationError);
    expect(() => validateRef(null as never)).toThrow(GitHubValidationError);
  });

  it('accepts a valid ref', () => {
    expect(() => validateRef(REF)).not.toThrow();
  });

  it('normalizes a commit with partial data', () => {
    const commit = normalizeCommit({ sha: 'abc1234' });
    expect(commit.shortSha).toBe('abc1234');
    expect(commit.authorName).toBeNull();
    expect(commit.message).toBe('');
  });

  it('normalizes a user with partial data', () => {
    const user = normalizeUser({ login: 'zed' });
    expect(user.id).toBe(0);
    expect(user.type).toBeUndefined();
  });

  it('normalizes a changed file, defaulting unknown statuses', () => {
    const file = normalizeChangedFile({ filename: 'x', status: 'weird', additions: 1 });
    expect(file.status).toBe('modified');
    expect(file.previousFilename).toBeUndefined();
  });
});