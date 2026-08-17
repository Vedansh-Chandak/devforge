/**
 * @devforge/execution — Deterministic workspace validation.
 *
 * `validatePath` and `validateContent` are pure functions: the same input
 * always produces the same result. No filesystem access happens here.
 * Symlink-escape detection is the only check that needs the filesystem,
 * and it is provided separately as {@link validateSymlinkEscape}.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ContentValidation, FileContent, PathValidation } from '../types.js';
import { DEFAULT_MAX_FILE_SIZE } from '../types.js';
import { isInside, normalizeSeparators, resolveInside, splitSegments } from './paths.js';

/** Codes emitted by path validation. */
export const PATH_VALIDATION_CODES = {
  EMPTY_PATH: 'EMPTY_PATH',
  ABSOLUTE_PATH: 'ABSOLUTE_PATH',
  TRAVERSAL: 'TRAVERSAL',
  INVALID_CHARACTER: 'INVALID_CHARACTER',
  ESCAPES_ROOT: 'ESCAPES_ROOT',
} as const;

/** Codes emitted by content validation. */
export const CONTENT_VALIDATION_CODES = {
  INVALID_UTF8: 'INVALID_UTF8',
  OVERSIZED: 'OVERSIZED',
  NOT_TEXT: 'NOT_TEXT',
} as const;

const DRIVE_LETTER = /^[A-Za-z]:/;

/**
 * Deterministically validate a workspace-relative path.
 *
 * Rejects:
 *  - empty paths
 *  - absolute paths (POSIX or Windows drive form)
 *  - `..` traversal in any form (including backslash-separated)
 *  - NUL and control characters
 *  - paths that resolve outside the workspace root
 *
 * @param relativePath - the raw user-supplied path
 * @param root - absolute workspace root used for containment checking
 */
export function validatePath(relativePath: string, root: string): PathValidation {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    return { ok: false, code: PATH_VALIDATION_CODES.EMPTY_PATH, reason: 'Path must not be empty' };
  }
  if (relativePath.trim().length === 0) {
    return { ok: false, code: PATH_VALIDATION_CODES.EMPTY_PATH, reason: 'Path must not be empty' };
  }

  const normalized = normalizeSeparators(relativePath);

  if (normalized.startsWith('/')) {
    return { ok: false, code: PATH_VALIDATION_CODES.ABSOLUTE_PATH, reason: 'Path must be workspace-relative' };
  }
  if (DRIVE_LETTER.test(normalized)) {
    return { ok: false, code: PATH_VALIDATION_CODES.ABSOLUTE_PATH, reason: 'Path must be workspace-relative' };
  }

  const segments = splitSegments(normalized);

  if (segments.length === 0) {
    return { ok: false, code: PATH_VALIDATION_CODES.EMPTY_PATH, reason: 'Path must not be empty' };
  }

  for (const segment of segments) {
    if (segment === '..') {
      return { ok: false, code: PATH_VALIDATION_CODES.TRAVERSAL, reason: 'Path traversal is not allowed' };
    }
    if (segment.includes('\u0000')) {
      return { ok: false, code: PATH_VALIDATION_CODES.INVALID_CHARACTER, reason: 'Path contains a null character' };
    }
  }

  if (/[\u0000-\u001f]/.test(relativePath)) {
    return { ok: false, code: PATH_VALIDATION_CODES.INVALID_CHARACTER, reason: 'Path contains control characters' };
  }

  const normalizedPath = segments.join('/');
  const absolutePath = resolveInside(root, normalizedPath);

  if (!isInside(root, absolutePath)) {
    return { ok: false, code: PATH_VALIDATION_CODES.ESCAPES_ROOT, reason: 'Path escapes workspace root' };
  }

  return { ok: true, normalizedPath, absolutePath };
}

/**
 * Deterministically validate file content.
 *
 * Accepts a string or a byte buffer. Byte buffers are rejected when they are
 * not valid UTF-8 text. Both forms are rejected when the UTF-8 byte length
 * exceeds `maxFileSizeBytes`.
 *
 * @returns the canonical text form when valid.
 */
export function validateContent(
  content: FileContent,
  maxFileSizeBytes: number,
): ContentValidation {
  if (typeof content !== 'string' && !(content instanceof Uint8Array)) {
    return { ok: false, code: CONTENT_VALIDATION_CODES.NOT_TEXT, reason: 'Content must be a string or byte buffer' };
  }

  let text: string;
  if (typeof content === 'string') {
    text = content;
  } else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(content);
    } catch {
      return { ok: false, code: CONTENT_VALIDATION_CODES.INVALID_UTF8, reason: 'Content is not valid UTF-8 text' };
    }
  }

  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength > maxFileSizeBytes) {
    return {
      ok: false,
      code: CONTENT_VALIDATION_CODES.OVERSIZED,
      reason: `Content (${byteLength} bytes) exceeds limit (${maxFileSizeBytes} bytes)`,
    };
  }

  return { ok: true, text, byteLength };
}

/** Result of the filesystem-backed symlink escape check. */
export type SymlinkEscapeResult =
  | { readonly ok: true; readonly realPath: string }
  | { readonly ok: false; readonly realPath?: string; readonly reason: string };

/**
 * Check that an absolute path cannot escape the canonical workspace root
 * through symlinks. Walks up to the deepest existing ancestor and compares
 * its `realpath` against the canonical root.
 */
export async function validateSymlinkEscape(
  absoluteRoot: string,
  absoluteTarget: string,
): Promise<SymlinkEscapeResult> {
  let realRoot: string;
  try {
    realRoot = await fs.realpath(absoluteRoot);
  } catch {
    return { ok: false, reason: 'Workspace root is not accessible' };
  }

  let probe = absoluteTarget;
  for (;;) {
    let realPath: string;
    try {
      realPath = await fs.realpath(probe);
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) {
        return { ok: true, realPath: realRoot };
      }
      probe = parent;
      continue;
    }
    if (!isInside(realRoot, realPath)) {
      return { ok: false, realPath, reason: 'Path escapes workspace root through a symlink' };
    }
    return { ok: true, realPath };
  }
}

/** Convenience wrapper that throws nothing; used by tests. */
export function validateWorkspaceRoot(root: string): { readonly ok: boolean; readonly reason?: string } {
  if (typeof root !== 'string' || root.length === 0) {
    return { ok: false, reason: 'Workspace root must not be empty' };
  }
  if (!path.isAbsolute(root)) {
    return { ok: false, reason: 'Workspace root must be an absolute path' };
  }
  return { ok: true };
}

export { DEFAULT_MAX_FILE_SIZE };
