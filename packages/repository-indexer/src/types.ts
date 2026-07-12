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
 * `path` is the path **relative to the repository root**, using forward
 * slashes regardless of host OS. Consumers must never reach back to disk
 * via this path — the tree is the sole source of truth.
 */
export interface FileNode {
  readonly type: "file";
  readonly name: string;
  readonly path: string;
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
  readonly path: string;
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
 *  - walk from `root` without unwrapping;
 *  - invalidate caches via `scannedAt`;
 *  - bound their work via `totalNodes`.
 */
export interface RepositoryTree {
  readonly root: DirectoryNode;
  readonly rootPath: string;
  readonly scannedAt: string;
  readonly totalNodes: number;
}

/**
 * Options for a repository scan.
 *
 * The interface is reserved at the foundation level; all fields are
 * optional so callers can pass an empty object today. Future milestones
 * will add `ignore`, `maxDepth`, `followSymlinks`, `concurrency` —
 * all non-breakingly.
 */
export interface ScanOptions {
  readonly ignore?: ReadonlyArray<string>;
  readonly maxDepth?: number;
  readonly followSymlinks?: boolean;
}

/**
 * Top-level failure modes of `scanRepository`.
 *
 * Subtree-level failures (unreadable directory, broken symlink) do NOT
 * fail the whole scan; they are represented inside `RepositoryNode`s
 * by future milestones. This enum is only for root-level failures.
 */
export type ScanErrorCode =
  | "NOT_FOUND"
  | "NOT_A_DIRECTORY"
  | "PERMISSION_DENIED"
  | "INVALID_ROOT";

export interface ScanError {
  readonly code: ScanErrorCode;
  readonly message: string;
  readonly rootPath: string;
}

/**
 * Result envelope returned by `scanRepository`.
 *
 * Modeled as a discriminated union rather than a thrown exception so that:
 *  - consumers handle root-level failures at the type level
 *    (no `try/catch` everywhere);
 *  - the result composes with `Promise.all` and structured concurrency;
 *  - it matches the rest of DevForge's "errors as values" pattern.
 */
export type ScanResult =
  | { readonly ok: true; readonly tree: RepositoryTree }
  | { readonly ok: false; readonly error: ScanError };
