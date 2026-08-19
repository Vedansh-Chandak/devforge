# DF-026D Stop-Condition Report

**Phase:** DF-026D — provider-agnostic model streaming over the normalized model-provider system
**Date:** 2026-08-18
**Stop condition:** all three concrete adapters (openai-compatible, gemini, anthropic) stream via a normalized async-iterable contract with text deltas, usage, tool calls, completion, cancellation, timeout, retry, and structured-output semantics; deterministic tests green at package and root level; no commit made.

## 1. Objective and scope

Deliver streaming over the DF-026A/B contract in a provider-agnostic way:
a normalized event vocabulary, a capability-level `StreamingModelProvider`
interface left *off* the base `ModelProvider` (see §7), raw SSE transport,
timeout/retry/cancellation wrappers, adapter implementations for all three real
providers, a scriptable fake stream for determinism, security redaction of stream
errors, structured-output validation against the buffered text, tests, and this
report. Stop after DF-026D — no commit.

## 2. Files created (new)

- `packages/model-provider/src/streaming.ts` — the normalized streaming contract:
  `ModelStreamEventType`, `ModelStreamEvent` union, `ModelStream` (async
  iterable), `StreamingModelProvider`, `isStreamingModelProvider` (structural
  guard), `collectStream`, `streamedText`.
- `packages/model-provider/src/sse.ts` — `SseRecord`, `parseSse` async generator
  (event names, multiline `data`, CRLF, comments, unknown fields, partial frames,
  trailing event at EOF, read-only records).
- `packages/model-provider/src/__tests__/streaming-contract.test.ts` (9),
  `sse.test.ts` (10), `openai-stream.test.ts` (16), `gemini-stream.test.ts` (7),
  `anthropic-stream.test.ts` (7), `fake-stream.test.ts` (8),
  `stream-security.test.ts` (4), `stream-structured.test.ts` (6).
- `DF-026D-Stop-Condition-Report.md` (this report).

## 3. Files changed (modified)

- `packages/model-provider/src/transport.ts` — `HttpStreamResponse` type,
  `raceAgainstSignal` (rejects with AbortError even if fetch never settles),
  `readStreamBody` (cancellation-aware body reader, clean `releaseLock`),
  `HttpTransport.postStream()` (raw streaming response, HTTP/network failures
  normalized identically to `post`), `HttpTransport.sanitize()`.
- `packages/model-provider/src/timeout.ts` — `withStreamTimeout` generator
  wrapper (race vs. internal AbortController; losers suppressed; no events after
  outcome).
- `packages/model-provider/src/retry.ts` — `withStreamingRetry` generator wrapper
  (retries only while no output has been produced; cancellation during backoff →
  `CANCELLED`).
- `packages/model-provider/src/openai-compatible.ts` — now
  `implements StreamingModelProvider`; `stream()` + `executeStream()`, SSE via
  `parseSse(readStreamBody(...))`, `stream:true` body, `[DONE]` sentinel,
  `parseChunk`, `ToolCallAccumulator`/`accumulateToolCall` (tool_call events
  flushed once at the end), single `usage` event, truncated-stream detection,
  structured-output validation before `completed`.
- `packages/model-provider/src/gemini.ts` — now
  `implements StreamingModelProvider`; constant
  `STREAM_GENERATE_CONTENT_PATH = '/v1beta/models/:model:streamGenerateContent?alt=sse'`;
  `stream()` + `executeStream()` (SSE blob parsing, `extractGeminiUsage`,
  `mapGeminiFinishReason`, content-or-finishReason requirement).
- `packages/model-provider/src/anthropic.ts` — now
  `implements StreamingModelProvider`; `stream()` + `executeStream()`,
  `AnthropicBlockState`/`AnthropicStreamState`,
  `translateAnthropicRecord` (message_start / content_block_start / delta /
  stop / message_delta / message_stop / error → normalized error / ping ignored),
  `anthropicStreamError` (rate_limit → RATE_LIMITED retryable); `message_stop`
  required for completion.
- `packages/model-provider/src/testing/fake-provider.ts` — `FakeProviderStreamConfig`,
  `FakeProviderConfig.stream`; deterministic `stream()` async generator with
  scripted events, optional failure, per-event delay, cancellation checks between
  events, `defaultStreamEvents()` fallback, `waitFor`/`cancelled` helpers.
- `packages/model-provider/src/index.ts` — streaming contract, `parseSse`,
  `SseRecord`, `HttpStreamResponse`, `raceAgainstSignal`, `readStreamBody`,
  `withStreamTimeout`, `withStreamingRetry`, `FakeProviderStreamConfig` exported.
- `packages/model-provider/src/__tests__/helpers/mock-fetch.ts` — `StreamSource`,
  `StreamFetch`, `createStreamFetch`, `buildStreamResponse`, `sseFrame`;
  `errorAfter` defers `controller.error` so queued chunks deliver first.

## 4. Normalized streaming contract (`streaming.ts`)

- Voice-limited event vocabulary, provider-neutral and versioned by union:
  `text_delta`, `usage`, `tool_call`, `completed`, `error`.
- `ModelStream = AsyncIterable<ModelStreamEvent>`. Adapters *throw* errors while
  iterating (single error path); the `error` event variant exists for consumers
  (e.g. the fake provider) that need to surface errors in-band.
- `isStreamingModelProvider` is a structural guard (`stream` is a function) so
  generate-only providers are detectable without instanceof.
- Helpers: `collectStream` (materialize + assert-fail helper shape),
  `streamedText` (concatenate text deltas in order).

## 5. SSE parsing (`sse.ts`)

