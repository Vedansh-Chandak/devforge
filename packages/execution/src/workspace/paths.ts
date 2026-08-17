/**
 * @devforge/execution — Workspace path utilities.
 *
 * All workspace paths are stored POSIX-style with `/` separators.
 * These helpers are pure and deterministic.
 */
import * as path from 'node:path';

/**
 * Normalize any user-supplied path to POSIX separators.
 * Backslashes are treated as separators so `a\..\..\b` cannot bypass checks.
 */
export function normalizeSeparators(input: string): string {
  return input.replace(/\\/g, '/');
}

/**
 * Split a normalized path into segments, dropping empty and `.` segments.
 * `..` segments are preserved so callers can detect traversal.
 */
export function splitSegments(normalizedPath: string): string[] {
  return normalizedPath.split('/').filter((segment) => segment !== '' && segment !== '.');
}

/**
 * Join workspace-relative path segments with `/`.
 */
export function joinRel(...segments: Array<string | undefined>): string {
  const clean = segments
    .filter((segment): segment is string => segment !== undefined)
    .map(normalizeSeparators)
    .map((segment) => segment.replace(/^\/+|\/+$/g, ''));
  return clean.join('/');
}

/**
 * Resolve a workspace-relative POSIX path against the workspace root,
 * producing a platform-native absolute path.
 */
export function resolveInside(root: string, relativePosixPath: string): string {
  return path.resolve(root, relativePosixPath);
}

/**
 * True when `target` (an absolute path) is inside or equal to `root`
 * (an absolute path). Uses separator-aware containment so `/a/foo`
 * does not contain `/a/foobar`.
 */
export function isInside(root: string, target: string): boolean {
  const normalizedRoot = path.normalize(root);
  const normalizedTarget = path.normalize(target);
  if (normalizedTarget === normalizedRoot) return true;
  if (!normalizedTarget.startsWith(normalizedRoot + path.sep)) return false;
  return true;
}
