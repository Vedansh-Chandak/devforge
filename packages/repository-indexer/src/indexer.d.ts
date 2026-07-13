import type { RepositoryTree } from "./types.js";
/**
 * Recursively walks the filesystem rooted at `root` and returns a
 * `RepositoryTree`. Root-level failures (missing path, file-where-folder,
 * permission denied, root is a symlink, root readdir races) throw a
 * `RepositoryScanError`; subtree failures (unreadable subdirectory,
 * broken symlink, race disappearance) are silently omitted so the rest of
 * the tree is preserved.
 *
 * Symlinks are not followed. A broken symlink appears as a missing entry.
 * Files are never read; `{ extension, size }` are populated from `lstat`.
 *
 * ## Dotfiles
 *
 * Dotfiles whose name **starts** with a dot (e.g. `.env`, `.gitignore`)
 * have `extension === ""` because Node's `path.extname` treats leading-dot
 * hidden names as having no extension. This is the intended behavior.
 *
 * ## Known limitations
 *
 * - **Deep recursion.** The walker descends one `await` per directory
 *   level. Pure JS engines do not enforce synchronous stack depth on
 *   `await`-separated recursion, but very large trees (≥10⁴ nested
 *   directories on the same branch) can approach runaway memory and
 *   latency. A future story should add a bounded-concurrency variant.
 *   This implementation is **not** a security boundary against
 *   adversarial file depth.
 * - **Race windows.** A file or directory removed between `readdir` and
 *   `lstat` is silently omitted. The function never crashes, but the
 *   resulting tree may reflect filesystem state at *N+1* observation
 *   points rather than a single snapshot.
 * - **Cross-filesystem behavior.** Symlinks and metadata semantics follow
 *   the host OS exactly. There is no abstraction layer (overlay FS,
 *   virtual FS, etc.).
 */
export declare function scanRepository(root: string): Promise<RepositoryTree>;
//# sourceMappingURL=indexer.d.ts.map