# @devforge/repository-indexer

**Filesystem scanning, tree construction, metadata enrichment, and language detection.**

First stage of the DevForge pipeline. Scans a repository root and produces a typed, immutable tree of files and directories with optional filesystem metadata and language classification.

---

## Purpose

- Fast, deterministic repository scanning
- Lexicographically ordered tree for reproducible hashing/caching
- Single `lstat` per node for metadata (mtime, mode, inode)
- Extension + special-filename language detection (30+ languages)
- Composable filtering and traversal utilities

---

## Responsibilities

1. **Scan** — Walk directory tree, emit `RepositoryTree` with `DirectoryNode`/`FileNode`
2. **Enrich** — Attach `FileMetadata`/`DirectoryMetadata` (mtime, mode, inode) via `EnrichedTree`
3. **Detect** — Classify files by language (`detectLanguage`, `isLanguage`, `getExtensionsForLanguage`)
4. **Filter** — `filterFiles`, `filterDirectories`, `filterByExtension`, `pruneIgnoredDirs`
5. **Traverse** — `traverseTree`, `collectTree`, `countTree` for downstream consumers

---

## Public API

```typescript
// Main entry: scan a repository
import { scanRepository } from "@devforge/repository-indexer";

const tree = await scanRepository("/path/to/repo");
// tree: RepositoryTree { root, rootPath, scannedAt, totalNodes }

// Enrich with filesystem metadata
import { enrichWithMetadata, getMetadata, hasMetadata, getAllMetadata } from "@devforge/repository-indexer";

const enriched = await enrichWithMetadata(tree);
const meta = getMetadata(enriched, someNode);

// Language detection
import { detectLanguage, isLanguage, getExtensionsForLanguage, Language } from "@devforge/repository-indexer";

const lang = detectLanguage(fileNode); // "typescript" | "python" | "unknown" | ...
isLanguage(fileNode, "typescript");    // boolean

// Filtering
import { filterFiles, filterDirectories, filterByExtension, pruneIgnoredDirs } from "@devforge/repository-indexer";

// Traversal
import { traverseTree, collectTree, countTree } from "@devforge/repository-indexer";

// Types
import type {
  NodeType,
  FileNode,
  DirectoryNode,
  RepositoryNode,
  RepositoryTree,
  ScanErrorCode,
  FileMetadata,
  DirectoryMetadata,
  NodeMetadata,
  EnrichedTree,
  MetadataErrorCode,
  Language,
} from "@devforge/repository-indexer";

// Errors
import { RepositoryScanError, MetadataEnrichmentError } from "@devforge/repository-indexer";
```

---

## Example Usage

```typescript
import {
  scanRepository,
  enrichWithMetadata,
  detectLanguage,
  collectTree,
  filterFiles,
  FileNode,
} from "@devforge/repository-indexer";

// 1. Scan repository
const tree = await scanRepository("./my-project");

// 2. Enrich with metadata (mtime, mode, inode)
const enriched = await enrichWithMetadata(tree);

// 3. Collect all file nodes
const allFiles = await collectTree(tree, { includeDirectories: false });

// 4. Filter to TypeScript files
const tsFiles = filterFiles(allFiles, (f) => detectLanguage(f) === "typescript");

// 5. Process each file
for (const file of tsFiles) {
  console.log(`${file.relativePath} (${file.size} bytes)`);
  const meta = getMetadata(enriched, file);
  if (meta) console.log(`  mtime: ${new Date(meta.mtimeMs).toISOString()}`);
}
```

---

## Dependencies

- **Runtime:** None (Node.js stdlib only: `fs/promises`, `path`)
- **Dev:** `@repo/typescript-config`, `typescript`, `vitest`, `@types/node`

---

## Design Notes

### Tree Structure
- `RepositoryNode` is a discriminated union: `FileNode | DirectoryNode`
- `DirectoryNode.children` is `ReadonlyArray<RepositoryNode>` — **immutable**, lexicographically sorted by `name`
- Sorting ensures deterministic output for caching/hashing

### Metadata Enrichment
- Uses `WeakMap<EnrichedTree, MetadataMap>` — no pollution of tree objects
- Errors on individual nodes are **silently skipped**; only root-level failure throws
- `EnrichedTree` is a branded opaque type — construct only via `enrichWithMetadata`

### Language Detection
- Priority: special filenames (Dockerfile, Makefile, package.json...) → extension → `unknown`
- Covers 30+ languages; extensible via `SPECIAL_FILENAMES` and `EXTENSION_MAP` constants
- Detection is **filename-only** — no file content reading

### Error Handling
- `scanRepository` throws `RepositoryScanError` with `code: ScanErrorCode` (`NOT_FOUND`, `NOT_A_DIRECTORY`, `PERMISSION_DENIED`, `INVALID_ROOT`)
- `enrichWithMetadata` throws `MetadataEnrichmentError` only on root access failure
- Subtree errors (unreadable dir, broken symlink) are omitted from tree — no partial results

### Performance
- Single-pass tree construction
- One `lstat` per node during enrichment
- No recursion depth limit (uses iterative stack)
- Memory: O(n) nodes, minimal overhead per node

---

## Testing

```bash
pnpm --filter @devforge/repository-indexer test
```

Tests cover:
- Tree construction (files, dirs, nesting, sorting)
- Metadata enrichment (mtime, mode, inode, error skipping)
- Language detection (extensions, special filenames, unknown)
- Filtering utilities
- Traversal (pre/post-order, collect, count)
- Error codes and messages

---

## Related Packages

| Package | Relationship |
|---------|--------------|
| `@devforge/parser-typescript` | Consumes `FileNode` from indexer for parsing |
| `@devforge/symbol-graph` | Consumes parsed files from parser |
| `@devforge/knowledge-graph` | Consumes symbol graph |
| `@devforge/benchmark` | Benchmarks full pipeline starting here |
| `@devforge/integration-tests` | End-to-end pipeline test |