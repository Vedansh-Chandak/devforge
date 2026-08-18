import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAICompatibleProvider } from '../openai-compatible.js';
import { ModelProviderError } from '../errors.js';
import {
  createMockFetch as createTestFetch,
  openAIChatCompletion as chatCompletion,
  fastRetryPolicy,
} from './helpers/mock-fetch.js';

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

    it('throws CANCELLED when already-aborted signal is passed', async () => {
      const fetchFn = createMockFetch();
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
        fetchFn,
      );
      const controller = new AbortController();
      controller.abort();

      try {
        await provider.generate({
          messages: [{ role: 'user', content: 'hi' }],
          signal: controller.signal,
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ModelProviderError);
        const pe = error as ModelProviderError;
        expect(pe.code).toBe('CANCELLED');
        expect(pe.retryable).toBe(false);
      }
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('aborts the in-flight request when the external signal fires', async () => {
      const controller = new AbortController();
      const fetchFn = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', timeoutMs: 10_000 },
        fetchFn,
      );

      const pending = provider.generate({
        messages: [{ role: 'user', content: 'hi' }],
        signal: controller.signal,
      });
      setTimeout(() => controller.abort(), 5);

      await expect(pending).rejects.toMatchObject({
        code: 'CANCELLED',
        retryable: false,
      });
    });

    it('keeps TIMEOUT code when the internal timeout fires (not external signal)', async () => {
      const controller = new AbortController();
      const fetchFn = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', timeoutMs: 10 },
        fetchFn,
      );

      await expect(
        provider.generate({
          messages: [{ role: 'user', content: 'hi' }],
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ code: 'TIMEOUT', retryable: true });
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

  // ──────────────────────────────────────────
  // Structured output (DF-026B)
  // ──────────────────────────────────────────
  describe('structured output', () => {
    const schema = {
      type: 'object' as const,
      properties: { ok: { type: 'boolean' as const } },
      required: ['ok'],
      additionalProperties: false,
    };

    function structuredProvider(fetchFn: ReturnType<typeof createTestFetch>['fetchFn']) {
      return new OpenAICompatibleProvider(
        { baseUrl: 'https://x/v1', model: 'gpt-4o' },
        fetchFn,
      );
    }

    it('translates json_schema responseFormat into response_format', async () => {
      const mock = createTestFetch({
        kind: 'json',
        body: chatCompletion({ choices: [{ index: 0, message: { role: 'assistant', content: '{"ok":true}' }, finish_reason: 'stop' }] }),
      });
      const provider = structuredProvider(mock.fetchFn);
      await provider.generate({
        messages: [{ role: 'user', content: 'hi' }],
        responseFormat: { type: 'json_schema', schema },
      });
      const body = mock.requestBodies()[0]!;
      expect(body.response_format).toEqual({
        type: 'json_schema',
        json_schema: { name: 'structured_output', schema },
      });
    });

    it('sets json_object response_format mode', async () => {
      const mock = createTestFetch({
        kind: 'json',
        body: chatCompletion({ choices: [{ index: 0, message: { role: 'assistant', content: '{"k":1}' }, finish_reason: 'stop' }] }),
      });
      const provider = structuredProvider(mock.fetchFn);
      await provider.generate({
        messages: [{ role: 'user', content: 'hi' }],
        responseFormat: { type: 'json_object' },
      });
      const body = mock.requestBodies()[0]!;
      expect(body.response_format).toEqual({ type: 'json_object' });
    });

    it('validates a matching structured response and keeps raw content', async () => {
      const mock = createTestFetch({
        kind: 'json',
        body: chatCompletion({ choices: [{ index: 0, message: { role: 'assistant', content: '{"ok":true}' }, finish_reason: 'stop' }] }),
      });
      const provider = structuredProvider(mock.fetchFn);
      const result = await provider.generate({
        messages: [{ role: 'user', content: 'hi' }],
        responseFormat: { type: 'json_schema', schema },
      });
      expect(result.content).toBe('{"ok":true}');
      expect(result.provider).toBe('openai-compatible');
    });

    it('rejects a schema-mismatched structured response', async () => {
      const mock = createTestFetch({
        kind: 'json',
        body: chatCompletion({ choices: [{ index: 0, message: { role: 'assistant', content: '{"ok":"yes"}' }, finish_reason: 'stop' }] }),
      });
      const provider = structuredProvider(mock.fetchFn);
      await expect(
        provider.generate({
          messages: [{ role: 'user', content: 'hi' }],
          responseFormat: { type: 'json_schema', schema },
        }),
      ).rejects.toMatchObject({ code: 'PROVIDER_ERROR', retryable: false });
    });

    it('rejects non-JSON content for structured requests', async () => {
      const mock = createTestFetch({
        kind: 'json',
        body: chatCompletion({ choices: [{ index: 0, message: { role: 'assistant', content: 'definitely not json' }, finish_reason: 'stop' }] }),
      });
      const provider = structuredProvider(mock.fetchFn);
      await expect(
        provider.generate({
          messages: [{ role: 'user', content: 'hi' }],
          responseFormat: { type: 'json_schema', schema },
        }),
      ).rejects.toMatchObject({ code: 'PROVIDER_ERROR', retryable: false });
    });

    it('accepts valid JSON for json_object mode and rejects malformed JSON', async () => {
      const valid = createTestFetch({
        kind: 'json',
        body: chatCompletion({ choices: [{ index: 0, message: { role: 'assistant', content: '{"k":1}' }, finish_reason: 'stop' }] }),
      });
      const ok = await structuredProvider(valid.fetchFn).generate({
        messages: [{ role: 'user', content: 'hi' }],
        responseFormat: { type: 'json_object' },
      });
      expect(ok.provider).toBe('openai-compatible');

      const invalid = createTestFetch({
        kind: 'json',
        body: chatCompletion({ choices: [{ index: 0, message: { role: 'assistant', content: 'not json at all' }, finish_reason: 'stop' }] }),
      });
      await expect(
        structuredProvider(invalid.fetchFn).generate({
          messages: [{ role: 'user', content: 'hi' }],
          responseFormat: { type: 'json_object' },
        }),
      ).rejects.toMatchObject({ code: 'PROVIDER_ERROR', retryable: false });
    });
  });

  // ──────────────────────────────────────────
  // Retry behaviour (DF-026B — shared retry primitive)
  // ──────────────────────────────────────────
  describe('retry behaviour', () => {
    function retryableProvider(
      fetchFn: ReturnType<typeof createTestFetch>['fetchFn'],
      retryPolicy = fastRetryPolicy(2),
    ) {
      return new OpenAICompatibleProvider(
        { baseUrl: 'https://x/v1', model: 'gpt-4o', retryPolicy },
        fetchFn,
      );
    }

    it('retries a RATE_LIMITED failure and succeeds on recovery', async () => {
      const mock = createTestFetch();
      mock.enqueue({ kind: 'json', status: 429, body: { error: { message: 'slow down' } } });
      mock.setDefault({ kind: 'json', body: chatCompletion() });
      const provider = retryableProvider(mock.fetchFn);

      const result = await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
      expect(result.content).toBe('Hello world');
      expect(mock.calls).toHaveLength(2);
    });

    it('does not retry non-retryable authentication errors', async () => {
      const mock = createTestFetch({
        kind: 'json',
        status: 401,
        body: { error: { message: 'nope' } },
      });
      const provider = retryableProvider(mock.fetchFn);
      await expect(
        provider.generate({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toMatchObject({ code: 'AUTHENTICATION_ERROR', retryable: false });
      expect(mock.calls).toHaveLength(1);
    });

    it('exhausts retries and re-throws the last error unchanged', async () => {
      const mock = createTestFetch({
        kind: 'json',
        status: 500,
        body: { error: { message: 'boom' } },
      });
      const provider = retryableProvider(mock.fetchFn);
      await expect(
        provider.generate({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toMatchObject({ code: 'PROVIDER_ERROR', retryable: true });
      expect(mock.calls).toHaveLength(3);
    });

    it('respects a per-request maxRetries override', async () => {
      const mock = createTestFetch({
        kind: 'json',
        status: 500,
        body: { error: { message: 'boom' } },
      });
      const provider = retryableProvider(mock.fetchFn, fastRetryPolicy(5));
      await expect(
        provider.generate({
          messages: [{ role: 'user', content: 'hi' }],
          maxRetries: 1,
        }),
      ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
      expect(mock.calls).toHaveLength(2);
    });

    it('reports retry metadata without leaking secrets', async () => {
      const seen: Array<{ attempt: number; message: string }> = [];
      const mock = createTestFetch();
      mock.enqueue({ kind: 'json', status: 500, body: { error: { message: 'boom' } } });
      mock.setDefault({ kind: 'json', body: chatCompletion() });
      const provider = new OpenAICompatibleProvider(
        {
          baseUrl: 'https://x/v1',
          model: 'gpt-4o',
          apiKey: 'sk-retry-secret-999',
          retryPolicy: fastRetryPolicy(1),
          onRetry: (info) => seen.push({ attempt: info.attempt, message: info.error.message }),
        },
        mock.fetchFn,
      );

      await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
      expect(seen).toHaveLength(1);
      expect(seen[0]!.message).not.toContain('sk-retry-secret-999');
    });
  });

  // ──────────────────────────────────────────
  // Per-request overrides
  // ──────────────────────────────────────────
  describe('per-request timeout override', () => {
    it('honours request.timeoutMs even with a large provider default', async () => {
      const mock = createTestFetch({ kind: 'listen' });
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://x/v1', model: 'gpt-4o', timeoutMs: 60_000 },
        mock.fetchFn,
      );
      await expect(
        provider.generate({
          messages: [{ role: 'user', content: 'hi' }],
          timeoutMs: 10,
        }),
      ).rejects.toMatchObject({ code: 'TIMEOUT', retryable: true });
    });
  });

  // ──────────────────────────────────────────
  // Usage + metadata normalization (DF-026B)
  // ──────────────────────────────────────────
  describe('usage and metadata', () => {
    it('extracts only usage fields the provider actually returned', async () => {
      const mock = createTestFetch({
        kind: 'json',
        body: chatCompletion({ usage: { prompt_tokens: 7 } }),
      });
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://x/v1', model: 'gpt-4o' },
        mock.fetchFn,
      );
      const result = await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
      expect(result.usage).toEqual({ inputTokens: 7 });
    });

    it('exposes provider id, response id and model', async () => {
      const mock = createTestFetch({ kind: 'json', body: chatCompletion({ id: 'chatcmpl-x1' }) });
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://x/v1', model: 'gpt-4o' },
        mock.fetchFn,
      );
      const result = await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
      expect(result).toMatchObject({
        provider: 'openai-compatible',
        id: 'chatcmpl-x1',
        model: 'gpt-4o',
        finishReason: 'stop',
      });
    });
  });

  // ──────────────────────────────────────────
  // Concurrency
  // ──────────────────────────────────────────
  describe('concurrency', () => {
    it('serves concurrent requests independently', async () => {
      const mock = createTestFetch();
      mock.enqueue(
        { kind: 'json', body: chatCompletion({ choices: [{ index: 0, message: { role: 'assistant', content: 'first' }, finish_reason: 'stop' }] }) },
        { kind: 'json', body: chatCompletion({ choices: [{ index: 0, message: { role: 'assistant', content: 'second' }, finish_reason: 'stop' }] }) },
      );
      const provider = new OpenAICompatibleProvider(
        { baseUrl: 'https://x/v1', model: 'gpt-4o' },
        mock.fetchFn,
      );
      const [a, b] = await Promise.all([
        provider.generate({ messages: [{ role: 'user', content: 'one' }] }),
        provider.generate({ messages: [{ role: 'user', content: 'two' }] }),
      ]);
      expect(a.content).toBe('first');
      expect(b.content).toBe('second');
      expect(mock.calls).toHaveLength(2);
    });
  });
  });