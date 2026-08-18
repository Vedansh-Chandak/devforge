import { describe, it, expect, vi } from 'vitest';
import {
  HttpTransport,
  classifyHttpStatus,
  sanitizeUrl,
  extractErrorMessage,
  extractErrorStatus,
  mapFetchFailure,
} from '../transport.js';
import { ModelProviderError } from '../errors.js';
import { createMockFetch } from './helpers/mock-fetch.js';
import type { MockBehavior } from './helpers/mock-fetch.js';

function makeTransport(options: {
  body?: unknown;
  status?: number;
  apiKey?: string;
  behavior?: MockBehavior;
  classify?: (status: number, body?: Record<string, unknown>) => ReturnType<typeof classifyHttpStatus>;
}) {
  const behavior: MockBehavior =
    options.behavior ?? { kind: 'json', status: options.status ?? 200, body: options.body };
  const mock = createMockFetch(behavior);
  const transport = new HttpTransport({
    provider: 'test-provider',
    baseUrl: 'https://api.example.com/v1',
    apiKey: options.apiKey,
    fetchFn: mock.fetchFn,
    classify: options.classify,
  });
  return { transport, mock };
}

describe('HttpTransport', () => {
  it('posts JSON to baseUrl + path', async () => {
    const { transport, mock } = makeTransport({ body: { ok: true } });
    await transport.post({ path: '/chat/completions', body: { model: 'gpt-4o' } });
    expect(mock.last().url).toBe('https://api.example.com/v1/chat/completions');
    expect(mock.requestBodies()).toEqual([{ model: 'gpt-4o' }]);
  });

  it('strips trailing slashes from baseUrl', async () => {
    const mock = createMockFetch();
    const transport = new HttpTransport({
      provider: 'p',
      baseUrl: 'https://api.example.com/v1///',
      fetchFn: mock.fetchFn,
    });
    await transport.post({ path: '/x', body: {} });
    expect(mock.last().url).toBe('https://api.example.com/v1/x');
  });

  it('allows an absolute URL path to bypass baseUrl', async () => {
    const { transport, mock } = makeTransport({ body: { ok: true } });
    await transport.post({ path: 'https://other.example.com/v1/chat', body: {} });
    expect(mock.last().url).toBe('https://other.example.com/v1/chat');
  });

  it('sends a bearer Authorization header when apiKey is provided', async () => {
    const { transport, mock } = makeTransport({ apiKey: 'sk-test', body: { ok: true } });
    await transport.post({ path: '/x', body: {} });
    expect(mock.requestHeaders().Authorization).toBe('Bearer sk-test');
  });

  it('omits Authorization when no apiKey', async () => {
    const { transport, mock } = makeTransport({ body: { ok: true } });
    await transport.post({ path: '/x', body: {} });
    expect(mock.requestHeaders().Authorization).toBeUndefined();
  });

  it('supports header-based auth (e.g. x-api-key)', async () => {
    const mock = createMockFetch();
    const transport = new HttpTransport({
      provider: 'p',
      baseUrl: 'https://api.example.com',
      apiKey: 'anthropic-key-123',
      auth: { scheme: 'header', name: 'x-api-key' },
      fetchFn: mock.fetchFn,
    });
    await transport.post({ path: '/v1/messages', body: {} });
    const headers = mock.requestHeaders();
    expect(headers['x-api-key']).toBe('anthropic-key-123');
    expect(headers['Authorization']).toBeUndefined();
  });

  it('merges extra headers and per-request headers', async () => {
    const mock = createMockFetch();
    const transport = new HttpTransport({
      provider: 'p',
      baseUrl: 'https://api.example.com',
      extraHeaders: { 'anthropic-version': '2023-06-01' },
      fetchFn: mock.fetchFn,
    });
    await transport.post({ path: '/x', body: {}, headers: { 'X-Extra': 'yes' } });
    const headers = mock.requestHeaders();
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['X-Extra']).toBe('yes');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('passes the abort signal through to fetch', async () => {
    const mock = createMockFetch();
    const transport = new HttpTransport({
      provider: 'p',
      baseUrl: 'https://api.example.com',
      fetchFn: mock.fetchFn,
    });
    const controller = new AbortController();
    await transport.post({ path: '/x', body: {}, signal: controller.signal });
    expect(mock.last().init?.signal).toBe(controller.signal);
  });

  describe('HTTP status classification', () => {
    it.each([
      [400, 'INVALID_REQUEST', false],
      [401, 'AUTHENTICATION_ERROR', false],
      [403, 'AUTHENTICATION_ERROR', false],
      [404, 'MODEL_NOT_FOUND', false],
      [429, 'RATE_LIMITED', true],
      [500, 'PROVIDER_ERROR', true],
      [502, 'PROVIDER_ERROR', true],
      [503, 'PROVIDER_ERROR', true],
      [418, 'UNKNOWN', false],
    ])('status %d → %s retryable=%s', async (status, code, retryable) => {
      const { transport } = makeTransport({
        status,
        body: { error: { message: `boom ${status}` } },
      });
      await expect(transport.post({ path: '/x', body: {} })).rejects.toMatchObject({
        code,
        retryable,
        provider: 'test-provider',
      });
    });

    it('uses a custom classifier when provided', async () => {
      const classify = vi.fn(
        (): ReturnType<typeof classifyHttpStatus> => ({ code: 'AUTHENTICATION_ERROR', retryable: false }),
      );
      const { transport } = makeTransport({
        status: 400,
        body: { error: { message: 'boom 400' } },
        classify,
      });
      await expect(transport.post({ path: '/x', body: {} })).rejects.toMatchObject({
        code: 'AUTHENTICATION_ERROR',
      });
      expect(classify).toHaveBeenCalledWith(400, { error: { message: 'boom 400' } });
    });
  });

  it('redacts secrets from provider error messages', async () => {
    const { transport } = makeTransport({
      status: 401,
      body: { error: { message: 'invalid key sk-super-secret echoed back' } },
      apiKey: 'sk-super-secret',
    });
    await expect(transport.post({ path: '/x', body: {} })).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('sk-super-secret'),
      }),
    );
  });

  it('maps fetch rejections to NETWORK_ERROR and redacts secrets', async () => {
    const { transport } = makeTransport({
      behavior: { kind: 'throw', error: new Error('connect failed sk-net-secret') },
      apiKey: 'sk-net-secret',
    });
    await expect(transport.post({ path: '/x', body: {} })).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      retryable: true,
    });
  });

  it('maps AbortError to TIMEOUT', async () => {
    const { transport } = makeTransport({ behavior: { kind: 'abort' } });
    await expect(transport.post({ path: '/x', body: {} })).rejects.toMatchObject({
      code: 'TIMEOUT',
      retryable: true,
    });
  });

  it('maps an already-aborted signal to CANCELLED', async () => {
    const { transport } = makeTransport({ behavior: { kind: 'abort' } });
    const controller = new AbortController();
    controller.abort();
    await expect(
      transport.post({ path: '/x', body: {}, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'CANCELLED', retryable: false });
  });

  it('marks malformed JSON responses as PROVIDER_ERROR', async () => {
    const mock = createMockFetch();
    const fetchFn = vi.fn().mockResolvedValue(
      new Response('<html>not json</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const transport = new HttpTransport({
      provider: 'p',
      baseUrl: 'https://api.example.com',
      fetchFn,
    });
    await expect(transport.post({ path: '/x', body: {} })).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      retryable: false,
    });
  });
});

