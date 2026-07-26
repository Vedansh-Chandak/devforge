# DevForge

**A TypeScript-first monorepo for building AI-powered code intelligence tools.**

DevForge provides a modular pipeline for repository analysis: from filesystem scanning through symbol extraction, dependency resolution, knowledge graph construction, and context building for LLM-assisted development workflows.

---

## Why DevForge Exists

Modern AI coding assistants need precise, structured context about codebases to be effective. Raw file contents exceed token budgets and lack semantic relationships. DevForge solves this by:

1. **Indexing** — Fast, incremental filesystem scanning with metadata enrichment
2. **Language Detection** — Extension + filename-based classification (30+ languages)
3. **Parsing** — TypeScript AST parsing extracting imports, exports, classes, interfaces, functions, types
4. **Symbol Graph** — Cross-file symbol resolution with typed edges (imports, extends, implements, calls, references)
5. **Knowledge Graph** — Architectural abstraction layer grouping symbols into modules, services, APIs, repositories, databases
6. **Context Building** — Token-budgeted, relevance-ranked context assembly for LLM consumption (design-only, not yet implemented)

All stages are **pure TypeScript**, **deterministic**, **side-effect-free**, and **LLM-agnostic**.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              DEVFORGE PIPELINE                                     │
└─────────────────────────────────────────────────────────────────────────────────┘

  ┌──────────────┐    ┌──────────────────┐    ┌─────────────────────┐
  │  Repository  │───▶│  Language        │───▶│  TypeScript Parser  │
  │  Indexer     │    │  Detection       │    │  (parser-typescript)│
  └──────────────┘    └──────────────────┘    └──────────┬──────────┘
                                                         │
                                                         ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │                     SYMBOL GRAPH (symbol-graph)                     │
  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │
  │  │  Symbols    │──│  Imports    │──│  Extends    │──│  Calls    │  │
  │  │  (Nodes)    │  │  (Edges)    │  │  (Edges)    │  │  (Edges)  │  │
  │  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘  │
  └────────────────────────────┬────────────────────────────────────────┘
                               │
                               ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │                   KNOWLEDGE GRAPH (knowledge-graph)                 │
  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌────────────┐ ┌────────┐  │
  │  │ Module  │──│ Service │──│  API    │──│ Repository │ │Database│  │
  │  └─────────┘  └─────────┘  └─────────┘  └────────────┘ └────────┘  │
  └────────────────────────────┬────────────────────────────────────────┘
                               │
                               ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │                 CONTEXT BUILDER (design only — DF-008.1)            │
  │  Query Analysis → Concept Extraction → Entry Point Selection →     │
  │  Graph Traversal → Symbol Ranking → Token Budgeting → Assembly     │
  └─────────────────────────────────────────────────────────────────────┘
```

**Key Properties:**
- **Streaming pipeline** — Each stage consumes/produces typed data structures
- **Zero external dependencies** — Core packages use only Node.js stdlib + TypeScript compiler API
- **Deterministic** — Same input → identical output (critical for testing/caching)
- **Incremental ready** — Tree structure preserves paths for future watch-mode

---

## Quick Start

### Prerequisites

- Node.js ≥ 18
- pnpm ≥ 9

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/devforge.git
cd devforge

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests for a specific package
pnpm --filter @devforge/symbol-graph test
pnpm --filter @devforge/repository-indexer test
pnpm --filter @devforge/knowledge-graph test
pnpm --filter @devforge/parser-typescript test
```

### Running Benchmarks

```bash
# Run benchmarks (requires fixtures in benchmarks/fixtures/)
pnpm --filter @devforge/benchmark benchmark

# Or run directly
node packages/benchmark/bin/benchmark.js
```

---

## Building

```bash
# Build all packages (respects dependency order via Turborepo)
pnpm build

# Build a specific package
pnpm --filter @devforge/symbol-graph build

# Type-check without emitting
pnpm check-types
```

The build outputs to `dist/` in each package with:
- `index.js` — ESM bundle
- `index.d.ts` — TypeScript declarations

---

## Running Tests

```bash
# All tests (uses vitest)
pnpm test

# Watch mode
pnpm test:watch

# Coverage report
pnpm test:coverage

# Specific package
pnpm --filter @devforge/parser-typescript test
```

Test structure:
- Unit tests co-located in `__tests__/` or `*.test.ts`
- Integration tests in `packages/integration-tests/`
- Benchmarks in `packages/benchmark/`

---

## Running Benchmarks

```bash
# Build benchmark package first
pnpm --filter @devforge/benchmark build

# Run single benchmark
pnpm --filter @devforge/benchmark benchmark

# Run multiple iterations with stats
node packages/benchmark/dist/cli.js --runs 5 --fixture ./benchmarks/fixtures/sample-repo
```

