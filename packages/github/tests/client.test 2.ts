/**
 * GitHubClient tests (DF-021).
 *
 * Covers request shaping (paths, query encoding, auth headers, JSON bodies),
 * typed error mapping (404/409/429/rate-limit), retry/backoff behavior,
 * timeouts, network failures, and Link-header pagination. Every test uses a
 * deterministic MockFetch; retry loops never sleep in wall-clock time because
 * transient statuses are exercised with small, deterministic counts.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  GitHubApiError,
  GitHubConflictError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  GitHubTimeoutError,
  GitHubNetworkError,
} from '../src/errors.js';
import { createClient } from './helpers/mock.js';
import { FakeResponse, MockFetch, json, patCredential, linkHeader } from './helpers/mock.js';

describe('GitHubClient request shaping', () => {
  it('GET requests hit the expected URL and carry auth + accept headers', async () => {
    const fetch = new MockFetch({ routes: { '/user': json({ login: 'octocat', id: 1 }) } });
    const client = createClient({ credential: patCredential(), fetch: fetch.fn });
    const response = await client.get<{ login: string }>('/user');
    expect(response.body.login).toBe('octocat');
    const request = fetch.lastRequest();
    expect(request?.url).toBe('https://api.github.com/user');
    expect(request?.method).toBe('GET');
    expect(request?.headers['authorization']).toBe('Bearer test-pat-token-1234567890');
    expect(request?.headers['accept']).toBe('application/vnd.github+json');
    expect(request?.headers['user-agent']).toBe('devforge');
  });

  it('appends encoded query parameters and skips undefined values', async () => {
    const fetch = new MockFetch({
      routes: { '/repos/a/b/issues?state=open&per_page=100': json([]) },
    });
    const client = createClient({ credential: patCredential(), fetch: fetch.fn });
    await client.get('/repos/a/b/issues', { query: { state: 'open', per_page: 100, nope: undefined } });
    expect(fetch.lastRequest()?.url).toBe('https://api.github.com/repos/a/b/issues?state=open&per_page=100');
  });

  it('serializes POST bodies as JSON', async () => {
    const fetch = new MockFetch({ routes: { '/repos/a/b/issues': json({ id: 42 }) } });
    const client = createClient({ credential: patCredential(), fetch: fetch.fn });
    await client.post('/repos/a/b/issues', { body: { title: 'Hello', body: 'World' } });
    expect(fetch.lastRequest()?.body).toBe(JSON.stringify({ title: 'Hello', body: 'World' }));
    expect(fetch.lastRequest()?.method).toBe('POST');
  });

  it('supports PATCH, PUT, and DELETE helpers', async () => {
    const fetch = new MockFetch({
      routes: {
        '/r/patch': json({ ok: true }),
        '/r/put': json({ ok: true }),
        '/r/del': json({ ok: true }),
      },
    });
    const client = createClient({ credential: patCredential(), fetch: fetch.fn });
    await client.patch('/r/patch', { body: { a: 1 } });
    expect(fetch.lastRequest()?.method).toBe('PATCH');
    await client.put('/r/put', { body: { a: 1 } });
    expect(fetch.lastRequest()?.method).toBe('PUT');
    await client.delete('/r/del');
    expect(fetch.lastRequest()?.method).toBe('DELETE');
  });

  it('rejects paths that do not start with a slash', async () => {
    const fetch = new MockFetch();
    const client = createClient({ credential: patCredential(), fetch: fetch.fn });
    await expect(client.get('repos/a/b')).rejects.toThrow('Path must start with');
  });

  it('honours a custom base URL, stripping trailing slashes', async () => {
    const fetch = new MockFetch({ baseUrl: 'https://ghe.example/api/v3/', routes: { '/user': json({}) } });
    const client = createClient({ credential: patCredential(), baseUrl: 'https://ghe.example/api/v3/', fetch: fetch.fn });
    await client.get('/user');
    expect(fetch.lastRequest()?.url).toBe('https://ghe.example/api/v3/user');
  });

  it('returns an empty body as undefined for 204-style responses', async () => {
    const fetch = new MockFetch({ routes: { '/nope': { status: 204 } } });
    const client = createClient({ credential: patCredential(), fetch: fetch.fn });
    const response = await client.get<undefined>('/nope');
    expect(response.status).toBe(204);
    expect(response.body).toBeUndefined();
  });

  it('merges caller-supplied headers over defaults', async () => {
    const fetch = new MockFetch({ routes: { '/user': json({}) } });
    const client = createClient({ credential: patCredential(), fetch: fetch.fn });
    await client.get('/user', { headers: { 'X-Custom': 'yes', Accept: 'text/plain' } });
    expect(fetch.lastRequest()?.headers['x-custom']).toBe('yes');
    expect(fetch.lastRequest()?.headers['accept']).toBe('text/plain');
  });
});

describe('GitHubClient error mapping', () => {
  it('maps 404 to GitHubNotFoundError with metadata', async () => {
    const fetch = new MockFetch({ routes: { '/repos/a/b': json({ message: 'Not Found' }, { status: 404 }) } });
    const client = createClient({ credential: patCredential(), fetch: fetch.fn });
    const error = await client.get('/repos/a/b').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubNotFoundError);
    expect((error as GitHubNotFoundError).status).toBe(404);
    expect((error as GitHubNotFoundError).path).toBe('/repos/a/b');
  });

  it('maps 409 to GitHubConflictError', async () => {
    const fetch = new MockFetch({ routes: { '/r': json({ message: 'Conflict' }, { status: 409 }) } });
    const client = createClient({ credential: patCredential(), fetch: fetch.fn });
    await expect(client.get('/r')).rejects.toBeInstanceOf(GitHubConflictError);
  });

  it('maps 429 to GitHubRateLimitError', async () => {
    const fetch = new MockFetch({ routes: { '/r': json({}, { status: 429 }) } });
    const client = createClient({ credential: patCredential(), fetch: fetch.fn });
    await expect(client.get('/r')).rejects.toBeInstanceOf(GitHubRateLimitError);
  });

  it('maps 403 with a rate-limit message to GitHubRateLimitError', async () => {
    const fetch = new MockFetch({ routes: { '/r': json({ message: 'API rate limit exceeded' }, { status: 403 }) } });
    const client = createClient({ credential: patCredential(), fetch: fetch.fn });
    await expect(client.get('/r')).rejects.toBeInstanceOf(GitHubRateLimitError);
  });

  it('maps 403 without a rate-limit message to a plain GitHubApiError', async () => {
    const fetch = new MockFetch({ routes: { '/r': json({ message: 'Forbidden' }, { status: 403 }) } });
    const client = createClient({ credential: patCredential(), fetch: fetch.fn });
    const error = await client.get('/r').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubApiError);
    expect(error).not.toBeInstanceOf(GitHubRateLimitError);
  });
});

describe('GitHubClient retry logic', () => {
  it('retries a transient 500 and succeeds on the next attempt', async () => {
    const fetch = new MockFetch();
    let calls = 0;
    fetch.fn = async () => {
      calls += 1;
      if (calls === 1) return new FakeResponse({ status: 500, body: { message: 'boom' } });
      return new FakeResponse({ body: { ok: true } });
    };
    const client = createClient({ credential: patCredential(), fetch: fetch.fn, maxRetries: 2 });
    const response = await client.get<{ ok: boolean }>('/user');
    expect(response.body.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('throws after exhausting retries for persistent 500s', async () => {
    const fetch = new MockFetch();
    let calls = 0;
    fetch.fn = async () => {
      calls += 1;
      return new FakeResponse({ status: 502, body: { message: 'bad gateway' } });
    };
    const client = createClient({ credential: patCredential(), fetch: fetch.fn, maxRetries: 2 });
    await expect(client.get('/user')).rejects.toBeInstanceOf(GitHubApiError);
    expect(calls).toBe(3);
  });

  it('does not retry non-transient 4xx errors', async () => {
    const fetch = new MockFetch();
    let calls = 0;
    fetch.fn = async () => {
      calls += 1;
      return new FakeResponse({ status: 422, body: { message: 'unprocessable' } });
    };
    const client = createClient({ credential: patCredential(), fetch: fetch.fn, maxRetries: 3 });
    await expect(client.get('/user')).rejects.toBeInstanceOf(GitHubApiError);
    expect(calls).toBe(1);
  });

  it('respects maxRetries=0 (no retries)', async () => {
    const fetch = new MockFetch();
    let calls = 0;
    fetch.fn = async () => {
      calls += 1;
      return new FakeResponse({ status: 500, body: { message: 'boom' } });
    };
    const client = createClient({ credential: patCredential(), fetch: fetch.fn, maxRetries: 0 });
    await expect(client.get('/user')).rejects.toBeInstanceOf(GitHubApiError);
    expect(calls).toBe(1);
  });

  it('retries transient network errors', async () => {
    const fetch = new MockFetch();
    let calls = 0;
    fetch.fn = async () => {
      calls += 1;
      if (calls === 1) throw new Error('ECONNRESET');
      return new FakeResponse({ body: { ok: 1 } });
    };
    const client = createClient({ credential: patCredential(), fetch: fetch.fn, maxRetries: 3 });
    await client.get('/user');
    expect(calls).toBe(2);
  });

  it('converts an unrecoverable network error into GitHubNetworkError', async () => {
    const fetch = new MockFetch();
    let calls = 0;
    fetch.fn = async () => {
      calls += 1;
      throw new Error('ECONNREFUSED');
    };
    const client = createClient({ credential: patCredential(), fetch: fetch.fn, maxRetries: 1 });
    await expect(client.get('/user')).rejects.toBeInstanceOf(GitHubNetworkError);
    expect(calls).toBe(2);
  });

  it('maps an AbortError to GitHubTimeoutError', async () => {
    const fetch = new MockFetch();
    fetch.fn = async () => {
      throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    };
    const client = createClient({ credential: patCredential(), fetch: fetch.fn, maxRetries: 0 });
    await expect(client.get('/user')).rejects.toBeInstanceOf(GitHubTimeoutError);
  });
});

describe('GitHubClient pagination', () => {
  it('iterates pages using the Link header next relation', async () => {
    const fetch = new MockFetch();
    fetch.on('/items', {
      body: [{ id: 1 }, { id: 2 }],
      headers: { link: linkHeader([['next', 'https://api.github.com/items?page=2' as string]]) },
    });
    fetch.on('/items?page=2', { body: [{ id: 3 }] });
    const client = createClient({ credential: patCredential(), fetch: fetch.fn });
    const items = [];
    for await (const item of client.paginate<{ id: number }>('/items')) {
      items.push(item);
    }
    expect(items.map((i) => i.id)).toEqual([1, 2, 3]);
  });

  it('stops pagination when no next link is present', async () => {
    const fetch = new MockFetch({ routes: { '/items': json([{ id: 1 }]) } });
    const client = createClient({ credential: patCredential(), fetch: fetch.fn });
    const items = [];
    for await (const item of client.paginate<{ id: number }>('/items')) {
      items.push(item);
    }
    expect(items).toHaveLength(1);
  });

  it('follows absolute next URLs and avoids cycles', async () => {
    const fetch = new MockFetch();
    fetch.on('/items', {
      body: [{ id: 1 }],
      headers: { link: linkHeader([['next', 'https://api.github.com/items?p=2']]) },
    });
    fetch.on('/items?p=2', {
      body: [{ id: 2 }],
      headers: { link: linkHeader([['next', 'https://api.github.com/items']]) },
    });
    const client = createClient({ credential: patCredential(), fetch: fetch.fn });
    const items = [];
    for await (const item of client.paginate<{ id: number }>('/items')) {
      items.push(item);
    }
    // Cycle back to /items is not revisited.
    expect(items.map((i) => i.id)).toEqual([1, 2]);
  });

  it('parses multi-relation Link headers deterministically', async () => {
    const fetch = new MockFetch();
    fetch.on('/items', {
      body: [{ id: 1 }],
      headers: {
        link: linkHeader([
          ['first', 'https://api.github.com/items?page=1'],
          ['next', 'https://api.github.com/items?page=2'],
          ['prev', 'https://api.github.com/items?page=0'],
          ['last', 'https://api.github.com/items?page=9'],
        ]),
      },
    });
    fetch.on('/items?page=2', { body: [{ id: 2 }] });
    const client = createClient({ credential: patCredential(), fetch: fetch.fn });
    const items = [];
    for await (const item of client.paginate<{ id: number }>('/items')) {
      items.push(item);
    }
    expect(items.map((i) => i.id)).toEqual([1, 2]);
    expect(fetch.lastRequest()?.url).toContain('page=2');
  });
});

describe('GitHubClient timeout', () => {
  it('aborts in-flight requests after the configured timeout', async () => {
    const fetch = new MockFetch();
    fetch.fn = (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(
          Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
        ));
      });
    const client = createClient({ credential: patCredential(), fetch: fetch.fn, timeoutMs: 5, maxRetries: 0 });
    await expect(client.get('/slow')).rejects.toBeInstanceOf(GitHubTimeoutError);
  });
});

describe('GitHubClient determinism', () => {
  it('uses an injectable clock for backoff scheduling (no real sleep)', async () => {
    const fetch = new MockFetch();
    let calls = 0;
    fetch.fn = async () => {
      calls += 1;
      return new FakeResponse({ status: 500, body: {} });
    };
    const now = vi.fn(() => 1000);
    const client = createClient({ credential: patCredential(), fetch: fetch.fn, maxRetries: 1, now });
    await expect(client.get('/user')).rejects.toBeInstanceOf(GitHubApiError);
    expect(calls).toBe(2);
  });
});