describe('classifyHttpStatus', () => {
  it('is deterministic', () => {
    expect(classifyHttpStatus(429)).toEqual({ code: 'RATE_LIMITED', retryable: true });
    expect(classifyHttpStatus(429)).toEqual({ code: 'RATE_LIMITED', retryable: true });
  });
});

describe('sanitizeUrl', () => {
  it('strips query strings and userinfo', () => {
    expect(sanitizeUrl('https://user:pass@api.example.com/v1?key=sk-secret&x=1')).toBe(
      'https://api.example.com/v1',
    );
  });
  it('falls back to a placeholder for malformed URLs', () => {
    expect(sanitizeUrl(' not a url ')).toBe('[invalid URL]');
  });
});

describe('message extraction', () => {
  it('extracts error.message from a body', () => {
    expect(extractErrorMessage({ error: { message: 'nope' } })).toBe('nope');
    expect(extractErrorMessage({ error: { code: 400 } })).toBeUndefined();
    expect(extractErrorMessage({ foo: 1 })).toBeUndefined();
  });

  it('extracts error.status from a body', () => {
    expect(extractErrorStatus({ error: { status: 'PERMISSION_DENIED' } })).toBe(
      'PERMISSION_DENIED',
    );
    expect(extractErrorStatus({})).toBeUndefined();
  });
});

describe('mapFetchFailure', () => {
  it('produces normalized errors with the provider id', () => {
    const error = mapFetchFailure(
      { provider: 'gemini', error: new Error('boom'), url: 'https://x/v1', aborted: false },
      [],
    );
    expect(error).toBeInstanceOf(ModelProviderError);
    expect(error).toMatchObject({ provider: 'gemini', code: 'NETWORK_ERROR', retryable: true });
  });
});