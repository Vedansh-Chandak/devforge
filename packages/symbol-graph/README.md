# @devforge/symbol-graph

Deterministic graph built from parser output for one or many files.

```
Parser → Symbol Graph → Knowledge Graph → Context Builder → AI Brain
```

## Responsibilities

- Convert a `ParseResult` into a typed graph:
  - **Nodes**: `File`, `Class`, `Function`, `Interface`, `Enum`, `TypeAlias`.
  - **Edges**: `imports`, `exports`, `defines`, `contains`.
- Provide O(1) lookups: by id, by kind, outgoing/incoming neighbors.

## Non-responsibilities (this milestone)

- Call graph.
- Inheritance / reference graph.
- Module resolution (cross-file references).
- AI, embeddings, persistence.

## Public API

```ts
import { buildSymbolGraph } from "@devforge/symbol-graph";

const graph = buildSymbolGraph({
  files: [
    {
      filePath: "src/index.ts",
      symbols: [
        { name: "main", kind: "function", exported: true, line: 1, column: 0 },
      ],
    },
  ],
});

graph.nodesByKind("function");                    // all Function nodes
graph.outgoing(fileId, "imports");                // edges of one kind
```

## Status

Story **DF-006.3** — Symbol Graph. Awaiting Tech Lead review.
