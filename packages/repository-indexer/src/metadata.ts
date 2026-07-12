/**
 * File Metadata Engine — single source of truth for "what does this file look like on disk?".
 *
 * Design notes:
 *  - Two entry points:
 *      * `buildFileMetadata(input)` — pure: walks an already-resolved stat snapshot.
 *        The walker hands in its lstat result so we never re-stat.
 *      * `getFileMetadata(absolutePath)` — convenience wrapper that calls
 *        `lstat` itself. For out-of-package callers (CLIs, tools) that did
 *        not pre-stat.
 *  - Never reads file contents. `size` comes from `stats.size` only.
 *  - `createdAt` is nullable: POSIX `birthtime` is unreliable on Linux. We do
 *    NOT invent a value when the platform cannot provide one.
 *  - All errors are typed (`MetadataError` with codes). Callers decide whether
 *    to skip, propagate, or surface.
 *  - Cross-platform by construction: POSIX separators come from the caller;
 *    the basename helper here handles any OS.
 */

import {
  extname,
  basename as pathBasename,
  sep,
  posix,
} from "node:path";
import { lstat } from "node:fs/promises";

/**
 * The exact subset of `fs.Stats` fields the engine consumes. Narrower than
 * `Stats` so tests can synthesize inputs cheaply.
 */
export interface StatLike {
  readonly size: number;
  readonly mtimeMs: number;
  readonly birthtimeMs: number;
  readonly ctimeMs: number;
  readonly isFile: () => boolean;
  readonly isDirectory: () => boolean;
  readonly isSymbolicLink: () => boolean;
}

export interface BuildMetadataInput {
  /** Absolute path on disk. May use native OS separators. */
  readonly absolutePath: string;
  /** Absolute path of the repository root (for relative-path computation). */
  readonly absoluteRoot: string;
  /** Pre-resolved lstat result. */
  readonly stats: StatLike;
}

export interface FileMetadata {
  readonly fileName: string;
  readonly extension: string;
  readonly size: number;
  readonly lastModified: string;
  readonly createdAt: string | null;
  readonly relativePath: string;
  readonly absolutePath: string;
}

export type MetadataErrorCode =
  | "NOT_FOUND"
  | "PERMISSION_DENIED"
  | "STAT_FAILED"
  | "INVALID_PATH";

export class MetadataError extends Error {
  readonly code: MetadataErrorCode;
  readonly path: string;
  constructor(code: MetadataErrorCode, path: string, message: string) {
    super(message);
    this.name = "MetadataError";
    this.code = code;
    this.path = path;
  }
}

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

function basename(p: string): string {
  return pathBasename(p);
}

function relativePosix(from: string, to: string): string {
  const rel = to.startsWith(from)
    ? to.slice(from.length).replace(/^[/\\]+/, "")
    : (() => {
        // Fallback when `relative` would be cleaner, but we keep imports
        // minimal to honor the "node:path only" constraint.
        const f = pathToPosix(from);
        const t = pathToPosix(to);
        return t.startsWith(f + "/") ? t.slice(f.length + 1) : t;
      })();
  if (rel === "" || rel === ".") return "";
  return pathToPosix(rel);
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function isValidPosixBirthtime(stats: StatLike): number {
  // Linux frequently returns 0 or ctime as birthtime; treat those as "unknown".
  const b = stats.birthtimeMs;
  if (!Number.isFinite(b) || b <= 0) return 0;
  // If birthtime equals ctime exactly to the millisecond on Linux/BSD, the
  // kernel did not record an actual birth time — only metadata change.
  if (b === stats.ctimeMs && b === stats.mtimeMs) return 0;
  return b;
}

/**
 * Pure builder. Constructed from inputs the caller already obtained.
 * Throws `MetadataError(INVALID_PATH)` only if the absolute path is malformed
 * (does not live under `absoluteRoot`).
 */
export function buildFileMetadata(input: BuildMetadataInput): FileMetadata {
  const { absolutePath, absoluteRoot, stats } = input;

  if (stats.isDirectory() || stats.isSymbolicLink()) {
    throw new MetadataError(
      "INVALID_PATH",
      absolutePath,
      `buildFileMetadata called on non-regular file: ${absolutePath}`,
    );
  }

  const rel = relativePosix(absoluteRoot, absolutePath);
  if (rel === "" || rel.startsWith("..")) {
    throw new MetadataError(
      "INVALID_PATH",
      absolutePath,
      `Path is not inside repository root: ${absolutePath}`,
    );
  }

  const fileName = basename(absolutePath);
  const extension = pathToPosix(extname(absolutePath)).replace(/^\./, "");

  const birth = isValidPosixBirthtime(stats);
  const createdAt = birth > 0 ? toIso(birth) : null;

  return {
    fileName,
    extension,
    size: stats.size,
    lastModified: toIso(stats.mtimeMs),
    createdAt,
    relativePath: rel,
    absolutePath,
  };
}

/**
 * Convenience for callers without a pre-resolved stat. Calls `lstat` once.
 * Symlinks, directories, and missing paths raise typed `MetadataError`s.
 */
export async function getFileMetadata(
  absolutePath: string,
  absoluteRoot: string,
): Promise<FileMetadata> {
  let stats: Awaited<ReturnType<typeof lstat>>;
  try {
    stats = await lstat(absolutePath);
  } catch (err) {
    const e = asErrno(err);
    switch (e.code) {
      case "ENOENT":
        throw new MetadataError(
          "NOT_FOUND",
          absolutePath,
          `File does not exist: ${absolutePath}`,
        );
      case "EACCES":
      case "EPERM":
        throw new MetadataError(
          "PERMISSION_DENIED",
          absolutePath,
          `Permission denied: ${absolutePath}`,
        );
      default:
        throw new MetadataError(
          "STAT_FAILED",
          absolutePath,
          `Failed to stat file (${e.code ?? "UNKNOWN"}): ${absolutePath}`,
        );
    }
  }

  return buildFileMetadata({
    absolutePath,
    absoluteRoot,
    stats,
  });
}
