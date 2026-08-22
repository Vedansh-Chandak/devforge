/**
 * Provider-agnostic model streaming contract (DF-026D).
 *
 * Streaming is additive: `ModelProvider.generate()` is unchanged, and
 * `stream()` lives on a separate capability interface —
 * {@link StreamingModelProvider} — so existing injected implementations of
 * {@link ModelProvider} (which only expose `generate`) remain valid.
 *
 * A provider may implement both interfaces. Consumers detect capability
 * structurally via {@link isStreamingModelProvider} rather than forcing every
 * provider (or every consumer) to be streaming-aware.
 *
 * Events are provider-independent. No OpenAI / Gemini / Anthropic event or
 * chunk types ever leak past the concrete adapters.
 */

import type { FinishReason, ModelProvider, ModelRequest } from './types.js';
import type { ModelProviderError } from './errors.js';

/** Discriminator values of the normalized stream event union. */
export type ModelStreamEventType =
  | 'text_delta'
  | 'usage'
  | 'tool_call'
  | 'completed'
  | 'error';

/**
 * A normalized, provider-independent stream event.
 *
 * The vocabulary is intentionally small:
 *  - `text_delta`   incremental text produced so far
 *  - `usage`        token accounting, when the provider reports any
 *  - `tool_call`    a (fully accumulated) tool invocation
 *  - `completed`    successful terminal event
 *  - `error`        in-band error delivery (adapters may throw instead; the
 *                   variant exists so error-as-event consumers have a shape)
 *
 * Errors that surface while iterating are thrown as {@link ModelProviderError}
 * from the async iterable (e.g. malformed streams, HTTP failures, timeout,
 * cancellation, structured-output validation). Adapters never leak their
 * vendor event types here.
 */
export type ModelStreamEvent =
  | { readonly type: 'text_delta'; readonly text: string }
  | {
      readonly type: 'usage';
      readonly inputTokens?: number;
      readonly outputTokens?: number;
      readonly totalTokens?: number;
      readonly provider?: string;
    }
  | {
      readonly type: 'tool_call';
      readonly id: string;
      readonly name: string;
      readonly arguments: string;
    }
  | {
      readonly type: 'completed';
      readonly finishReason?: FinishReason;
      readonly id?: string;
      readonly model?: string;
      readonly provider?: string;
    }
  | { readonly type: 'error'; readonly error: ModelProviderError };

/** A provider-neutral streaming sequence. */
export type ModelStream = AsyncIterable<ModelStreamEvent>;

/**
 * Streaming capability. A provider that also implements {@link ModelProvider}
 * supports both `generate()` and `stream()`.
 */
export interface StreamingModelProvider {
  readonly id: string;
  stream(request: ModelRequest): ModelStream;
}

/**
 * Structural capability detection: true when `value` exposes `stream()`.
 * Never assumes a concrete adapter or a specific class.
 */
export function isStreamingModelProvider(
  value: unknown,
): value is ModelProvider & StreamingModelProvider {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { stream?: unknown }).stream === 'function'
  );
}

/** Drain a stream into an array of events (tests, small callers). */
export async function collectStream(
  stream: ModelStream,
): Promise<readonly ModelStreamEvent[]> {
  const events: ModelStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

/** Concatenate the `text_delta` payloads of a collected stream. */
export function streamedText(events: readonly ModelStreamEvent[]): string {
  return events
    .map((event) => (event.type === 'text_delta' ? event.text : ''))
    .join('');
}