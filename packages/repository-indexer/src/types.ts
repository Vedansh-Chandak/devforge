/**
 * Discriminator for repository nodes.
 *
 * Modeled as a string-literal union (not an enum) so that:
 *  - it emits zero runtime code;
 *  - it composes naturally with discriminated-union narrowing (`switch (node.type)`);
 *  - future variants ("symlink", "ignored") can be added purely additively,
 *    and `strict` exhaustiveness will force every consumer to handle them.
 */
export type NodeType = "file" | "directory";

/**
 * A regular file in the repository.
 *
 * `relativePath` is the path relative to the repository root, using forward
 * slashes regardless of host OS. Consumers must never reach back to disk
 * via `relativePath` — the tree is the sole source of truth.
 *
 * `absolutePath` is provided for out-of-kernel tooling (CLI diff, cache
 * keys). Kernel stages (parser, graph, AI) should prefer `relativePath`.
 *
 * `extension` does NOT include the leading dot. The empty string means no
 * extension.
 */
export interface FileNode {
  readonly type: "file";
  readonly name: string;
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly extension: string;
  readonly size: number;
}

/**
 * A directory in the repository.
 *
 * `children` is ordered lexicographically (case-sensitive, by `name`).
 * This ordering contract is relied upon by downstream stages for
 * deterministic hashing, diffing, and caching.
 */
export interface DirectoryNode {
  readonly type: "directory";
  readonly name: string;
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly children: ReadonlyArray<RepositoryNode>;
}

/**
 * The closed union every consumer of the tree narrows over.
 *
 * New node kinds (e.g. "symlink", "ignored-subtree") will be added here
 * in future milestones. Consumers that use exhaustive switches will be
 * auto-guided by the compiler.
 */
export type RepositoryNode = FileNode | DirectoryNode;

/**
 * The repository tree returned by a successful scan.
 *
 * Owns session metadata (`rootPath`, `scannedAt`, `totalNodes`) separately
 * from the structural root, so downstream stages can:
 *  - walk from `tree.root` without unwrapping;
 *  - invalidate caches via `tree.scannedAt`;
 *  - bound their work via `tree.totalNodes`.
 *
 * `rootPath` is exactly the string the caller passed to `scanRepository`.
 * `totalNodes` includes the root directory and every successfully-visited
 * descendant. Subtrees pruned due to errors are NOT counted.
 */
export interface RepositoryTree {
  readonly root: DirectoryNode;
  readonly rootPath: string;
  readonly scannedAt: string;
  readonly totalNodes: number;
}

/**
 * Top-level failure modes of `scanRepository`. Thrown values carry this code
 * as the `.code` field on `RepositoryScanError`.
 *
 * Subtree-level failures (unreadable directory, broken symlink) do NOT
 * throw — they are silently omitted from the tree.
 */
export type ScanErrorCode =
  | "NOT_FOUND"
  | "NOT_A_DIRECTORY"
  | "PERMISSION_DENIED"
  | "INVALID_ROOT";

/**
 * Base class for scan-level errors. Always thrown, never returned.
 *
 * The class is the canonical error surface for `scanRepository`. It
 * subclasses `Error` so `instanceof Error` keeps working in catch-all
 * handlers, but its real discriminator is the `.code` field.
 */
export class RepositoryScanError extends Error {
  readonly code: ScanErrorCode;
  readonly rootPath: string;

  constructor(code: ScanErrorCode, rootPath: string, message: string) {
    super(message);
    this.name = "RepositoryScanError";
    this.code = code;
    this.rootPath = rootPath;
  }
}

/**
 * Metadata attached to FileNode by the Metadata Engine.
 *
 * `mtimeMs` is the primary field for cache invalidation and change detection.
 * `mode` includes permission bits and file type flags (e.g., 0o100644).
 * `inode` is Unix-only; undefined on Windows. Used for hardlink detection.
 *
 * All fields are populated from a single `lstat` call per node.
 */
export interface FileMetadata {
  readonly mtimeMs: number;
  readonly mode: number;
  readonly inode?: number;
}

/**
 * Metadata attached to DirectoryNode by the Metadata Engine.
 *
 * Same structure as FileMetadata, but for directories.
 * Directory mtime changes when entries are added/removed.
 */
export interface DirectoryMetadata {
  readonly mtimeMs: number;
  readonly mode: number;
  readonly inode?: number;
}

/**
 * Union of all metadata types.
 */
export type NodeMetadata = FileMetadata | DirectoryMetadata;

/**
 * Opaque handle to a RepositoryTree enriched with filesystem metadata.
 *
 * The EnrichedTree wraps the original tree (preserving immutability) and
 * provides access to metadata via getMetadata(), hasMetadata(), and
 * getAllMetadata().
 *
 * Do not construct directly. Use enrichWithMetadata().
 */
export interface EnrichedTree {
  /**
   * The original, unmodified repository tree.
   */
  readonly tree: RepositoryTree;

  /**
   * Internal brand for type safety. Do not access.
   */
  readonly _metadataBrand: symbol;
}

/**
 * Failure modes for metadata enrichment.
 */
export type MetadataErrorCode = "ROOT_NOT_FOUND" | "ROOT_NOT_ACCESSIBLE";

/**
 * Error thrown by enrichWithMetadata() on catastrophic failures.
 *
 * Node-level errors (file deleted, permission denied) do NOT throw;
 * they are silently skipped. This error is only thrown when the
 * root path itself is inaccessible.
 */
export class MetadataEnrichmentError extends Error {
  readonly code: MetadataErrorCode;
  readonly rootPath: string;

  constructor(code: MetadataErrorCode, rootPath: string, message: string) {
    super(message);
    this.name = "MetadataEnrichmentError";
    this.code = code;
    this.rootPath = rootPath;
  }
}

/**
 * Programming languages and file types detected by the Language Detection Engine.
 *
 * This enum is exhaustive for supported languages. UNKNOWN indicates a file
 * that is not recognized or not yet supported.
 *
 * Detection is based on filename and extension only. No file contents are read.
 */
export type Language =
  | "typescript"
  | "typescript-react"
  | "javascript"
  | "javascript-react"
  | "python"
  | "java"
  | "kotlin"
  | "rust"
  | "go"
  | "cpp"
  | "c"
  | "c-header"
  | "csharp"
  | "swift"
  | "php"
  | "ruby"
  | "lua"
  | "markdown"
  | "yaml"
  | "json"
  | "toml"
  | "xml"
  | "html"
  | "css"
  | "scss"
  | "sql"
  | "shell"
  | "zsh"
  | "dockerfile"
  | "makefile"
  | "cmake"
  | "groovy"
  | "unknown";
