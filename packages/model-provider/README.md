# @devforge/model-provider

Provider-neutral interface for language models in DevForge.

## Overview

`@devforge/model-provider` defines the common contract for communicating with language models. It ensures DevForge is never coupled to a specific model vendor (OpenAI, Anthropic, Gemini, OpenRouter, Ollama, etc.).

## Architecture

```
Brain → ModelProvider interface → Provider Adapter → External Model
```

The model provider abstraction is consumed by Brain, not Runtime. Runtime remains pure repository intelligence.

## Concrete provider adapters (DF-026B)

All adapters implement the same normalized `ModelProvider` contract and share
the DF-026A primitives (retry, timeout, redaction, validation,
structured-output). No Brain/Planner/Executor code references a concrete
adapter — application wiring goes through `createModelProvider`.

| Adapter | id | Auth header | Endpoint |
| --- | --- | --- | --- |
| `OpenAICompatibleProvider` | `openai-compatible` | `Authorization: Bearer` | `POST {baseUrl}/chat/completions` |
| `GeminiProvider` | `gemini` | `x-goog-api-key` | `POST {baseUrl}/v1beta/models/{model}:generateContent` |
| `AnthropicProvider` | `anthropic` | `x-api-key` + `anthropic-version` | `POST {baseUrl}/v1/messages` |

### Factory (no vendor knowledge outside the adapters)

```ts
import { createModelProvider, createModelProviderFromConfig } from '@devforge/model-provider';

// Normalized config form (DF-026C) — the single application-facing entry point:
const provider = createModelProvider({
  provider: 'openai-compatible',
  model: 'openai/gpt-4o',
  baseUrl: 'https://openrouter.ai/api/v1', // OpenRouter via baseUrl
  apiKey: process.env.OPENROUTER_API_KEY,
});

// Equivalent explicit form (backward compatible):
const same = createModelProvider('openai-compatible', {
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  model: 'openai/gpt-4o',
});
```

OpenRouter and other OpenAI-compatible endpoints are reached through the
`openai-compatible` adapter with a configurable `baseUrl` — no separate
OpenRouter adapter is needed.

### Normalization

- **Requests**: model, messages, system instructions, temperature, max
  tokens, structured output, `AbortSignal` are translated inside each adapter.
- **Responses**: `content`, `model`, `finishReason`, `provider`, `usage`,
  `id` — usage is only populated from values the provider actually returns.
- **Errors**: every failure maps to a `ModelProviderError` with a normalized
  code (`AUTHENTICATION_ERROR`, `RATE_LIMITED`, `TIMEOUT`, `CANCELLED`,
  `INVALID_REQUEST`, `MODEL_NOT_FOUND`, `PROVIDER_ERROR`, `NETWORK_ERROR`,
  `UNKNOWN`) and a deterministic `retryable` flag. Retry classification stays
  centralized in `retry.ts`.
- **Security**: API credentials are never logged, serialized, attached to
  errors, or surfaced in retry metadata. All diagnostics run through
  `redactSecrets`, including provider-supplied error messages.

## Normalized model configuration + routing (DF-026C)

Application wiring should use the single normalized entry point plus the
deterministic role router. `model-config.ts` holds the provider-neutral config
shape (`ModelConfig`, `ModelProviderKind`, env parsing, validation, redaction);
`router.ts` resolves a role to a provider with no vendor knowledge.

### ModelRouter — deterministic role→provider selection

Roles (`reasoning`, `coding`, `fast`) resolve through a documented fallback:
explicit role config → default config → FakeModelProvider (only when
`allowFakeFallback` is enabled for tests/dev). A runtime API failure is never
silently downgraded to a fake provider. Routed providers are cached per role.

```ts
import { createModelRouter } from '@devforge/model-provider';

const router = createModelRouter({
  defaultConfig: {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    apiKey: process.env.GEMINI_API_KEY,
  },
  roleConfigs: {
    coding: { model: 'gemini-2.5-pro' },   // inherits provider/baseUrl/apiKey
    fast: { model: 'gemini-2.5-flash-lite' },
  },
});

const reasoning = router.select('reasoning');   // gemini-2.5-flash
const coding = router.select('coding');          // gemini-2.5-pro
router.redactedConfigFor('coding');              // apiKey → '***'
```

Env parsing (`parseModelConfigEnv`) reads `DEVFORGE_MODEL_PROVIDER`,
`DEVFORGE_MODEL`, `DEVFORGE_MODEL_BASE_URL`, `DEVFORGE_MODEL_API_KEY`,
`DEVFORGE_MODEL_TIMEOUT_MS`, `DEVFORGE_MODEL_MAX_RETRIES` and the role vars
`DEVFORGE_REASONING_MODEL`, `DEVFORGE_CODING_MODEL`, `DEVFORGE_FAST_MODEL`.
Never throws: malformed values are skipped.

## Public API

### ModelProvider Interface

```typescript
interface ModelProvider {
  readonly id: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
}
```

### ModelRequest

```typescript
interface ModelRequest {
  messages: ModelMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
  responseFormat?: { type: 'json_schema'; schema: StructuredOutputSchema } | { type: 'json_object' };
  metadata?: Readonly<Record<string, unknown>>;
}
```

### ModelResponse

```typescript
interface ModelResponse {
  content: string;
  model?: string;
  finishReason?: FinishReason;
  usage?: ModelUsage;
  id?: string;
  provider?: string;
}
```

### Error Model

```typescript
class ModelProviderError extends Error {
  readonly provider: string;
  readonly code: ModelErrorCode;
  readonly retryable: boolean;
}
```

### FakeModelProvider

Deterministic test provider requiring no network access:

```typescript
import { FakeModelProvider } from '@devforge/model-provider';

const provider = new FakeModelProvider({
  response: { content: 'Authentication uses JWT.' }
});

const response = await provider.generate({
  messages: [{ role: 'user', content: 'Explain auth' }]
});
```

## Streaming

The normalized `generate()` contract is request/response only. Streaming is
tracked as future work via `ModelCapabilities.supportsStreaming`; no
provider-specific stream events leak outside the adapters.

## Development

```bash
pnpm install
pnpm --filter @devforge/model-provider check-types
pnpm --filter @devforge/model-provider build
pnpm --filter @devforge/model-provider test