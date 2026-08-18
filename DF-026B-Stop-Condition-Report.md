# DF-026B Stop-Condition Report

Concrete model-provider adapters connected to the DF-026A provider-agnostic
core. OpenAI-compatible transport rewired onto the shared primitives; Gemini
and Anthropic adapters added; OpenRouter handled via configurable baseUrl (no
separate architecture). Brain, Planner, Autonomous Agent, Multi-Agent,
Executor, CLI, VS Code, GitHub, and Memory remain provider-agnostic.

## 1. Files created / changed

Created (`packages/model-provider/src/`):
- `transport.ts` — provider-internal HTTP transport: URL construction, header
  building, bearer/header auth injection, shared HTTP-status → normalized error
  classification, AbortSignal propagation, full redaction of diagnostics,
  injectable `fetch`. The only network-facing code in the package.
- `gemini.ts` — `GeminiProvider` adapter (config, translation helpers
  `toGeminiContents`, `toGeminiResponseSchema`, `mapGeminiFinishReason`,
  `extractGeminiUsage`, `geminiClassifyHttpStatus`).
- `anthropic.ts` — `AnthropicProvider` adapter (`toAnthropicMessages`,
  `mapAnthropicStopReason`, `extractAnthropicUsage`).
- `factory.ts` — `createModelProvider` registry + `getProviderInfo` /
  `listProviderKinds`.

Changed:
- `openai-compatible.ts` — rewired onto `retry` / `withTimeout` /
  `validateProviderConfig` / `redactSecrets` / `assertStructuredOutput`;
  `responseFormat` → `response_format`; per-request `model`/`timeoutMs`/
  `maxRetries`; `provider` + `id` on responses; additive config fields
  (`maxRetries`, `retryPolicy`, `fetch`, `onRetry`); constructor messages and
  behavior preserved.
- `types.ts` — additive `ModelResponse.provider?: string`.
- `index.ts` — exports the new adapters, factory, and transport helpers.
- `README.md` — provider table, factory example, normalization notes.

Tests (created/updated under `src/__tests__/`):
- `transport.test.ts` (29) — new.
- `openai-compatible.test.ts` (65, was 50) — +structured output, retry,
  retry exhaustion, per-request overrides, partial usage, concurrency.
- `gemini.test.ts` (28), `anthropic.test.ts` (27) — new.
- `cross-provider.test.ts` (9), `security.test.ts` (8), `factory.test.ts`
  (6) — new.
- `helpers/mock-fetch.ts` — deterministic mocked-fetch controller.

## 2. Providers implemented

- `OpenAICompatibleProvider` (rewired, reference adapter) — chat-completions
  transport with configurable baseUrl + bearer auth, structured output, usage
  extraction, normalized errors, timeout, cancellation, retries. Does NOT
  assume the endpoint is OpenAI.
- `GeminiProvider` — normalized contract over Google `generateContent`
  (`x-goog-api-key` header auth).
- `AnthropicProvider` — normalized contract over the Messages API
  (`x-api-key` + `anthropic-version`).
- `FakeModelProvider` — untouched and still green.

## 3. Normalized provider architecture

All adapters implement `ModelProvider { id; generate(request) }`. Each
adapter owns only its vendor translation; everything else (retry, timeout,
redaction, validation, structured-output validation, request validation) is
shared DF-026A code. The shared `HttpTransport` isolates HTTP. `factory.ts`
maps a normalized provider kind + config to an adapter — application layers
never name concrete providers.

## 4. Authentication / configuration design

Credentials come from configuration / environment injection only; never
hard-coded or committed. Each adapter supports `apiKey` plus the common
`model`, `baseUrl`, `timeoutMs`, `maxRetries`, `retryPolicy`, `headers`,
`fetch`, `onRetry`. Auth is attached as a header (`Authorization: Bearer` /
`x-goog-api-key` / `x-api-key`) inside the transport; the raw key is added to
the redaction secret set so it can never reach messages, retry metadata, or
serialized errors. Config validation reuses `validateProviderConfig` /
`assertValidProviderConfig`.

## 5. Retry / timeout / cancellation behavior

- All providers use the shared `retry` + `withTimeout` primitives; no
  provider-specific retry loops.
- Centralized classification: only `retryable` errors with a code in
  `DEFAULT_RETRYABLE_CODES` are retried; `CANCELLED` is never retried.
