import { describe, it, expect } from 'vitest';
import {
  AnthropicProvider,
  mapAnthropicStopReason,
  extractAnthropicUsage,
  toAnthropicMessages,
} from '../anthropic.js';
import { createMockFetch, fastRetryPolicy } from './helpers/mock-fetch.js';
import type { MockBehavior } from './helpers/mock-fetch.js';

const SCHEMA = {
  type: 'object' as const,
  properties: { ok: { type: 'boolean' as const } },
  required: ['ok'],
  additionalProperties: false,
};

function anthropicBody(content = 'hello from claude', overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_01abc',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    model: 'claude-sonnet-4-20250514',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
    ...overrides,
  };
}

function makeProvider(behavior: MockBehavior, config: Record<string, unknown> = {}) {
  const mock = createMockFetch(behavior);
  const provider = new AnthropicProvider(
    { model: 'claude-sonnet-4-20250514', apiKey: 'anthropic-key-test-1', ...config },
    mock.fetchFn,
  );
  return { provider, mock };
}

describe('AnthropicProvider', () => {
  describe('successful generation', () => {
    it('returns a normalized ModelResponse', async () => {
      const { provider } = makeProvider({ kind: 'json', body: anthropicBody() });
      const result = await provider.generate({
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(result).toEqual({
        content: 'hello from claude',
        model: 'claude-sonnet-4-20250514',
        finishReason: 'stop',
        id: 'msg_01abc',
        provider: 'anthropic',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      });
    });

    it('joins multiple text blocks in order', async () => {
      const { provider } = makeProvider({
        kind: 'json',
        body: anthropicBody('', {
          content: [
            { type: 'text', text: 'part one ' },
            { type: 'text', text: 'part two' },
            { type: 'tool_use', id: 't1', name: 'x', input: {} },
          ],
        }),
      });
      const result = await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
      expect(result.content).toBe('part one part two');
    });
  });

  describe('request normalization', () => {
    it('posts to /v1/messages with x-api-key and anthropic-version headers', async () => {
      const { provider, mock } = makeProvider({ kind: 'json', body: anthropicBody() });
      await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
      expect(mock.last().url).toBe('https://api.anthropic.com/v1/messages');
      const headers = mock.requestHeaders();
      expect(headers['x-api-key']).toBe('anthropic-key-test-1');
      expect(headers['anthropic-version']).toBe('2023-06-01');
      expect(headers['Authorization']).toBeUndefined();
    });

    it('uses a configurable baseUrl', async () => {
      const { provider, mock } = makeProvider(
        { kind: 'json', body: anthropicBody() },
        { baseUrl: 'https://proxy.example.com' },
      );
      await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
      expect(mock.last().url).toBe('https://proxy.example.com/v1/messages');
    });

    it('maps messages and extracts the system prompt', async () => {
      const { provider, mock } = makeProvider({ kind: 'json', body: anthropicBody() });
      await provider.generate({
        messages: [
          { role: 'system', content: 'Be concise.' },
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi' },
          { role: 'user', content: 'Explain' },
        ],
      });
      const body = mock.requestBodies()[0]!;
      expect(body.system).toBe('Be concise.');
      expect(body.messages).toEqual([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'Explain' },
      ]);
    });

    it('prefixes an empty user turn when the conversation starts with assistant', async () => {
      const { provider, mock } = makeProvider({ kind: 'json', body: anthropicBody() });
      await provider.generate({
        messages: [
          { role: 'assistant', content: 'already started' },
          { role: 'user', content: 'continue' },
        ],
      });
      const body = mock.requestBodies()[0]!;
      expect(body.messages).toEqual([
        { role: 'user', content: '' },
        { role: 'assistant', content: 'already started' },
        { role: 'user', content: 'continue' },
      ]);
    });

    it('sends max_tokens when provided and a default otherwise', async () => {
      const withTokens = makeProvider({ kind: 'json', body: anthropicBody() });
      await withTokens.provider.generate({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 2000,
      });
      expect(withTokens.mock.requestBodies()[0]!.max_tokens).toBe(2000);

      const withoutTokens = makeProvider({ kind: 'json', body: anthropicBody() });
      await withoutTokens.provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
      expect(withoutTokens.mock.requestBodies()[0]!.max_tokens).toBe(4096);

      const customDefault = makeProvider(
        { kind: 'json', body: anthropicBody() },
        { defaultMaxTokens: 1234 },
      );
      await customDefault.provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
      expect(customDefault.mock.requestBodies()[0]!.max_tokens).toBe(1234);
    });

    it('sends temperature only when provided', async () => {
      const cold = makeProvider({ kind: 'json', body: anthropicBody() });
      await cold.provider.generate({
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.5,
      });
      expect(cold.mock.requestBodies()[0]!.temperature).toBe(0.5);

      const plain = makeProvider({ kind: 'json', body: anthropicBody() });
      await plain.provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
      expect(plain.mock.requestBodies()[0]!.temperature).toBeUndefined();
    });

    it('injects structured-output guidance into the system prompt', async () => {
      const { provider, mock } = makeProvider({ kind: 'json', body: anthropicBody('{"ok":true}') });
      await provider.generate({
        messages: [{ role: 'system', content: 'Be terse.' }],
        responseFormat: { type: 'json_schema', schema: SCHEMA },
      });
      const body = mock.requestBodies()[0]!;
      expect(body.system).toContain('Be terse.');
      expect(body.system).toContain('single valid JSON object');
      expect(body.system).toContain(JSON.stringify(SCHEMA));
    });
  });

  describe('response normalization', () => {
    it('maps stop reasons', async () => {
      const cases: Array<[string | null | undefined, string]> = [
        ['end_turn', 'stop'],
        ['stop_sequence', 'stop'],
        ['max_tokens', 'length'],
        ['tool_use', 'tool_call'],
        ['refusal', 'content_filter'],
        ['weird', 'unknown'],
        [null, 'unknown'],
      ];
      for (const [raw, expected] of cases) {
        expect(mapAnthropicStopReason(raw)).toBe(expected);
      }
    });

    it('derives totalTokens from input + output and leaves absent values undefined', async () => {
      expect(extractAnthropicUsage({ input_tokens: 3, output_tokens: 4 })).toEqual({
        inputTokens: 3,
        outputTokens: 4,
        totalTokens: 7,
      });
      expect(extractAnthropicUsage({ input_tokens: 3 })).toEqual({ inputTokens: 3 });
      expect(extractAnthropicUsage(undefined)).toBeUndefined();
    });
  });

  describe('structured output', () => {
    it('validates a matching response', async () => {
      const { provider } = makeProvider({ kind: 'json', body: anthropicBody('{"ok":true}') });
      const result = await provider.generate({
        messages: [{ role: 'user', content: 'hi' }],
        responseFormat: { type: 'json_schema', schema: SCHEMA },
      });
      expect(result.content).toBe('{"ok":true}');
    });

    it('rejects a schema-mismatched structured response', async () => {
      const { provider } = makeProvider({ kind: 'json', body: anthropicBody('{"ok":7}') });
      await expect(
        provider.generate({
          messages: [{ role: 'user', content: 'hi' }],
          responseFormat: { type: 'json_schema', schema: SCHEMA },
        }),
      ).rejects.toMatchObject({ code: 'PROVIDER_ERROR', retryable: false });
    });
  });

  describe('errors', () => {
    it.each([
      [400, { error: { message: 'bad' } }, 'INVALID_REQUEST', false],
      [401, { error: { message: 'no key' } }, 'AUTHENTICATION_ERROR', false],
      [403, { error: { message: 'denied' } }, 'AUTHENTICATION_ERROR', false],
      [404, { error: { message: 'missing model' } }, 'MODEL_NOT_FOUND', false],
      [429, { error: { message: 'slow' } }, 'RATE_LIMITED', true],
      [500, { error: { message: 'internal' } }, 'PROVIDER_ERROR', true],
      [529, { error: { message: 'overloaded' } }, 'PROVIDER_ERROR', true],
    ])('HTTP %d → %s retryable=%s', async (status, body, code, retryable) => {
      const { provider } = makeProvider({ kind: 'json', status, body });
      await expect(provider.generate({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject(
        { code, retryable, provider: 'anthropic' },
      );
    });

    it('rejects responses with no content blocks', async () => {
      const { provider } = makeProvider({ kind: 'json', body: { content: [] } });
      await expect(provider.generate({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject(
        { code: 'PROVIDER_ERROR', retryable: false },
      );
    });

    it('rejects responses with no text content', async () => {
      const { provider } = makeProvider({
        kind: 'json',
        body: { content: [{ type: 'tool_use', id: 't1', name: 'x', input: {} }] },
      });
      await expect(provider.generate({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject(
        { code: 'PROVIDER_ERROR', retryable: false },
      );
    });
  });

  describe('timeout and cancellation', () => {
    it('rejects TIMEOUT when the internal deadline fires', async () => {
      const { provider } = makeProvider({ kind: 'listen' }, { timeoutMs: 10 });
      await expect(provider.generate({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({
        code: 'TIMEOUT',
        retryable: true,
      });
    });

    it('rejects CANCELLED when the external signal aborts mid-flight', async () => {
      const mock = createMockFetch({ kind: 'listen' });
      const provider = new AnthropicProvider({ model: 'claude-sonnet-4-20250514' }, mock.fetchFn);
      const controller = new AbortController();
      const pending = provider.generate({
        messages: [{ role: 'user', content: 'hi' }],
        signal: controller.signal,
      });
      setTimeout(() => controller.abort(), 5);
      await expect(pending).rejects.toMatchObject({ code: 'CANCELLED', retryable: false });
    });

    it('rejects CANCELLED for an already-aborted signal without calling fetch', async () => {
      const { provider, mock } = makeProvider({ kind: 'json', body: anthropicBody() });
      const controller = new AbortController();
      controller.abort();
      await expect(
        provider.generate({ messages: [{ role: 'user', content: 'hi' }], signal: controller.signal }),
      ).rejects.toMatchObject({ code: 'CANCELLED', retryable: false });
      expect(mock.calls).toHaveLength(0);
    });
  });

  describe('retry', () => {
    it('retries a rate limit and succeeds on recovery', async () => {
      const mock = createMockFetch();
      mock.enqueue({ kind: 'json', status: 429, body: { error: { message: 'slow' } } });
      mock.setDefault({ kind: 'json', body: anthropicBody() });
      const provider = new AnthropicProvider(
        { model: 'claude-sonnet-4-20250514', retryPolicy: fastRetryPolicy(2) },
        mock.fetchFn,
      );
      const result = await provider.generate({ messages: [{ role: 'user', content: 'hi' }] });
      expect(result.content).toBe('hello from claude');
      expect(mock.calls).toHaveLength(2);
    });
  });

  describe('toAnthropicMessages', () => {
    it('joins system parts and appends structured-output guidance', () => {
      const { system, messages } = toAnthropicMessages(
        [
          { role: 'system', content: 's1' },
          { role: 'user', content: 'u' },
        ],
        'JSON guidance',
      );
      expect(system).toBe('s1\n\nJSON guidance');
      expect(messages).toEqual([{ role: 'user', content: 'u' }]);
    });
  });
});