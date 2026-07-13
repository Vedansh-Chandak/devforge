import {
  resolve as resolvePath,
  basename as pathBasename,
  extname,
  relative,
  sep,
  posix,
} from "node:path";
import { lstat, readdir } from "node:fs/promises";

import { RepositoryScanError } from "./types.js";
import type {
  DirectoryNode,
  FileNode,
  RepositoryNode,
  RepositoryTree,
} from "./types.js";
import { defaultIgnoreEngine } from "./ignore.js";

function asErrno(err: unknown): NodeJS.ErrnoException {
  if (err instanceof Error) {
    return err as NodeJS.ErrnoException;
  }
  return new Error(String(err)) as NodeJS.ErrnoException;
}

function pathToPosix(p: string): string {
  if (sep === posix.sep) return p;
  return p.split(sep).join(posix.sep);
}

function relativePosix(from: string, to: string): string {
  return pathToPosix(relative(from, to));
}

function extensionOf(name: string): string {
  const ext = pathToPosix(extname(name));
  return ext.startsWith(".") ? ext.slice(1) : ext;
}

function classifyRootError(
  root: string,
  err: NodeJS.ErrnoException,
): RepositoryScanError {
  switch (err.code) {
    case "ENOENT":
      return new RepositoryScanError(
        "NOT_FOUND",
        root,
        `Repository path does not exist: ${root}`,
      );
    case "ENOTDIR":
      return new RepositoryScanError(
        "NOT_A_DIRECTORY",
        root,
        `Repository path is not a directory: ${root}`,
      );
    case "EACCES":
    case "EPERM":
      return new RepositoryScanError(
        "PERMISSION_DENIED",
        root,
        `Repository path is not readable due to permissions: ${root}`,
      );
    default:
      return new RepositoryScanError(
        "INVALID_ROOT",
        root,
        `Unable to access repository path (${err.code ?? "UNKNOWN"}): ${root}`,
      );
  }
}

function compareLexicographic(a: string, b: string): number {
  return a.localeCompare(b, undefined, {
    numeric: false,
    sensitivity: "variant",
  });
}

async function readDirectorySorted(absoluteDir: string): Promise<string[]> {
  try {
    const names = await readdir(absoluteDir);
    names.sort(compareLexicographic);
    return names;
  } catch {
    return [];
  }
}

/**
 * Read-and-sort the **root** directory. Throws a typed `RepositoryScanError`
 * on failure — per the approved design, root-level races after the initial
 * `lstat` must throw rather than silently produce an empty tree.
 */
async function readRootDirectory(root: string, absoluteRoot: string): Promise<string[]> {
  try {
    const names = await readdir(absoluteRoot);
    names.sort(compareLexicographic);
    return names;
  } catch (err) {
    throw classifyRootError(root, asErrno(err));
  }
}

async function walk(
  absolutePath: string,
  absoluteRoot: string,
): Promise<RepositoryNode | null> {
  let stat;
  try {
    stat = await lstat(absolutePath);
  } catch {
    return null;
  }

  if (stat.isSymbolicLink()) {
    return null;
  }

  const name = pathBasename(absolutePath);
  const relativePath = relativePosix(absoluteRoot, absolutePath);

  if (defaultIgnoreEngine.shouldIgnore(relativePath, stat.isDirectory())) {
    return null;
  }

  if (stat.isDirectory()) {
    const entries = await readDirectorySorted(absolutePath);

    const children: RepositoryNode[] = [];
    for (const entry of entries) {
      const childRelativePath = relativePosix(absoluteRoot, resolvePath(absolutePath, entry));
      const childStat = await lstat(resolvePath(absolutePath, entry)).catch(() => null);
      if (childStat && defaultIgnoreEngine.shouldIgnore(childRelativePath, childStat.isDirectory())) {
        continue;
      }
      const childAbsolute = resolvePath(absolutePath, entry);
      const child = await walk(childAbsolute, absoluteRoot);
      if (child !== null) {
        children.push(child);
      }
    }

    const dirNode: DirectoryNode = {
      type: "directory",
      name,
      relativePath,
      absolutePath,
      children,
    };
    return dirNode;
  }

  if (stat.isFile()) {
    const fileNode: FileNode = {
      type: "file",
      name,
      relativePath,
      absolutePath,
      extension: extensionOf(name),
      size: stat.size,
    };
    return fileNode;
  }

  return null;
}

function countDescendants(node: DirectoryNode): number {
  let count = 0;
  for (const child of node.children) {
    count += 1;
    if (child.type === "directory") {
      count += countDescendants(child);
    }
  }
  return count;
}

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
export async function scanRepository(root: string): Promise<RepositoryTree> {
  const startedAt = Date.now();
  const absoluteRoot = resolvePath(root);

  let rootStat;
  try {
    rootStat = await lstat(absoluteRoot);
  } catch (err) {
    throw classifyRootError(root, asErrno(err));
  }

  if (rootStat.isSymbolicLink()) {
    throw new RepositoryScanError(
      "INVALID_ROOT",
      root,
      `Repository path is a symbolic link; root symlinks are not followed: ${root}`,
    );
  }

  if (!rootStat.isDirectory()) {
    throw new RepositoryScanError(
      "NOT_A_DIRECTORY",
      root,
      `Repository path is not a directory: ${root}`,
    );
  }

  const rootChildren: RepositoryNode[] = [];
  const entries = await readRootDirectory(root, absoluteRoot);

  for (const entry of entries) {
    const childAbsolute = resolvePath(absoluteRoot, entry);
    const child = await walk(childAbsolute, absoluteRoot);
    if (child !== null) {
      rootChildren.push(child);
    }
  }

  const rootNode: DirectoryNode = {
    type: "directory",
    name: pathBasename(absoluteRoot),
    relativePath: "",
    absolutePath: absoluteRoot,
    children: rootChildren,
  };

  const totalNodes = 1 + countDescendants(rootNode);

  return {
    root: rootNode,
    rootPath: root,
    scannedAt: new Date(startedAt).toISOString(),
    totalNodes,
  };
}
