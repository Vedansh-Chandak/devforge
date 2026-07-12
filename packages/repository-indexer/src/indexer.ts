import { resolve as resolvePath, relative, sep, posix } from "node:path";
import { lstat, readdir } from "node:fs/promises";

import type {
  DirectoryNode,
  FileNode,
  RepositoryNode,
  RepositoryTree,
  ScanError,
  ScanOptions,
  ScanResult,
} from "./types.js";
import { createIgnoreMatcher, type IgnoreMatcher } from "./ignore.js";

function pathToPosix(p: string): string {
  if (sep === posix.sep) return p;
  return p.split(sep).join(posix.sep);
}

function relativePosix(from: string, to: string): string {
  const rel = relative(from, to);
  if (rel === "" || rel === ".") return "";
  return pathToPosix(rel);
}

function basename(p: string): string {
  const norm = pathToPosix(p);
  const idx = norm.lastIndexOf("/");
  return idx === -1 ? norm : norm.slice(idx + 1);
}

function toScanError(root: string, code: ScanError["code"], message: string): ScanError {
  return { code, message, rootPath: root };
}

function classifyRootError(root: string, err: NodeJS.ErrnoException): ScanError {
  switch (err.code) {
    case "ENOENT":
      return toScanError(root, "NOT_FOUND", `Root path does not exist: ${root}`);
    case "ENOTDIR":
      return toScanError(root, "NOT_A_DIRECTORY", `Root path is not a directory: ${root}`);
    case "EACCES":
    case "EPERM":
      return toScanError(
        root,
        "PERMISSION_DENIED",
        `Root path is not readable due to permissions: ${root}`,
      );
    default:
      return toScanError(
        root,
        "INVALID_ROOT",
        `Unable to access root path: ${root} (${err.code ?? "UNKNOWN"})`,
      );
  }
}

function compareLexicographic(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: false, sensitivity: "variant" });
}

interface WalkContext {
  readonly absoluteRoot: string;
  readonly relativeRoot: string;
  readonly totalNodes: { value: number };
  readonly matcher: IgnoreMatcher;
}

async function readDirectorySorted(absoluteDir: string): Promise<string[]> {
  const names = await readdir(absoluteDir);
  names.sort(compareLexicographic);
  return names;
}

async function walk(
  absolutePath: string,
  ctx: WalkContext,
  depth: number,
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

  const name = basename(absolutePath);
  const relPath = relativePosix(ctx.absoluteRoot, absolutePath);
  ctx.totalNodes.value += 1;

  if (stat.isDirectory()) {
    let entries: string[];
    try {
      entries = await readDirectorySorted(absolutePath);
    } catch {
      return null;
    }

    const children: RepositoryNode[] = [];
    for (const entry of entries) {
      if (ctx.matcher.shouldIgnore(entry)) {
        continue;
      }
      const childAbsolute = resolvePath(absolutePath, entry);
      const child = await walk(childAbsolute, ctx, depth + 1);
      if (child !== null) {
        children.push(child);
      }
    }

    const dirNode: DirectoryNode = {
      type: "directory",
      name,
      path: relPath,
      children,
    };
    return dirNode;
  }

  if (stat.isFile()) {
    const fileNode: FileNode = {
      type: "file",
      name,
      path: relPath,
    };
    return fileNode;
  }

  return null;
}

/**
 * Recursively walks the filesystem rooted at `root` and returns a
 * `RepositoryTree`. Root-level failures (missing path, file-where-folder,
 * permission denied) are surfaced as `{ ok: false, error }`; subtree
 * failures (unreadable subdirectory, broken symlink, race-condition
 * disappearance) are silently skipped so the rest of the tree is
 * preserved.
 *
 * Symlinks are not followed and are not represented in this milestone
 * (DF-005.2). DF-005.3+ may add a `SymlinkNode` variant to the union.
 */
export async function scanRepository(
  root: string,
  options?: ScanOptions,
): Promise<ScanResult> {
  const startedAt = Date.now();
  const absoluteRoot = resolvePath(root);

  let rootStat;
  try {
    rootStat = await lstat(absoluteRoot);
  } catch (err) {
    return { ok: false, error: classifyRootError(root, asErrno(err)) };
  }

  if (!rootStat.isDirectory()) {
    if (rootStat.isSymbolicLink()) {
      return {
        ok: false,
        error: toScanError(
          root,
          "NOT_A_DIRECTORY",
          `Root is a symbolic link; this build does not follow root symlinks: ${root}`,
        ),
      };
    }
    return {
      ok: false,
      error: toScanError(root, "NOT_A_DIRECTORY", `Root path is not a directory: ${root}`),
    };
  }

  const ctx: WalkContext = {
    absoluteRoot,
    relativeRoot: "",
    totalNodes: { value: 1 },
    matcher: createIgnoreMatcher(
      options?.ignore ? { extra: options.ignore } : undefined,
    ),
  };

  const rootChildren: RepositoryNode[] = [];
  let entryNames: string[];
  try {
    entryNames = await readDirectorySorted(absoluteRoot);
  } catch (err) {
    return { ok: false, error: classifyRootError(root, asErrno(err)) };
  }

  for (const entry of entryNames) {
    if (ctx.matcher.shouldIgnore(entry)) {
      continue;
    }
    const childAbsolute = resolvePath(absoluteRoot, entry);
    const child = await walk(childAbsolute, ctx, 1);
    if (child !== null) {
      rootChildren.push(child);
    }
  }

  const rootNode: DirectoryNode = {
    type: "directory",
    name: basename(absoluteRoot),
    path: "",
    children: rootChildren,
  };

  const tree: RepositoryTree = {
    root: rootNode,
    rootPath: root,
    scannedAt: new Date(startedAt).toISOString(),
    totalNodes: ctx.totalNodes.value,
  };

  return { ok: true, tree };
}

function asErrno(err: unknown): NodeJS.ErrnoException {
  if (err instanceof Error) {
    return err as NodeJS.ErrnoException;
  }
  const e = new Error(String(err)) as NodeJS.ErrnoException;
  return e;
}
