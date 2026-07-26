# @devforge/knowledge-graph

**Architectural abstraction layer over the symbol graph. Groups symbols into modules, services, APIs, repositories, and databases with typed edges (contains, dependsOn, exposes).**

Fourth stage of the DevForge pipeline. Transforms the fine-grained symbol graph into a coarse-grained architectural knowledge graph suitable for context building and high-level reasoning.

---

## Purpose

- Abstract implementation details into architectural concepts
- Identify modules, services, APIs, repositories, databases from symbol patterns
- Build typed relationships: `contains` (hierarchy), `dependsOn` (dependencies), `exposes` (public API)
- Provide query APIs for architectural analysis

---

## Responsibilities

1. **Build** — `buildKnowledgeGraph(symbolGraph, parsedFiles)` → `KnowledgeGraph`
2. **Query** — `getNodeById`, `getAllNodesOfKind`, `findServicesUsingRepository`, `findDatabaseAccessors`, `findModuleServices`, `findModuleApis`, `getGraphStats`, `getNodesByModule`, `hasDependency`, `hasNode`, `getNodesByKind`

---

## Public API

```typescript
import {
  buildKnowledgeGraph,
  getKnowledgeNode as getNode,
  getDependencies,
  getDependents,
  getNodeById,
  getAllNodesOfKind,
  findServicesUsingRepository,
  findDatabaseAccessors,
  findModuleServices,
  findModuleApis,
  getGraphStats,
  getNodesByModule,
  hasDependency,
  hasNode,
  getNodesByKind,
} from "@devforge/knowledge-graph";

import type {
  KnowledgeNodeKind,
  KnowledgeEdgeKind,
  KnowledgeNodeId,
  KnowledgeNode,
  KnowledgeNodeProperties,
  KnowledgeEdge,
  KnowledgeEdgeProperties,
  KnowledgeGraph,
  BuildKnowledgeGraphOptions,
} from "@devforge/knowledge-graph";
```

---

## Example Usage

```typescript
import { buildKnowledgeGraph } from "@devforge/knowledge-graph";
import { buildSymbolGraph } from "@devforge/symbol-graph";
import { parseTypeScript } from "@devforge/parser-typescript";
import { readFile } from "node:fs/promises";

// Parse files
const parsedFiles = [];
for (const filePath of ["src/user-service.ts", "src/user-repo.ts", "src/api.ts"]) {
  const code = await readFile(filePath, "utf-8");
  parsedFiles.push({ filePath, ...parseTypeScript(code, filePath) });
}

// Build symbol graph
const symbolGraph = buildSymbolGraph(parsedFiles);

// Build knowledge graph
const kg = buildKnowledgeGraph(symbolGraph, parsedFiles, {
  includePrivate: false,
});

// Query architecture
console.log(`Nodes: ${kg.nodes.size}, Edges: ${kg.edges.length}`);

// Find all services
const services = getAllNodesOfKind(kg, "service");
for (const svc of services) {
  console.log(`Service: ${svc.name}`);
  console.log(`  Files: ${svc.sourceFiles.join(", ")}`);
  console.log(`  Confidence: ${svc.confidence}`);
}

// Find what uses a repository
const repo = getNodeById(kg, { kind: "repository", name: "UserRepository" });
if (repo) {
  const dependents = getDependents(kg, repo.id);
  console.log(`UserRepository used by: ${dependents.map(d => d.name).join(", ")}`);
}

// Find database accessors
const dbAccessors = findDatabaseAccessors(kg);
console.log("Database accessors:", dbAccessors.map(n => n.name).join(", "));

// Module APIs
const apis = findModuleApis(kg, "auth");
console.log("Auth module APIs:", apis.map(a => a.name).join(", "));
```

---

## Core Types

### KnowledgeNodeKind
```typescript
type KnowledgeNodeKind =
  | "module"      // Logical module/package (e.g., "auth", "billing")
  | "service"     // Business logic service (e.g., "UserService")
  | "api"         // Public API endpoint/controller (e.g., "UserController")
  | "repository"  // Data access layer (e.g., "UserRepository")
  | "database";   // Database/table (e.g., "users", "orders")
```

### KnowledgeEdgeKind
```typescript
type KnowledgeEdgeKind =
  | "contains"    // Hierarchy: module contains service, service contains repo
  | "dependsOn"   // Dependency: service dependsOn repository
  | "exposes";    // Exposure: module exposes api
```

### KnowledgeNodeId
```typescript
interface KnowledgeNodeId {
  readonly kind: KnowledgeNodeKind;
  readonly name: string;  // e.g., "UserService"
}
```

### KnowledgeNode
```typescript
interface KnowledgeNode {
  readonly id: KnowledgeNodeId;
  readonly kind: KnowledgeNodeKind;
  readonly name: string;
  readonly qualifiedName: string;      // e.g., "auth.UserService"
  readonly sourceSymbols: ReadonlyArray<SymbolId>;  // Underlying symbols
  readonly sourceFiles: ReadonlyArray<string>;      // Source file paths
  readonly properties: KnowledgeNodeProperties;
  readonly confidence: number;         // 0-1, heuristic confidence
  readonly createdAt: string;          // ISO timestamp
  readonly version: number;            // Incremental version
}
```

