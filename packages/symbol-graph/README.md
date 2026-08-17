# @devforge/symbol-graph

**Cross-file symbol resolution with typed edges (imports, extends, implements, calls, references, declares, typeOf, valueOf, overrides).**

Third stage of the DevForge pipeline. Builds a unified symbol graph from parsed TypeScript files, resolving cross-file references and establishing typed relationships between symbols.

---

## Purpose

- Unify symbols from multiple parsed files into a single graph
- Resolve imports to their target declarations across files
- Establish typed edges: `imports`, `exports`, `extends`, `implements`, `contains`, `calls`, `references`, `declares`, `typeOf`, `valueOf`, `overrides`
- Provide traversal and query APIs for downstream consumers

---

## Responsibilities

1. **Build** — `buildSymbolGraph(parsedFiles)` → `SymbolGraph`
2. **Graph Ops** — `createSymbolGraph`, `addNode`, `addEdge`, `getNode`, `getOutgoingEdges`, `getIncomingEdges`, `getAllNodes`, `getAllEdges`, `getNodesByKind`, `getNodesByFile`, `hasNode`, `hasEdge`
3. **Serialization** — `serializeSymbolGraph`, `deserializeSymbolGraph` for caching/persistence
4. **Query** — Traversal APIs with `TraversalOptions` (depth, edge kinds, direction)

---

## Public API

```typescript
import {
  buildSymbolGraph,
  createSymbolGraph,
  addNode,
  addEdge,
  getNode,
  getOutgoingEdges,
  getIncomingEdges,
  getAllNodes,
  getAllEdges,
  getNodesByKind,
  getNodesByFile,
  hasNode,
  hasEdge,
  serializeSymbolGraph,
  deserializeSymbolGraph,
} from "@devforge/symbol-graph";

import type {
  SymbolKind,
  Location,
  SymbolId,
  SymbolNode,
  SymbolEdge,
  EdgeKind,
  SymbolGraph,
  Modifier,
  TypeParameter,
  Signature,
  Parameter,
  SymbolMetadata,
  ParsedFile,
  ImportDeclaration,
  NamedImport,
  ExportDeclaration,
  NamedExport,
  ClassDeclaration,
  HeritageClause,
  ExpressionWithTypeArguments,
  ClassMember,
  InterfaceDeclaration,
  InterfaceMember,
  EnumDeclaration,
  EnumMember,
  FunctionDeclaration,
  TypeAliasDeclaration,
  SyntaxError,
  BuildOptions,
  TraversalOptions,
} from "@devforge/symbol-graph";
```

---

## Example Usage

```typescript
import { buildSymbolGraph } from "@devforge/symbol-graph";
import { parseTypeScript } from "@devforge/parser-typescript";
import { readFile } from "node:fs/promises";

// Parse multiple files
const parsedFiles = [];
for (const filePath of ["src/a.ts", "src/b.ts", "src/c.ts"]) {
  const code = await readFile(filePath, "utf-8");
  const result = parseTypeScript(code, filePath);
  parsedFiles.push({ filePath, ...result });
}

// Build symbol graph
const graph = buildSymbolGraph(parsedFiles, {
  includePrivate: false,
  includeTests: false,
  resolveCrossFileRefs: true,
  maxDepth: 10,
});

// Query
console.log(`Symbols: ${graph.nodes.size}`);
console.log(`Edges: ${graph.edges.length}`);

// Find all classes
const classes = getNodesByKind(graph, "class");
for (const cls of classes) {
  console.log(`${cls.qualifiedName} @ ${cls.filePath}:${cls.declarationLocation.line}`);
  // Outgoing edges (dependencies)
  const deps = getOutgoingEdges(graph, cls.id);
  for (const edge of deps) {
    const target = getNode(graph, edge.to);
    console.log(`  ${edge.kind} -> ${target?.qualifiedName}`);
  }
}

// Serialize for caching
const json = serializeSymbolGraph(graph);
const restored = deserializeSymbolGraph(json);
```

---

## Core Types

### SymbolKind
```typescript
type SymbolKind =
  | "class" | "interface" | "enum" | "function"
  | "type-alias" | "variable" | "namespace"
  | "import" | "export";
```

### SymbolId (Unique Identifier)
```typescript
interface SymbolId {
  readonly filePath: string;           // Relative path
  readonly kind: SymbolKind;
  readonly name: string;
  readonly declarationLocation: Location;
}
```

