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
export type ScanErrorCode = "NOT_FOUND" | "NOT_A_DIRECTORY" | "PERMISSION_DENIED" | "INVALID_ROOT";
/**
 * Base class for scan-level errors. Always thrown, never returned.
 *
 * The class is the canonical error surface for `scanRepository`. It
 * subclasses `Error` so `instanceof Error` keeps working in catch-all
 * handlers, but its real discriminator is the `.code` field.
 */
export declare class RepositoryScanError extends Error {
    readonly code: ScanErrorCode;
    readonly rootPath: string;
    constructor(code: ScanErrorCode, rootPath: string, message: string);
}
//# sourceMappingURL=types.d.ts.map