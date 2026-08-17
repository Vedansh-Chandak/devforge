# @devforge/brain

Orchestrates the pipeline that turns a natural-language question into a structured `ModelRequest` with repository context.

## Architecture

```
Question → Intent Classification → Context Retrieval → Prompt Composition → Provider Call → AskResult
    │              │                        │                      │                │
    │         classifyIntent()        runtime.execute()    composer.compose()   provider.generate()
    │              │                        │                      │                │
    │         IntentKind              PipelineContext       ModelRequest      ModelProviderResponse
    │              │                        │                      │                │
    ▼              ▼                        ▼                      ▼                ▼
  invalid ──→ Unknown ──────────→ classified (no provider)
                    │
         non-Unknown + provider ──→ answered / provider_error
```

### Pipeline Steps

| Step | Layer | Function | Description |
|------|-------|----------|-------------|
| 1. Receive | Brain | `ask()` | Trims whitespace, validates input |
| 2. Classify | Intent | `classifyIntent()` | Maps question text → `IntentKind` (regex, no LLM) |
| 3. Validate | Brain | — | Empty → `BrainInvalidInput`; Unknown → `AskClassifiedResult` |
| 4. Execute Runtime | Runtime | `runtime.execute()` | Collects repository metadata (symbol graph, knowledge graph, etc.) |
| 5. Build Context | Brain | `buildContextFromMetadata()` | Maps `PipelineContext.metadata` → `ComposerContext` |
| 6. Compose Prompt | PromptComposer | `composer.compose()` | Assembles system + user messages with context, handles truncation |
| 7. Call Provider | ModelProvider | `provider.generate()` | Sends `ModelRequest` to LLM, receives `ModelProviderResponse` |
| 8. Return Result | Brain | — | Returns `BrainAnswer` with answer text, model info, and timing metadata |

### Result Types

```typescript
type AskResult =
  | BrainInvalidInput      // status: 'invalid' — empty/whitespace question
  | AskClassifiedResult    // status: 'classified' — intent classified, no provider call
  | BrainAnswer            // status: 'answered' — full pipeline completed
  | BrainProviderError;    // status: 'provider_error' — runtime or provider failure

interface BrainAnswer {
  question: string;
  intent: IntentKind;
  status: 'answered';
  answer: string;              // LLM response text
  model: {
    provider: string;          // provider ID
    model?: string;            // model name from provider
    finishReason?: FinishReason;
    usage?: ModelUsage;
  };
  metadata: {
    contextTruncated: boolean;
    duration: number;          // total ms
    runtimeDuration: number;   // ms spent in runtime.execute()
    providerDuration: number;  // ms spent in provider.generate()
  };
}
```

## Usage

```typescript
import { DevForgeBrain } from '@devforge/brain';

const brain = new DevForgeBrain({
  runtime: myRuntime,
  provider: myProvider,        // optional — without it, only classification
  maxContextChars: 100_000,    // optional, default 100000
});

await brain.initialize();

const result = await brain.ask('Explain authentication');

switch (result.status) {
  case 'answered':
    console.log(result.answer);
    console.log(`Model: ${result.model.model}, tokens: ${result.model.usage?.totalTokens}`);
    console.log(`Duration: ${result.metadata.duration}ms`);
    break;
  case 'classified':
    console.log(`Intent: ${result.intent} (no provider configured)`);
    break;
  case 'invalid':
    console.error(result.error);
    break;
  case 'provider_error':
    console.error(`${result.error} (code: ${result.errorCode})`);
    break;
}

await brain.dispose();
```

## Edge Cases

| Input | Result | Status |
|-------|--------|--------|
| `''` or `'   '` | `BrainInvalidInput` | `'invalid'` |
| `'make coffee'` | `AskClassifiedResult` | `'classified'` with `Unknown` intent |
| `'Explain auth'` (no provider) | `AskClassifiedResult` | `'classified'` with `ExplainCode` intent |
| `'Explain auth'` (with provider) | `BrainAnswer` | `'answered'` with full response |
| Provider throws | `BrainProviderError` | `'provider_error'` with error details |
| Runtime throws | `BrainProviderError` | `'provider_error'` wrapping runtime error |

## API

### `DevForgeBrain`

```typescript
class DevForgeBrain {
  constructor(config: BrainConfig);
  initialize(): Promise<void>;    // idempotent
  dispose(): Promise<void>;
  ask(question: string): Promise<AskResult>;    // full pipeline
  askWithContext(question: string, context: ComposerContext): PromptComposerResult | null;
  get runtimeReady(): boolean;
}
```

### `classifyIntent`

Pure function. Maps question text → `IntentKind` using regex patterns. No LLM call.

```typescript
function classifyIntent(question: string): ClassifyIntentResult;
```

### `buildContextFromMetadata`

Maps raw runtime metadata (PipelineContext) → ComposerContext for the prompt composer.

```typescript
function buildContextFromMetadata(metadata: Record<string, unknown>): ComposerContext;
```

### `PipelineState` helpers

```typescript
createPipelineState(question: string): PipelineState;
validateQuestion(state: PipelineState): PipelineState;
completeClassification(state: PipelineState, result: AskResult): PipelineState;