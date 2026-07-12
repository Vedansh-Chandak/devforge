# @devforge/repository-indexer

Filesystem traversal layer of the DevForge pipeline.

```
Repository
   ↓
Repository Indexer            ← this package
   ↓
Language Parser
   ↓
Knowledge Graph
   ↓
Context Builder
   ↓
AI Brain
```

## Responsibilities

- Recursively walk a directory tree rooted at a given path.
- Return a deterministic, typed in-memory `RepositoryTree`.

## Non-responsibilities (this milestone)

- File parsing / language awareness.
- Symlink following.
- Filesystem watchers / mutability.
- Anything Fastify, DB, HTTP, AI, or log-aware.

## Ignore Engine

The package ships a dedicated `IgnoreMatcher` module (`createIgnoreMatcher` /
`shouldIgnore`). Default ignored entries:

- **Directories**: `node_modules`, `.git`, `dist`, `build`, `.next`, `coverage`,
  `.turbo`, `.idea`, `.vscode`
- **Files**: `.DS_Store`, anything matching `*.log`

Matching is case-sensitive and cross-platform (POSIX basenames only). No
glob libraries are used.

Callers can extend the defaults via `ScanOptions.ignore`:

```ts
const res = await scanRepository("./", { ignore: ["tmp", "*.bak"] });
```

## Public API

```ts
import { scanRepository } from "@devforge/repository-indexer";

const result = await scanRepository("./");
if (result.ok) {
  console.log(result.tree);
} else {
  console.error(result.error);
}
```

## Status

Story **DF-005.3** — Ignore Engine. Filesystem Walker + Ignore Engine
shipped. Awaiting Tech Lead review.