- `parseSse` is an async generator over chunked bytes/strings. Normalizes to
  `SseRecord { event?, data }`. Handles multi-line `data` merging, LF/CRLF,
  comment lines, unknown fields, `event:` names, partial frames split across
  chunks, and a terminal event without a trailing blank line.

## 6. Transport / timeout / retry semantics

- `postStream` returns the raw streaming `Response`; HTTP failures reuse the
  existing normalization (status classification + `mapFetchFailure` redaction),
  network failures map identically to `generate()`.
- `raceAgainstSignal`: if the external signal aborts while a fetch is in flight,
  the consumer sees an AbortError immediately (well-formed `try`/`return`/`finally`
  loop teardown).
- `withStreamTimeout`: caps the stream duration. Timeout → `ModelErrorCode.TIMEOUT`
  (`retryable: true`); external cancellation → `CANCELLED` (`retryable: false`).
  The internal controller aborts the fetch; the losing party's events are never
  emitted after an outcome.
- `withStreamingRetry`: retries only while zero output bytes/events have been
  produced, honoring the request's `maxRetries` policy. Once output begins,
  failures rethrow (no token duplication).

## 7. Interface decision: streaming NOT on `ModelProvider`

`stream()` lives on a separate `StreamingModelProvider`, not the base interface,
because `apps/cli/__tests__/helpers.ts` has `ScriptedProvider implements
ModelProvider`; adding a required method would break that (and any downstream
generate-only provider). Adapters implement `ModelProvider & StreamingModelProvider`;
`ModelCapabilities.supportsStreaming: true` (pre-existing flag) now reflects
reality for the four built-in providers.

## 8. Tool calls

- Provider-neutral `tool_call` events carry the tool name, JSON-encoded
  arguments, and index. Adapters stay vendor-local until the boundary:
  OpenAI tool_call deltas are accumulated via `ToolCallAccumulator`/`accumulateToolCall`
  (mutating), Anthropic `input_json_delta` fragments are merged into one
  `text`-escaped arguments object per block. Tool calls are emitted as complete
  events at stream end (before `completed`).

## 9. Structured output over streams

- Adapters buffer normalized text, then validate the full JSON once with the
  DF-026A validator (`assertStructuredOutput`) before emitting `completed`, only
  when the request had a `responseFormat`. Malformed or schema-invalid output
  yields a non-retryable `PROVIDER_ERROR` and never a `completed` event —
  verified for openai, gemini, and anthropic.

## 10. Fake provider streaming

- `FakeModelProvider.stream()` is a deterministic async generator: scripted
  `events` (with optional `delay`), `error` simulation, immediate cancellation of
  pre-aborted signals, cancellation checks between events, and history recording.
  Without scripted events, a canonical text → usage → completed sequence is
  derived from the configured `response`.

## 11. Security / redaction

- Malformed SSE payloads and in-band Anthropic `error` records pass through
  `transport.sanitize()`; hostile HTTP error bodies are redacted by
  `mapFetchFailure`. Tests assert the API key never appears in `message`, in
  `JSON.stringify(error)`, or in serialized errors for all three adapters
  (`sk-` and `anthropic-` keys both covered).

## 12. Test counts

| Package | Before | After | Added |
| --- | --- | --- | --- |
| model-provider | 366 / 17 files | 433 / 25 files | 67 tests in 8 files |

New suites: `streaming-contract` (9), `sse` (10), `openai-stream` (16),
`gemini-stream` (7), `anthropic-stream` (7), `fake-stream` (8),
`stream-security` (4), `stream-structured` (6). All HTTP is injected via
`createStreamFetch` (ReadableStream-backed SSE responses with cancel tracking) or
the scriptable fake provider — no real API calls anywhere.

## 13. Package verification

- `pnpm --filter @devforge/model-provider check-types`: pass (tsc --noEmit).
- `pnpm --filter @devforge/model-provider build`: pass.
- `pnpm --filter @devforge/model-provider test`: 433/433, 25 files.

## 14. Root verification

- `pnpm check-types`: 26/26 packages pass.
- `pnpm build`: 26/26 pass (includes vscode-extension).
- `pnpm test`: 46/46 task targets pass (includes vscode-extension, 311 tests).
- `pnpm lint`: 3/3 pass (`--max-warnings 0`).

## 15. Backward compatibility status

- `ModelProvider` interface, `generate()`, all adapter constructors, and
  `createModelProvider` signatures unchanged; `stream()` is additive behind the
  new interface.
- `apps/cli` `ScriptedProvider` (base interface only) compiles unchanged.
- `FakeModelProvider` deterministic `generate()` path unchanged; `stream` config
  is additive.
- No public exports removed from the package; `index.ts` only adds surface.

## 16. Known limitations

- Streaming focused on text/tool-call/meta events; audio/image stream part
  types are not modeled.
- Anthropic usage is derived from `message_start` input + `message_delta` output
  totals; per-token detail is not exposed.
- Retry is configured at request level via the existing `maxRetries` policy; a
  distinct per-stream backoff strategy is out of scope.
- The `error` event variant is only emitted by the fake provider; adapters throw
  (`collectStream` surfaces them uniformly).

## 17. Streaming decision (stop-condition gate)

Streaming is now implemented over the normalized contract. The 4 built-in
providers advertise `supportsStreaming` and stream with normalized events;
downstream integration (exposing streams through brain/planner/CLI) is explicitly
deferred — wiring is a separate follow-up, not part of DF-026D.

## 18. Remaining scope after DF-026D

- Surface streams through `@devforge/brain`, `@devforge/planner`, and the CLI
  (token streaming to users / live tool-call UX).
- Optional `ModelCapabilities` / `ModelProviderInfo` surfacing from adapters.
- Swarm-layer wiring that selects model-backed paths via
  `resolveModelRolesFor`.

No commits were made.