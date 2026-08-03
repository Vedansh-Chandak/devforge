/**
 * @devforge/execution — Sandbox containment for command execution.
 *
 * Ensures commands run only inside the workspace root.
 * Rejects external cwd, prevents traversal, normalizes paths.
 *
 * Pure and deterministic: performs no filesystem access. Symlink escapes
 * are rejected at spawn time by the runner using realpath resolution.
 */

import * as path from 'node:path';
import { CommandSandboxError, COMMAND_ERROR_CODES } from './errors.js';

export type SandboxValidation =
  | {
      readonly ok: true;
      readonly absoluteCwd: string;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly reason: string;
    };

export interface SandboxConfig {
  readonly workspaceRoot: string;
}

const DRIVE_LETTER_REGEX = /^[A-Za-z]:/;

/** Normalize any user-supplied path to POSIX separators. */
function normalizeSeparators(input: string): string {
  return input.replace(/\\/g, '/');
}

/** Split a normalized path into segments, dropping empty and `.` segments. */
function splitSegments(normalizedPath: string): string[] {
  return normalizedPath.split('/').filter((segment) => segment !== '' && segment !== '.');
}

/** Resolve a POSIX path against the workspace root. */
function resolveInside(root: string, relativePosixPath: string): string {
  return path.resolve(root, relativePosixPath);
}

/** True when `target` is inside or equal to `root` (both absolute paths). */
function isInside(root: string, target: string): boolean {
  const normalizedRoot = path.normalize(root);
  const normalizedTarget = path.normalize(target);
  if (normalizedTarget === normalizedRoot) return true;
  return normalizedTarget.startsWith(normalizedRoot + path.sep);
}

export function createSandbox(config: SandboxConfig): {
  readonly validateCwd: (cwd: string) => SandboxValidation;
  readonly validatePaths: (paths: readonly string[]) => SandboxValidation;
  readonly resolveInSandbox: (relativePath: string) => string;
} {
  const canonicalRoot = path.resolve(config.workspaceRoot);

  function validateCwd(cwd: string): SandboxValidation {
    if (typeof cwd !== 'string' || cwd.length === 0) {
      return { ok: false, code: COMMAND_ERROR_CODES.EXTERNAL_CWD, reason: 'Working directory must not be empty' };
    }

    const trimmed = cwd.trim();
    if (trimmed.length === 0) {
      return { ok: false, code: COMMAND_ERROR_CODES.EXTERNAL_CWD, reason: 'Working directory must not be empty' };
    }

    const normalized = normalizeSeparators(trimmed);

    // Handle "." as current directory
    if (normalized === '.') {
      return { ok: true, absoluteCwd: canonicalRoot };
    }

    if (normalized.startsWith('/') || DRIVE_LETTER_REGEX.test(normalized)) {
      const absoluteCwd = path.resolve(normalized);
      if (!isInside(canonicalRoot, absoluteCwd)) {
        return { ok: false, code: COMMAND_ERROR_CODES.EXTERNAL_CWD, reason: 'Working directory is outside workspace root' };
      }
      return { ok: true, absoluteCwd };
    }

    const segments = splitSegments(normalized);
    if (segments.length === 0) {
      return { ok: false, code: COMMAND_ERROR_CODES.CWD_TRAVERSAL, reason: 'Working directory resolves to empty path' };
    }

    for (const segment of segments) {
      if (segment === '..') {
        return { ok: false, code: COMMAND_ERROR_CODES.CWD_TRAVERSAL, reason: 'Working directory contains path traversal' };
      }
    }

    const absoluteCwd = resolveInside(canonicalRoot, segments.join('/'));

    if (!isInside(canonicalRoot, absoluteCwd)) {
      return { ok: false, code: COMMAND_ERROR_CODES.EXTERNAL_CWD, reason: 'Working directory escapes workspace root' };
    }

    return { ok: true, absoluteCwd };
  }

  function validatePaths(paths: readonly string[]): SandboxValidation {
    for (const p of paths) {
      if (typeof p !== 'string' || p.length === 0) {
        return { ok: false, code: COMMAND_ERROR_CODES.EXTERNAL_CWD, reason: 'Path must not be empty' };
      }
      const normalized = normalizeSeparators(p);
      if (normalized.startsWith('/') || DRIVE_LETTER_REGEX.test(normalized)) {
        const absolute = path.resolve(normalized);
        if (!isInside(canonicalRoot, absolute)) {
          return { ok: false, code: COMMAND_ERROR_CODES.EXTERNAL_CWD, reason: 'Path escapes workspace root' };
        }
      } else {
        const segments = splitSegments(normalized);
        for (const segment of segments) {
          if (segment === '..') {
            return { ok: false, code: COMMAND_ERROR_CODES.CWD_TRAVERSAL, reason: 'Path contains traversal' };
          }
        }
        const absolute = resolveInside(canonicalRoot, segments.join('/'));
        if (!isInside(canonicalRoot, absolute)) {
          return { ok: false, code: COMMAND_ERROR_CODES.EXTERNAL_CWD, reason: 'Path escapes workspace root' };
        }
      }
    }
    return { ok: true, absoluteCwd: canonicalRoot };
  }

  function resolveInSandbox(relativePath: string): string {
    const normalized = normalizeSeparators(relativePath);
    const segments = splitSegments(normalized);
    return resolveInside(canonicalRoot, segments.join('/'));
  }

  return { validateCwd, validatePaths, resolveInSandbox };
}

export { COMMAND_ERROR_CODES };
