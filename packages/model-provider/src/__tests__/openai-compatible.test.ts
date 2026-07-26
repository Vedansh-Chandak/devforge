import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAICompatibleProvider } from '../openai-compatible.js';
import { ModelProviderError } from '../errors.js';

// ────────────────────────────────────────────
// Mock fetch factory
// ────────────────────────────────────────────

interface MockFetchOptions {
  status?: number;
  jsonBody?: unknown;
  headers?: Record<string, string>;
}

function createMockFetch(options: MockFetchOptions = {}) {
  const { status = 200, jsonBody, headers = {} } = options;

  const mockFn = vi.fn();

  mockFn.mockImplementation(async (_url: string, _init?: RequestInit): Promise<Response> => {
    const body = jsonBody ?? {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello world' },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    };

    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Map(Object.entries(headers)),
      json: async () => body,
    } as unknown as Response;
  });

  return mockFn;
}

function createErrorFetch(errorMessage: string) {
  const mockFn = vi.fn();
  mockFn.mockRejectedValue(new Error(errorMessage));
  return mockFn;
}

function createTimeoutFetch() {
  const mockFn = vi.fn();

  mockFn.mockImplementation(async (): Promise<Response> => {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    throw error;
  });

  return mockFn;
}

function createSuccessResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'chatcmpl-123',
    object: 'chat.completion',
    model: 'gpt-4o',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Hello world' },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    },
    ...overrides,
  };
}