### SymbolNode
```typescript
interface SymbolNode {
  readonly id: SymbolId;
  readonly kind: SymbolKind;
  readonly name: string;
  readonly qualifiedName: string;      // e.g., "MyClass.myMethod"
  readonly filePath: string;
  readonly declarationLocation: Location;
  readonly documentation?: string;     // JSDoc/TSDoc
  readonly modifiers: Modifier[];
  readonly typeParameters: TypeParameter[];
  readonly signature?: Signature;      // For functions/methods
  readonly metadata: SymbolMetadata;   // Extensible
}
```

### SymbolEdge (Typed Relationships)
```typescript
type EdgeKind =
  | "imports"      // File imports symbol
  | "exports"      // File exports symbol
  | "extends"      // Class extends class/interface
  | "implements"   // Class implements interface
  | "contains"     // Namespace/module contains symbol
  | "calls"        // Function calls function
  | "references"   // Generic reference
  | "declares"     // Variable declares type
  | "typeOf"       // Symbol is type of another
  | "valueOf"      // Symbol is value of another
  | "overrides";   // Method overrides parent

interface SymbolEdge {
  readonly from: SymbolId;
  readonly to: SymbolId;
  readonly kind: EdgeKind;
}
```

### SymbolGraph
```typescript
interface SymbolGraph {
  readonly nodes: Map<string, SymbolNode>;      // Key: SymbolId stringified
  readonly edges: SymbolEdge[];
  readonly outgoing: Map<string, SymbolEdge[]>; // from -> edges
  readonly incoming: Map<string, SymbolEdge[]>; // to -> edges
}
```

### BuildOptions
```typescript
interface BuildOptions {
  includePrivate?: boolean;          // Default: false
  includeTests?: boolean;            // Default: false
  resolveCrossFileRefs?: boolean;    // Default: true
  maxDepth?: number;                 // Default: 10
}
```

### TraversalOptions
```typescript
interface TraversalOptions {
  maxDepth?: number;                 // Default: 3
  edgeKinds?: EdgeKind[];            // Default: all
  direction?: "outgoing" | "incoming" | "both"; // Default: "outgoing"
}
```

---

## Dependencies

- **Runtime:** None (pure TypeScript)
- **Dev:** `@repo/typescript-config`, `@types/node`, `typescript`, `vitest`, `tsx`

---

## Design Notes

### Symbol Identity
- `SymbolId` combines `filePath + kind + name + location` for uniqueness
- Same symbol in different files = different IDs (file-scoped)
- Qualified names use `.` for nesting: `Namespace.Class.method`

### Cross-File Resolution
- Import declarations create `imports` edges from importer to target
- Resolution matches by name + module specifier
- Unresolved imports create `import` kind nodes (external deps)
- `resolveCrossFileRefs: false` skips resolution (faster, for testing)

### Edge Semantics
| Edge Kind | Source | Target | Description |
|-----------|--------|--------|-------------|
| `imports` | Import node | Target symbol | File imports symbol |
| `exports` | Export node | Source symbol | File exports symbol |
| `extends` | Child class | Parent class/interface | Class inheritance |
| `implements` | Class | Interface | Interface implementation |
| `contains` | Module/namespace | Contained symbol | Nesting |
| `calls` | Function | Called function | Call graph (best-effort) |
| `references` | Any | Referenced symbol | Generic reference |
| `declares` | Variable | Type symbol | Variable type annotation |
| `typeOf` | Symbol | Type symbol | Type relationship |
| `valueOf` | Symbol | Value symbol | Value relationship |
| `overrides` | Method | Parent method | Override relationship |

### Serialization
- `serializeSymbolGraph` → JSON string (deterministic key ordering)
- `deserializeSymbolGraph` → Restored `SymbolGraph` with Map/Set
- Useful for caching, IPC, persistence

### Build Options
- `includePrivate` — Include private/protected members
- `includeTests` — Include `*.test.ts`, `*.spec.ts` files
- `resolveCrossFileRefs` — Enable/disable import resolution
- `maxDepth` — Limit recursive resolution depth

---

## Testing

```bash
pnpm --filter @devforge/symbol-graph test
```

Tests cover:
- Graph construction from parsed files
- Cross-file import resolution
- Edge creation (extends, implements, contains, calls)
- Node/edge queries (by kind, by file, traversal)
- Serialization round-trip
- Build options (private, tests, cross-file)
- Traversal options (depth, edge kinds, direction)

---

## Related Packages

| Package | Relationship |
|---------|--------------|
| `@devforge/parser-typescript` | Provides `ParsedFile` input |
| `@devforge/knowledge-graph` | Consumes `SymbolGraph` |
| `@devforge/benchmark` | Benchmarks symbol graph building |
| `@devforge/integration-tests` | End-to-end pipeline test |