Benchmark measures:
- Indexing time
- Metadata enrichment time
- Language detection time
- TypeScript parsing time
- Symbol graph construction time
- Knowledge graph construction time
- Memory usage (heap)

---

## Repository Structure

```
devforge/
├── apps/
│   ├── api/              # Backend API (placeholder)
│   └── web/              # Next.js frontend (placeholder)
├── benchmarks/
│   └── fixtures/         # Test repositories for benchmarking
├── docs/
│   ├── architecture/     # System architecture documentation
│   ├── developer/        # Developer guides
│   └── diagrams/         # Architecture diagrams (ASCII)
├── packages/
│   ├── benchmark/        # Pipeline benchmarking harness
│   ├── config/           # Shared configuration (env, constants)
│   ├── eslint-config/    # Shared ESLint configurations
│   ├── integration-tests/# End-to-end pipeline tests
│   ├── knowledge-graph/  # Architectural knowledge graph builder
│   ├── logger/           # Structured logging (pino-based)
│   ├── parser-typescript/# TypeScript AST parser
│   ├── repository-indexer/# Filesystem scanner + metadata
│   ├── symbol-graph/     # Cross-file symbol resolution
│   ├── typescript-config/# Shared TypeScript configurations
│   └── ui/               # Shared React components
├── turbo.json            # Turborepo pipeline configuration
├── package.json          # Root workspace config
└── pnpm-workspace.yaml   # pnpm workspace definition
```

---

## Package Overview

| Package | Purpose | Public API | Status |
|---------|---------|------------|--------|
| `@devforge/repository-indexer` | Filesystem scanning, tree construction, metadata enrichment, language detection | `scanRepository`, `enrichWithMetadata`, `detectLanguage`, `traverseTree`, `collectTree` | ✅ Implemented |
| `@devforge/parser-typescript` | TypeScript/TSX AST parsing → imports, exports, classes, interfaces, functions, types | `parseTypeScript` | ✅ Implemented |
| `@devforge/symbol-graph` | Cross-file symbol resolution, typed edges (imports, extends, implements, calls, references) | `buildSymbolGraph`, `createSymbolGraph`, `SymbolGraph`, traversal APIs | ✅ Implemented |
| `@devforge/knowledge-graph` | Architectural abstraction: modules, services, APIs, repositories, databases | `buildKnowledgeGraph`, `getNode`, `getDependencies`, `findServicesUsingRepository`, query APIs | ✅ Implemented |
| `@devforge/config` | Environment validation (zod), shared constants | `env`, `DEFAULT_HOST`, `DEFAULT_PORT`, `APP_NAME`, `APP_VERSION` | ✅ Implemented |
| `@devforge/logger` | Pino-based structured logger with pretty dev output | `logger` | ✅ Implemented |
| `@devforge/benchmark` | Pipeline benchmarking CLI + runner | `runBenchmark`, `formatResult`, `calculateMedian`, `calculateStats` | ✅ Implemented |
| `@devforge/integration-tests` | End-to-end pipeline verification | `runPipeline`, `serializePipelineResult` | ✅ Implemented |
| `@repo/eslint-config` | Shared ESLint configs (base, next-js, react-internal) | Config exports | ✅ Implemented |
| `@repo/typescript-config` | Shared TypeScript configs | Config exports | ✅ Implemented |
| `@repo/ui` | Shared React components (Button, Card, Code) | Component exports | ✅ Implemented |

---

## Roadmap

### Completed (v0.1)
- [x] Repository indexer with metadata enrichment
- [x] Language detection (30+ languages)
- [x] TypeScript parser (imports, exports, classes, interfaces, functions, types)
- [x] Symbol graph with typed edges
- [x] Knowledge graph with architectural node kinds
- [x] Query APIs for knowledge graph
- [x] Benchmarking harness
- [x] Integration test pipeline
- [x] Shared config, logger, TypeScript/ESLint configs

### In Progress (v0.2)
- [ ] Context Builder implementation (DF-008.1)
  - Query analysis
  - Concept extraction
  - Entry point selection
  - Graph traversal (weighted BFS)
  - Symbol ranking
  - Token budgeting
  - Context assembly
- [ ] Incremental indexing (file watcher + diff)
- [ ] Cross-language support (Python, Go, Rust parsers)

### Planned (v0.3+)
- [ ] Execution Engine (DF-009.2) — Tool registry, DAG scheduler, side-effect tracking, replay
- [ ] Language Server Protocol (LSP) integration for precise cross-references
- [ ] Vector embeddings for semantic concept extraction
- [ ] Web UI for graph visualization
- [ ] GitHub Action for CI integration
- [ ] Plugin system for custom node/edge kinds

---

## Contributing

See [docs/developer/getting-started.md](docs/developer/getting-started.md) for development setup, coding standards, and contribution guidelines.

---

## License

MIT