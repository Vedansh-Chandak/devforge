# @devforge/runtime

The DevForge Runtime is the analysis-layer runtime that owns repository analysis lifecycle and graph construction:

**Repository Indexer → TypeScript Parser → Symbol Graph → Knowledge Graph**

The Runtime is intentionally scoped to repository analysis. It does NOT contain any LLM logic, prompt generation, AI planning, tool execution, sessions, or conversation state. Those concerns belong to the Brain (DF-010.2+).

## Installation

```bash
pnpm add @devforge/runtime
```

## Usage

```typescript
import { DevForgeRuntime, createRuntime } from '@devforge/runtime';

const runtime = createRuntime({
  workspaceRoot: '/path/to/your/project',
});

await runtime.initialize();
const result = await runtime.execute();

if (result.success) {
  console.log('Analysis complete!');
  // Access results via result.context.metadata
  const knowledgeGraph = result.context.metadata.knowledgeGraph;
  const symbolGraph = result.context.metadata.symbolGraph;
  const parsedFiles = result.context.metadata.parsedFiles;
  const repositoryTree = result.context.metadata.repositoryTree;
}

await runtime.dispose();
```

## API

### `DevForgeRuntime`

Main runtime class.

#### Constructor

```typescript
new DevForgeRuntime(config: RuntimeConfig)
```

**RuntimeConfig:**
- `workspaceRoot: string` - Root path of the workspace to analyze
- `config?: object` - Optional per-stage configuration overrides

#### Methods

- `initialize(): Promise<void>` - Initialize the runtime
- `execute(): Promise<RuntimeResult>` - Execute the full analysis pipeline
- `dispose(): Promise<void>` - Clean up resources

### `createRuntime(config: RuntimeConfig): DevForgeRuntime`

Factory function to create a runtime instance.

## Pipeline Stages

1. **repository-indexer** - Scans the repository and builds a file tree
2. **typescript-parser** - Parses TypeScript/TSX files using @devforge/parser-typescript
3. **symbol-graph** - Builds a symbol graph from parsed files
4. **knowledge-graph** - Constructs a knowledge graph from symbols and parsed files

## RuntimeResult

```typescript
interface RuntimeResult {
  success: boolean;
  context: PipelineContext;
  duration: number;
}
```

## PipelineContext

```typescript
interface PipelineContext {
  workspaceRoot: string;
  metadata: Record<string, unknown>;
  errors: PipelineError[];
}
```

The `metadata` object contains:
- `repositoryTree` - Repository tree from indexer
- `parsedFiles` - Parsed TypeScript files
- `symbolGraph` - Symbol graph
- `knowledgeGraph` - Knowledge graph

## Responsibility Boundary

The Runtime is limited to:

- Repository lifecycle (scan, dispose)
- Analysis lifecycle (initialize, execute)
- Graph construction (symbol graph, knowledge graph)
- Context generation (parsed files, indexes)
- Exposing repository state (via metadata)

The Runtime MUST NOT contain:

- LLM logic
- Prompt generation
- AI planning
- Tool execution
- Sessions
- Memory
- Conversation state

## License

MIT
