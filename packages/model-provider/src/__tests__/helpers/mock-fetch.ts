/**
 * Deterministic mocked-fetch controller for provider adapter tests.
 * All tests use this; no test ever calls a real provider API.
 */

import { vi } from 'vitest';

export type MockBehavior =
  | { kind: 'json'; status?: number; body?: unknown }
  | { kind: 'throw'; error: Error }
  /** Reject with an AbortError immediately (provider-side abort). */
  | { kind: 'abort'; message?: string }
  /** Reject with an AbortError only when the request signal is aborted. */
  | { kind: 'listen' }
  /** Never settle. Used with withTimeout to exercise deadlines. */
  | { kind: 'hang' };

export interface MockFetchCall {
  url: string;
  init?: RequestInit;
}

export interface MockFetch {
  fetchFn: ReturnType<typeof vi.fn>;
  calls: MockFetchCall[];
  /** Behavior used when the queue is empty. */
  setDefault(behavior: MockBehavior): MockFetch;
  /** Consumed in FIFO order before the default behavior. */
  enqueue(...behaviors: MockBehavior[]): MockFetch;
  last(): MockFetchCall;
  /** Parsed JSON request bodies for all calls. */
  requestBodies(): Array<Record<string, unknown>>;
  requestHeaders(index?: number): Record<string, string>;
  /** Response bodies delivered by 'json' behaviors (parsed). */
  deliveredBodies(): unknown[];
}

export function createMockFetch(
  defaultBehavior: MockBehavior = { kind: 'json', body: {} },
): MockFetch {
  const calls: MockFetchCall[] = [];
  const queue: MockBehavior[] = [];
  const delivered: unknown[] = [];

  let currentDefault = defaultBehavior;

  const fetchFn = vi.fn(
    async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, init });
      const behavior = queue.length > 0 ? queue.shift()! : currentDefault;

      switch (behavior.kind) {
        case 'json': {
          delivered.push(behavior.body ?? {});
          return new Response(JSON.stringify(behavior.body ?? {}), {
            status: behavior.status ?? 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        case 'throw':
          throw behavior.error;
        case 'abort': {
          const error = new Error(behavior.message ?? 'The operation was aborted');
          error.name = 'AbortError';
          throw error;
        }
        case 'listen':
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const error = new Error('The operation was aborted');
              error.name = 'AbortError';
              reject(error);
            });
          });
        case 'hang':
          return new Promise<Response>(() => {});
      }
    },
  );

  return {
    fetchFn,
    calls,
    setDefault(behavior: MockBehavior): MockFetch {
      currentDefault = behavior;
      return this;
    },
    enqueue(...behaviors: MockBehavior[]): MockFetch {
      queue.push(...behaviors);
      return this;
    },
    last(): MockFetchCall {
      return calls[calls.length - 1]!;
    },
    requestBodies(): Array<Record<string, unknown>> {
      return calls.map((call) =>
        typeof call.init?.body === 'string'
          ? (JSON.parse(call.init.body) as Record<string, unknown>)
          : {},
      );
    },
    requestHeaders(index = -1): Record<string, string> {
      const call = index < 0 ? calls[calls.length - 1] : calls[index];
      return (call?.init?.headers as Record<string, string>) ?? {};
    },
    deliveredBodies(): unknown[] {
      return [...delivered];
    },
  };
}

/** Convenience: build the successful response usable by OpenAI-compatible tests. */
export function openAIChatCompletion(overrides: Record<string, unknown> = {}) {
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
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    ...overrides,
  };
}

/** Deterministic retry policy tuned for fast tests. */
export function fastRetryPolicy(maxRetries = 2) {
  return {
    maxRetries,
    backoffMs: 2,
    backoffMultiplier: 1,
    maxBackoffMs: 4,
    jitter: 0,
  };
}

// ────────────────────────────────────────────
// Deterministic HTTP streaming fetch (DF-026D)
// ────────────────────────────────────────────

export interface StreamSource {
  /** Raw SSE body fragments, enqueued one `Uint8Array` chunk at a time. */
  readonly chunks?: readonly string[];
  /** Convenience alias for a single chunk. */
  readonly body?: string;
  /** Non-OK HTTP status for this response. */
  readonly status?: number;
  /** Error JSON body for non-OK responses (read by `mapHttpError`). */
  readonly jsonError?: unknown;
  /** Delay (ms) between sequential chunks, enabling observable stalls. */
  readonly intervalMs?: number;
  /** After delivering `chunks[stallAfter]`, stall forever (never close). */
  readonly stallAfter?: number;
  /** Error the underlying stream after delivering this many chunks. */
  readonly errorAfter?: number;
  /** Invoked when the reader is cancelled (abort teardown). */
  readonly onCancel?: () => void;
}

export interface StreamFetch {
  fetchFn: ReturnType<typeof vi.fn>;
  calls: Array<{ url: string; init?: RequestInit }>;
  cancelled: Array<{ index: number; url: string }>;
}

/**
 * Build a mocked `fetch` that returns SSE `Response` objects backed by a
 * controllable `ReadableStream`. The first entry is consumed FIFO; the last
 * entry repeats for subsequent calls (mirroring {@link createMockFetch}).
 */
export function createStreamFetch(
  sources: readonly StreamSource[] | StreamSource = {},
): StreamFetch {
  const queue: StreamSource[] = Array.isArray(sources)
    ? sources.length > 0
      ? [...sources]
      : [{}]
    : [sources];
  const calls: StreamFetch['calls'] = [];
  const cancelled: StreamFetch['cancelled'] = [];

  const fetchFn = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const source = queue.length > 1 ? queue.shift()! : queue[0]!;
    const callIndex = calls.length - 1;
    return buildStreamResponse(source, url, callIndex, cancelled);
  });

  return { fetchFn, calls, cancelled };
}

function buildStreamResponse(
  source: StreamSource,
  url: string,
  callIndex: number,
  cancelled: StreamFetch['cancelled'],
): Response {
  const status = source.status ?? 200;
  const ok = status >= 200 && status < 300;
  const encoder = new TextEncoder();

  let body: ReadableStream<Uint8Array>;
  if (!ok && source.jsonError !== undefined) {
    const text = JSON.stringify(source.jsonError);
    body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(text));
        controller.close();
      },
    });
  } else {
    const chunks = source.chunks ?? (source.body !== undefined ? [source.body] : []);
    body = new ReadableStream<Uint8Array>({
      start(controller) {
        let index = 0;
        const push = (): void => {
          if (index < chunks.length) {
            controller.enqueue(encoder.encode(chunks[index]!));
            index += 1;
            if (source.errorAfter !== undefined && index === source.errorAfter) {
              // Defer so the already-enqueued chunks are delivered first.
              setTimeout(
                () => controller.error(new Error('stream connection reset')),
                0,
              );
              return;
            }
            if (source.stallAfter !== undefined && index > source.stallAfter) {
              return;
            }
            if (source.intervalMs !== undefined && source.intervalMs > 0) {
              setTimeout(push, source.intervalMs);
            } else {
              push();
            }
          } else {
            controller.close();
          }
        };
        push();
      },
      cancel() {
        cancelled.push({ index: callIndex, url });
        source.onCancel?.();
      },
    });
  }

  return new Response(body, {
    status,
    headers: {
      'content-type': ok ? 'text/event-stream' : 'application/json',
    },
  });
}

/** Serialize a single SSE frame (optionally with an `event:` name). */
export function sseFrame(data: string, event?: string): string {
  return (event !== undefined ? `event: ${event}\n` : '') + `data: ${data}\n\n`;
}