### KnowledgeNodeProperties
```typescript
interface KnowledgeNodeProperties {
  readonly description?: string;       // From JSDoc/class comment
  readonly filePath?: string;          // Primary file
  readonly exportName?: string;        // Export name if different
}
```

### KnowledgeEdge
```typescript
interface KnowledgeEdge {
  readonly id: string;
  readonly kind: KnowledgeEdgeKind;
  readonly from: KnowledgeNodeId;
  readonly to: KnowledgeNodeId;
  readonly properties: KnowledgeEdgeProperties;
}
```

### KnowledgeEdgeProperties
```typescript
interface KnowledgeEdgeProperties {
  readonly sourceSymbol?: SymbolId;    // Symbol that created this edge
  readonly edgeKind?: EdgeKind;        // Original symbol-graph edge kind
  readonly symbolEdgeKind?: EdgeKind;  // Alias
}
```

### KnowledgeGraph
```typescript
interface KnowledgeGraph {
  readonly nodes: Map<string, KnowledgeNode>;     // Key: "kg:kind:name"
  readonly edges: KnowledgeEdge[];
  readonly outgoing: Map<string, KnowledgeEdge[]>; // from -> edges
  readonly incoming: Map<string, KnowledgeEdge[]>; // to -> edges
}
```

### BuildKnowledgeGraphOptions
```typescript
interface BuildKnowledgeGraphOptions {
  readonly includePrivate?: boolean;  // Default: false
}
```

---

## Recognition Heuristics

| Kind | Recognition Pattern |
|------|---------------------|
| **module** | Directory structure + `index.ts` exports; package.json name |
| **service** | Class suffix `Service`, `Manager`, `Handler`; contains business logic methods |
| **api** | Class suffix `Controller`, `Router`, `Handler`; decorated with route decorators |
| **repository** | Class suffix `Repository`, `Dao`, `Store`; methods: `find`, `save`, `delete`, `query` |
| **database** | Type/interface representing DB schema; referenced by repository |

### Confidence Scoring
- Base confidence from pattern match (0.6-0.9)
- Boosted by: JSDoc presence, export visibility, test coverage
- Reduced by: private/internal naming, single-method classes

---

## Query API

### Node Lookup
```typescript
// By ID
getNodeById(graph, { kind: "service", name: "UserService" });

// By kind
getAllNodesOfKind(graph, "service");
getNodesByKind(graph, "api");

// By module
getNodesByModule(graph, "auth");
```

### Relationship Queries
```typescript
// Direct dependencies/dependents
getDependencies(graph, nodeId);    // Outgoing dependsOn edges
getDependents(graph, nodeId);      // Incoming dependsOn edges

// Dependency check
hasDependency(graph, fromId, toId);
hasNode(graph, nodeId);
```

### Architectural Queries
```typescript
// Services using a specific repository
findServicesUsingRepository(graph, "UserRepository");

// All database accessors (repositories + direct DB access)
findDatabaseAccessors(graph);

// Services in a module
findModuleServices(graph, "auth");

// Public APIs exposed by a module
findModuleApis(graph, "auth");

// Graph statistics
getGraphStats(graph);  // { nodeCount, edgeCount, nodesByKind, edgesByKind }
```

---

## Dependencies

- **Runtime:** `@devforge/symbol-graph` (peer)
- **Dev:** `typescript`, `vitest`

---

## Design Notes

### Two-Layer Graph Architecture
```
Symbol Graph (fine-grained)          Knowledge Graph (coarse-grained)
├── class UserService                  ├── service UserService
├── class UserRepository      ───▶     ├── repository UserRepository
├── interface User                       │
├── class UserController              ├── api UserController
└── class Database                      ├── database users
```

- Symbol graph: every function, class, interface, type, variable
- Knowledge graph: architectural concepts only
- Each knowledge node maps to **multiple** symbol nodes
- Edges carry provenance (`sourceSymbol`) for traceability

### Incremental Updates (Design Only)
- `version` field on `KnowledgeNode` enables future incremental updates
- `createdAt` enables temporal queries
- Not yet implemented — full rebuild on each run

### Module Detection
- Currently heuristic: directory name under `src/` or top-level package
- Future: `package.json` workspaces, `tsconfig` project references

---

## Testing

```bash
pnpm --filter @devforge/knowledge-graph test
```

Tests cover:
- Knowledge graph construction from symbol graph
- Node recognition (service, repo, api, module, database)
- Edge creation (contains, dependsOn, exposes)
- Query APIs (dependencies, dependents, architectural queries)
- Confidence scoring
- Build options

---

## Related Packages

| Package | Relationship |
|---------|--------------|
| `@devforge/symbol-graph` | Input: provides `SymbolGraph` + `ParsedFile[]` |
| `@devforge/parser-typescript` | Indirect: provides `ParseResult` |
| `@devforge/benchmark` | Benchmarks knowledge graph building |
| `@devforge/integration-tests` | End-to-end pipeline test |
| `@devforge/context-builder` | (Design only) Consumes knowledge graph |