// ────────────────────────────────────────────
// Constructor
// ────────────────────────────────────────────
describe('OpenAICompatibleProvider', () => {
  describe('constructor', () => {
    it('creates provider with valid config', () => {
      const fetchFn = createMockFetch();
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
        fetchFn,
      );
      expect(provider.id).toBe('openai-compatible');
    });

    it('throws when baseUrl is empty', () => {
      expect(
        () => new OpenAICompatibleProvider({ baseUrl: '', model: 'gpt-4o' }),
      ).toThrow('baseUrl is required');
    });

    it('throws when model is empty', () => {
      expect(
        () => new OpenAICompatibleProvider({ baseUrl: 'https://api.openai.com/v1', model: '' }),
      ).toThrow('model is required');
    });

    it('strips trailing slashes from baseUrl', async () => {
      const fetchFn = createMockFetch();
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1///', model: 'gpt-4o' },
        fetchFn,
      );

      await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });

      const calledUrl = fetchFn.mock.calls[0]?.[0];
      expect(calledUrl).toBe('https://api.openai.com/v1/chat/completions');
    });
  });

  // ──────────────────────────────────────────
  // Successful requests
  // ──────────────────────────────────────────
  describe('generate() — success', () => {
    it('returns a valid ModelResponse', async () => {
      const fetchFn = createMockFetch();
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1', apiKey: 'test-key', model: 'gpt-4o' },
        fetchFn,
      );

      const result = await provider.generate({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.content).toBe('Hello world');
      expect(result.model).toBe('gpt-4o');
      expect(result.finishReason).toBe('stop');
      expect(result.usage).toEqual({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      });
    });

    it('sends correct request URL', async () => {
      const fetchFn = createMockFetch();
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
        fetchFn,
      );

      await provider.generate({ messages: [{ role: 'user', content: 'Hello' }] });

      expect(fetchFn.mock.calls[0]?.[0]).toBe('https://api.openai.com/v1/chat/completions');
    });

    it('sends POST method', async () => {
      const fetchFn = createMockFetch();
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
        fetchFn,
      );

      await provider.generate({ messages: [{ role: 'user', content: 'Hello' }] });

      const init = fetchFn.mock.calls[0]?.[1];
      expect(init?.method).toBe('POST');
    });

    it('sends Authorization header with API key', async () => {
      const fetchFn = createMockFetch();
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-secret-key', model: 'gpt-4o' },
        fetchFn,
      );

      await provider.generate({ messages: [{ role: 'user', content: 'Hello' }] });

      const init = fetchFn.mock.calls[0]?.[1];
      const headers = init?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer sk-secret-key');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('does NOT send Authorization header when no apiKey', async () => {
      const fetchFn = createMockFetch();
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'http://localhost:11434/v1', model: 'llama3' },
        fetchFn,
      );

      await provider.generate({ messages: [{ role: 'user', content: 'Hello' }] });

      const init = fetchFn.mock.calls[0]?.[1];
      const headers = init?.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });

    it('sends custom headers', async () => {
      const fetchFn = createMockFetch();
      const provider = new OpenAICompatibleProvider(
        {
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o',
          headers: { 'X-Custom': 'value123' },
        },
        fetchFn,
      );

      await provider.generate({ messages: [{ role: 'user', content: 'Hello' }] });

      const init = fetchFn.mock.calls[0]?.[1];
      const headers = init?.headers as Record<string, string>;
      expect(headers['X-Custom']).toBe('value123');
    });

    it('includes messages in request body unchanged', async () => {
      const fetchFn = createMockFetch();
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
        fetchFn,
      );

      const messages = [
        { role: 'system' as const, content: 'Repository instructions' },
        { role: 'user' as const, content: 'Explain authentication' },
      ];

      await provider.generate({ messages });

      const init = fetchFn.mock.calls[0]?.[1];
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      expect(body.messages).toEqual(messages);
    });

    it('includes model in request body', async () => {
      const fetchFn = createMockFetch();
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
        fetchFn,
      );

      await provider.generate({ messages: [{ role: 'user', content: 'Hello' }] });

      const init = fetchFn.mock.calls[0]?.[1];
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      expect(body.model).toBe('gpt-4o');
    });

    it('includes temperature when provided', async () => {
      const fetchFn = createMockFetch();
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
        fetchFn,
      );

      await provider.generate({
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.7,
      });

      const init = fetchFn.mock.calls[0]?.[1];
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      expect(body.temperature).toBe(0.7);
    });

    it('does NOT include temperature when undefined', async () => {
      const fetchFn = createMockFetch();
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
        fetchFn,
      );

      await provider.generate({ messages: [{ role: 'user', content: 'Hello' }] });

      const init = fetchFn.mock.calls[0]?.[1];
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      expect(body.temperature).toBeUndefined();
    });

    it('includes max_tokens when provided', async () => {
      const fetchFn = createMockFetch();
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
        fetchFn,
      );

      await provider.generate({
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 1000,
      });

      const init = fetchFn.mock.calls[0]?.[1];
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      expect(body.max_tokens).toBe(1000);
    });

    it('does NOT include max_tokens when undefined', async () => {
      const fetchFn = createMockFetch();
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
        fetchFn,
      );

      await provider.generate({ messages: [{ role: 'user', content: 'Hello' }] });

      const init = fetchFn.mock.calls[0]?.[1];
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      expect(body.max_tokens).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────
  // Finish reason mapping
  // ──────────────────────────────────────────
  describe('finish reason mapping', () => {
    it.each([
      ['stop', 'stop'],
      ['length', 'length'],
      ['tool_calls', 'tool_call'],
      ['function_call', 'tool_call'],
      ['content_filter', 'content_filter'],
      ['unknown_value', 'unknown'],
      [null, 'unknown'],
      [undefined, 'unknown'],
    ])('maps "%s" → "%s"', async (raw, expected) => {
      const fetchFn = createMockFetch({
        jsonBody: createSuccessResponse({
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: raw }],
        }),
      });
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
        fetchFn,
      );

      const result = await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
      expect(result.finishReason).toBe(expected);
    });
  });

  // ──────────────────────────────────────────
  // Usage mapping
  // ──────────────────────────────────────────
  describe('usage mapping', () => {
    it('maps usage fields correctly', async () => {
      const fetchFn = createMockFetch({
        jsonBody: createSuccessResponse({
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        }),
      });
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
        fetchFn,
      );

      const result = await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
      expect(result.usage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      });
    });

    it('handles missing usage gracefully', async () => {
      const fetchFn = createMockFetch({
        jsonBody: createSuccessResponse({ usage: undefined }),
      });
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
        fetchFn,
      );

      const result = await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
      expect(result.usage).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────
  // Error mapping
  // ──────────────────────────────────────────
  describe('error mapping', () => {
    it.each([
      [400, 'INVALID_REQUEST', false],
      [401, 'AUTHENTICATION_ERROR', false],
      [403, 'AUTHENTICATION_ERROR', false],
      [404, 'MODEL_NOT_FOUND', false],
      [429, 'RATE_LIMITED', true],
      [500, 'PROVIDER_ERROR', true],
      [502, 'PROVIDER_ERROR', true],
      [503, 'PROVIDER_ERROR', true],
    ])('HTTP %d → code=%s retryable=%s', async (status, code, retryable) => {
      const fetchFn = createMockFetch({
        status,
        jsonBody: { error: { message: `Error ${status}` } },
      });
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
        fetchFn,
      );

      try {
        await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ModelProviderError);
        const pe = error as ModelProviderError;
        expect(pe.code).toBe(code);
        expect(pe.retryable).toBe(retryable);
        expect(pe.provider).toBe('openai-compatible');
      }
    });

    it('handles network failure', async () => {
      const fetchFn = createErrorFetch('fetch failed');
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
        fetchFn,
      );

      try {
        await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ModelProviderError);
        const pe = error as ModelProviderError;
        expect(pe.code).toBe('NETWORK_ERROR');
        expect(pe.retryable).toBe(true);
      }
    });

    it('handles timeout', async () => {
      const fetchFn = createTimeoutFetch();
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', timeoutMs: 5000 },
        fetchFn,
      );

      try {
        await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ModelProviderError);
        const pe = error as ModelProviderError;
        expect(pe.code).toBe('TIMEOUT');
        expect(pe.retryable).toBe(true);
        expect(pe.message).toContain('timed out');
      }
    });

    it('handles malformed JSON response', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => { throw new Error('Unexpected token'); },
      });
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
        fetchFn,
      );

      try {
        await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ModelProviderError);
        const pe = error as ModelProviderError;
        expect(pe.code).toBe('PROVIDER_ERROR');
        expect(pe.message).toContain('JSON');
      }
    });

    it('handles missing choices', async () => {
      const fetchFn = createMockFetch({
        jsonBody: { model: 'gpt-4o', choices: [] },
      });
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
        fetchFn,
      );

      try {
        await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ModelProviderError);
        const pe = error as ModelProviderError;
        expect(pe.code).toBe('PROVIDER_ERROR');
        expect(pe.message).toContain('no choices');
      }
    });

    it('handles missing message in choice', async () => {
      const fetchFn = createMockFetch({
        jsonBody: {
          model: 'gpt-4o',
          choices: [{ index: 0, finish_reason: 'stop' }],
        },
      });
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
        fetchFn,
      );

      try {
        await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ModelProviderError);
        const pe = error as ModelProviderError;
        expect(pe.code).toBe('PROVIDER_ERROR');
        expect(pe.message).toContain('no message content');
      }
    });
  });

  // ──────────────────────────────────────────
  // Request validation
  // ──────────────────────────────────────────
  describe('request validation', () => {
    it('rejects empty messages', async () => {
      const fetchFn = createMockFetch();
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
        fetchFn,
      );

      try {
        await provider.generate({ messages: [] });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ModelProviderError);
        const pe = error as ModelProviderError;
        expect(pe.code).toBe('INVALID_REQUEST');
      }
    });
  });

  // ──────────────────────────────────────────
  // Credential safety
  // ──────────────────────────────────────────
  describe('credential safety', () => {
    it('does not include API key in error messages', async () => {
      const fetchFn = createMockFetch({ status: 401, jsonBody: { error: { message: 'Unauthorized' } } });
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-super-secret-key', model: 'gpt-4o' },
        fetchFn,
      );

      try {
        await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
        expect.fail('Should have thrown');
      } catch (error) {
        const pe = error as ModelProviderError;
        expect(pe.message).not.toContain('sk-super-secret-key');
      }
    });

    it('does not expose API key in error cause', async () => {
      const fetchFn = createErrorFetch('Network failure with key sk-abc123 in debug');
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-abc123', model: 'gpt-4o' },
        fetchFn,
      );

      try {
        await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
        expect.fail('Should have thrown');
      } catch (error) {
        const pe = error as ModelProviderError;
        const errorStr = JSON.stringify(pe);
        expect(errorStr).not.toContain('sk-abc123');
      }
    });
  });

  // ──────────────────────────────────────────
  // URL contract
  // ──────────────────────────────────────────
  describe('URL contract', () => {
    it('appends /chat/completions to baseUrl', async () => {
      const fetchFn = createMockFetch();
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
        fetchFn,
      );

      await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
      expect(fetchFn.mock.calls[0]?.[0]).toBe('https://api.openai.com/v1/chat/completions');
    });

    it('does not produce double /v1/v1/', async () => {
      const fetchFn = createMockFetch();
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
        fetchFn,
      );

      await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
      const url = fetchFn.mock.calls[0]?.[0] as string;
      expect(url).not.toContain('/v1/v1/');
    });

    it('works with baseUrl without version path', async () => {
      const fetchFn = createMockFetch();
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com', model: 'gpt-4o' },
        fetchFn,
      );

      await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
      expect(fetchFn.mock.calls[0]?.[0]).toBe('https://api.openai.com/chat/completions');
    });

    it('works with local server URLs', async () => {
      const fetchFn = createMockFetch();
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'http://localhost:11434/v1', model: 'llama3' },
        fetchFn,
      );

      await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
      expect(fetchFn.mock.calls[0]?.[0]).toBe('http://localhost:11434/v1/chat/completions');
    });
  });

  // ──────────────────────────────────────────
  // AbortController / timeout
  // ──────────────────────────────────────────
  describe('timeout', () => {
    it('passes AbortSignal to fetch', async () => {
      const fetchFn = createMockFetch();
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', timeoutMs: 5000 },
        fetchFn,
      );

      await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });

      const init = fetchFn.mock.calls[0]?.[1];
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    });
  });
});