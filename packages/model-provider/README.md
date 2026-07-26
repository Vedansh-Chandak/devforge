# @devforge/model-provider

Provider-neutral interface for language models in DevForge.

## Overview

`@devforge/model-provider` defines the common contract for communicating with language models. It ensures DevForge is never coupled to a specific model vendor (OpenAI, Anthropic, Gemini, OpenRouter, Ollama, etc.).

## Architecture

```
Brain → ModelProvider interface → Provider Adapter → External Model
```

The model provider abstraction is consumed by Brain, not Runtime. Runtime remains pure repository intelligence.

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
  temperature?: number;
  maxTokens?: number;
}
```

### ModelResponse

```typescript
interface ModelResponse {
  content: string;
  model?: string;
  finishReason?: FinishReason;
  usage?: ModelUsage;
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

## Development

```bash
pnpm install
pnpm --filter @devforge/model-provider check-types
pnpm --filter @devforge/model-provider build
pnpm --filter @devforge/model-provider test