- Default `maxRetries: 2`; per-request `maxRetries` / `timeoutMs` override.
- `withTimeout` distinguishes `TIMEOUT` (retryable) from `CANCELLED`
  (non-retryable); external `AbortSignal` propagates to the fetch and to
  backoff sleeps.
- Provider-side `AbortError` that is not an external abort normalizes to
  `TIMEOUT` (preserves the historical OpenAI-compatible behavior).

## 6. Structured-output behavior

`responseFormat` (`json_schema` / `json_object`) is translated per adapter:
OpenAI `response_format`, Gemini `responseMimeType`+`responseSchema`,
Anthropic JSON instruction appended to the system prompt. Validation is
always provider-independent via `assertStructuredOutput` / `parseJsonContent`;
malformed or schema-mismatched responses throw a non-retryable
`PROVIDER_ERROR` and never become successful responses.

## 7. Usage accounting

Normalized to `{ inputTokens, outputTokens, totalTokens }`. Only fields the
provider actually returns are populated; missing usage → `undefined`. No
fabricated values. Anthropic's `totalTokens` is derived as input+output (both
returned by the provider); Gemini and OpenAI pass through
`promptTokenCount`/`prompt_tokens` etc. directly.

## 8. Security / redaction decisions

- `HttpTransport` redacts every diagnostic (URL, extracted provider error
  message, network error text, error `cause`, stack) with
  `redactSecrets(…, [apiKey, …])`.
- Error `cause` is a redacted clone so `JSON.stringify(error)` and
  `String(error.cause)` can never leak a key.
- Retry `onRetry` callbacks observe only redacted errors.
- `ModelResponse` never carries headers/credentials; `provider` is the only
  metadata added.
- Hostile provider bodies that echo the adapter's own key are redacted
  (each adapter redacts its own credential; another vendor's key is outside
  its knowledge).
- Tests assert key-absence in thrown errors, serialized errors, retry
  metadata, and response objects.

## 9. Test count

**310 tests, 310 passing across 14 suites** (was 188 in DF-026A).

- selection 15, validate 22, structured 19, provider 30, retry 28, timeout 13,
  redact 11, transport 29 (new), openai-compatible 65, gemini 28 (new),
  anthropic 27 (new), cross-provider 9 (new), security 8 (new), factory 6 (new).

All tests use injected/mocked HTTP — no real provider API is ever called.

## 10. Package verification

- `pnpm --filter @devforge/model-provider check-types` — clean
- `pnpm --filter @devforge/model-provider build` — clean
- `pnpm --filter @devforge/model-provider test` — 310/310

## 11. Root verification

- `pnpm check-types` — 23/26 tasks successful; the only failure is
  `@devforge/vscode-extension`, which fails on a pre-existing tsconfig
  incompatibility unrelated to this work (the extension does not depend on
  model-provider).
- `pnpm build` — 25/26 (same pre-existing vscode-extension failure).
- `pnpm test` — 46/46 tasks successful.
- `pnpm lint` — 3/3 tasks successful (model-provider has no lint script).

## 12. Backward compatibility status

Strictly additive. Existing consumers (brain, planner, execution,
prompt-composer, core, cli, integration-tests) typecheck and test green with
the rebuilt dist. `OpenAICompatibleProvider` keeps its constructor signature,
error messages, URL contract, and all 50 legacy tests. `FakeModelProvider` is
unchanged. The only behavioral addition is default retries (2) on retryable
failures — previously the provider had no retry path.

## 13. Known limitations

- Streaming is not part of the public `generate()` contract; no stream
  implementation was added (documented as future work in README and via
  `ModelCapabilities.supportsStreaming`).
- Anthropic `totalTokens` is derived from input+output rather than returned
  verbatim (Anthropic does not return a total).
- The default `maxRetries: 2` makes retryable-failure tests slower (~600 ms
  each) because they exercise real backoff; deterministic fast backoff is
  available via `retryPolicy` for suites that need it.
- Redaction covers each adapter's own credential plus structural secret
  patterns; an adapter does not know other vendors' keys.

## 14. Exact remaining scope for DF-026C

- Wire the new adapters (gemini / anthropic) into `@devforge/core`'s
  `provider-factory.ts` + config schema and env parsing (`DEVFORGE_MODEL_*`).
- Model routing across the application (selecting adapters/models per role).
- Streaming support if the normalized contract is extended.
- Optionally surface `ModelCapabilities` / `ModelProviderInfo` from adapters.
- Fix the pre-existing `@devforge/vscode-extension` tsconfig incompatibility.

No commits were made.
