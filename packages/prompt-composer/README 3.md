# @devforge/prompt-composer

Deterministic prompt composition layer for DevForge Brain. Converts structured repository context + user question into a provider-neutral `ModelRequest`.

## Architecture

**Zero external dependencies** (only `@devforge/model-provider` for type compatibility). The composer never calls a model and produces no side effects.

### Files

| File | Responsibility |
|------|---------------|
| `types.ts` | Intent, symbol, dependency, architecture, and context types |
| `templates.ts` | System message template (deterministic, no timestamps) |
| `formatter.ts` | Formatting: symbols, dependencies, architecture, user content, truncation |
| `composer.ts` | `PromptComposer` class + `composePrompt` function |
| `index.ts` | Public API barrel |

### Data Flow

```
Question + Intent + Context
        │
        ▼
   PromptComposer.compose()
        │
        ├─ classifyIntent (brain-level, already done before calling compose)
        ├─ buildUserContent (formatter.ts)
        │   ├─ formatSymbols (alphabetically sorted)
        │   ├─ formatDependencies (alphabetically sorted)
        │   ├─ formatArchitecture (alphabetically sorted sections)
        │   ├─ formatSymbols for search results
        │   └─ raw context with --- delimiters
        ├─ truncateContent (line-boundary truncation)
        └─ compose ModelRequest { system, user }
```

## Usage

```typescript
import { PromptComposer, composePrompt } from '@devforge/prompt-composer';

// Class-based
const composer = new PromptComposer({ maxContextChars: 50000 });
const result = composer.compose({
  question: 'Explain authentication',
  intent: 'ExplainCode',
  context: {
    symbols: [{ name: 'AuthService', kind: 'class', file: 'src/auth.ts' }],
    dependencies: [{ from: 'AuthController', to: 'AuthService' }],
  },
});

// Function-based
const result = composePrompt(input, { maxContextChars: 50000 });

// Result
if (result) {
  console.log(result.request.messages);  // ModelRequest.messages
  console.log(result.truncated);          // boolean
}
```

## Intent Routing

| Intent | Behavior |
|--------|----------|
| `ExplainCode` | Includes question + available context |
| `FindSymbol` | Prioritizes symbol context |
| `FindDependencies` | Prioritizes dependency context |
| `Architecture` | Prioritizes architecture context |
| `Search` | Prioritizes search results |
| `Unknown` | Returns `null` — no model request generated |

## Context Formatting

- Symbols: `- Name — kind — file (module)` — alphabetically sorted
- Dependencies: `- From → To` — alphabetically sorted
- Architecture sections: Modules, Services, APIs, Repositories, Databases, Relationships
- Truncation: Always at line boundaries, preserves readability
- Injection safety: Repository text is treated as data in "Additional Context" section, never as instruction

## Testing

```bash
pnpm test
```

49 tests covering:
- All intent types
- Context formatting and sorting
- Truncation at line boundaries
- Determinism (identical output for identical input)
- Unknown intent returns null
- Empty/partial context handling
- Context injection safety