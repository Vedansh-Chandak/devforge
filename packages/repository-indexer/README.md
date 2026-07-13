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
- Ignore rules (handled in a later story).
- Symlink following.
- Filesystem watchers / mutability.
- Anything Fastify, DB, HTTP, AI, or log-aware.

## Public API

```ts
import {
  scanRepository,
  RepositoryScanError,
} from "@devforge/repository-indexer";

try {
  const tree = await scanRepository("./");
  console.log(tree.totalNodes, tree.root.children.length);
} catch (err) {
  if (err instanceof RepositoryScanError) {
    console.error(err.code, err.rootPath, err.message);
  } else {
    throw err;
  }
}
```

## Status

Story **DF-005.2-PR2** — Filesystem Walker. Awaiting Tech Lead review.
