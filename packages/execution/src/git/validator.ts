/**
 * @devforge/execution — Deterministic Git input validation (DF-015).
 *
 * Pure module: the same input always produces the same result. No filesystem
 * access happens here. Validation mirrors the CommandRunner's character
 * policy so every value that reaches git is known-safe at this layer.
 */
import * as path from 'node:path';
import { GIT_ERROR_CODES, type GitErrorCode } from './errors.js';
import {
  isInside,
  normalizeSeparators,
  resolveInside,
  splitSegments,
} from '../workspace/paths.js';

/**
 * Characters the CommandRunner rejects in arguments. Paths that survive
 * separator normalization are checked against these so failures surface
 * deterministically as {@link GitValidationError} instead of leaking a
 * CommandRunner error. Backslash is excluded because normalization already
 * consumes it as a separator.
 */
const PATH_SHELL_METACHARACTERS = ['|', '&', ';', '<', '>', '`', '$'] as const;

/**
 * Characters the CommandRunner rejects in arguments. Commit messages are
 * passed verbatim to `git commit -m`, so they must satisfy the same policy.
 */
const MESSAGE_SHELL_METACHARACTERS = [
  '|',
  '&',
  ';',
  '<',
  '>',
  '`',
  '$',
  '\\',
] as const;

const CONTROL_CHARACTERS = /[\u0000-\u001f]/;
/**
 * Control characters rejected in commit messages. Newline and carriage
 * return are excluded: line count is governed by `maxLines`. Tab remains
 * rejected because the CommandRunner rejects it in arguments.
 */
const MESSAGE_CONTROL_CHARACTERS = /[\u0000-\u0009\u000b\u000c\u000e-\u001f]/;
const DRIVE_LETTER = /^[A-Za-z]:/;

export type RepoRootValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export type GitPathsValidation =
  | { readonly ok: true; readonly paths: readonly string[] }
  | {
      readonly ok: false;
      readonly code: GitErrorCode;
      readonly reason: string;
      readonly path?: string;
    };

/** Limits applied to a commit message. */
export interface GitCommitLimits {
  /** Maximum message length in characters. */
  readonly maxLength: number;
  /** Maximum number of lines (split on CR/LF). */
  readonly maxLines: number;
}

export type CommitMessageValidation =
  | { readonly ok: true; readonly message: string }
  | {
      readonly ok: false;
      readonly code: GitErrorCode;
      readonly reason: string;
    };

/**
 * Validate a repository root. Must be a non-empty absolute path.
 */
export function validateRepoRoot(root: string): RepoRootValidation {
  if (typeof root !== 'string' || root.length === 0) {
    return { ok: false, reason: 'Repository root must not be empty' };
  }
  if (root.trim().length === 0) {
    return { ok: false, reason: 'Repository root must not be empty' };
  }
  if (!path.isAbsolute(root)) {
    return { ok: false, reason: 'Repository root must be an absolute path' };
  }
  return { ok: true };
}

/**
 * Validate and normalize a batch of repository-relative paths.
 *
 * Rejects:
 *  - empty/non-string paths
 *  - absolute paths (POSIX or Windows drive form)
 *  - `..` traversal in any form (including backslash-separated)
 *  - NUL/control characters and shell metacharacters
 *  - paths that resolve outside the repository root
 *  - duplicate paths (after normalization)
 *
 * @returns normalized POSIX-relative paths suitable for `git add --`/`git restore --`.
 */
export function validateGitPaths(
  paths: readonly string[],
  root: string,
): GitPathsValidation {
  if (!Array.isArray(paths)) {
    return {
      ok: false,
      code: GIT_ERROR_CODES.INVALID_PATH,
      reason: 'Paths must be an array',
    };
  }
  if (paths.length === 0) {
    return {
      ok: false,
      code: GIT_ERROR_CODES.INVALID_PATH,
      reason: 'At least one path is required',
    };
  }

  const normalizedPaths: string[] = [];
  const seen = new Set<string>();

  for (const p of paths) {
    const check = validateSinglePath(p, root);
    if (!check.ok) return check;
    if (seen.has(check.normalizedPath)) {
      return {
        ok: false,
        code: GIT_ERROR_CODES.DUPLICATE_PATH,
        reason: `Duplicate path: "${p}"`,
        path: p,
      };
    }
    seen.add(check.normalizedPath);
    normalizedPaths.push(check.normalizedPath);
  }

  return { ok: true, paths: normalizedPaths };
}

type SinglePathValidation =
  | { readonly ok: true; readonly normalizedPath: string }
  | {
      readonly ok: false;
      readonly code: GitErrorCode;
      readonly reason: string;
      readonly path?: string;
    };

function validateSinglePath(p: string, root: string): SinglePathValidation {
  if (typeof p !== 'string') {
    return {
      ok: false,
      code: GIT_ERROR_CODES.INVALID_PATH,
      reason: 'Each path must be a string',
    };
  }
  if (p.length === 0 || p.trim().length === 0) {
    return {
      ok: false,
      code: GIT_ERROR_CODES.INVALID_PATH,
      reason: 'Path must not be empty',
      path: p,
    };
  }

  const normalized = normalizeSeparators(p);

  if (normalized.startsWith('/') || DRIVE_LETTER.test(normalized)) {
    return {
      ok: false,
      code: GIT_ERROR_CODES.ABSOLUTE_PATH,
      reason: 'Path must be repository-relative',
      path: p,
    };
  }

  if (/[\u0000-\u001f]/.test(p)) {
    const hasNul = p.includes('\u0000');
    return {
      ok: false,
      code: hasNul
        ? GIT_ERROR_CODES.INVALID_CHARACTER
        : GIT_ERROR_CODES.CONTROL_CHARACTER,
      reason: hasNul
        ? 'Path contains a null character'
        : 'Path contains control characters',
      path: p,
    };
  }

  const segments = splitSegments(normalized);
  if (segments.length === 0) {
    return {
      ok: false,
      code: GIT_ERROR_CODES.INVALID_PATH,
      reason: 'Path must not be empty',
      path: p,
    };
  }

  for (const segment of segments) {
    if (segment === '..') {
      return {
        ok: false,
        code: GIT_ERROR_CODES.TRAVERSAL,
        reason: 'Path traversal is not allowed',
        path: p,
      };
    }
  }

  for (const ch of PATH_SHELL_METACHARACTERS) {
    if (normalized.includes(ch)) {
      return {
        ok: false,
        code: GIT_ERROR_CODES.SHELL_METACHARACTER,
        reason: `Path contains unsupported character "${ch}"`,
        path: p,
      };
    }
  }

  const normalizedPath = segments.join('/');
  const absolutePath = resolveInside(root, normalizedPath);

  if (!isInside(root, absolutePath)) {
    return {
      ok: false,
      code: GIT_ERROR_CODES.PATH_OUTSIDE_REPOSITORY,
      reason: 'Path escapes repository root',
      path: p,
    };
  }

  return { ok: true, normalizedPath };
}

/**
 * Validate a commit message.
 *
 * Rejects:
 *  - empty/whitespace-only messages
 *  - messages with more lines than `maxLines`
 *  - messages longer than `maxLength` characters
 *  - control characters and shell metacharacters
 */
export function validateCommitMessage(
  message: string,
  limits: GitCommitLimits,
): CommitMessageValidation {
  if (typeof message !== 'string') {
    return {
      ok: false,
      code: GIT_ERROR_CODES.EMPTY_COMMIT_MESSAGE,
      reason: 'Commit message must be a string',
    };
  }
  if (message.length === 0 || message.trim().length === 0) {
    return {
      ok: false,
      code: GIT_ERROR_CODES.EMPTY_COMMIT_MESSAGE,
      reason: 'Commit message must not be empty',
    };
  }

  const lines = message.split(/\r?\n/);
  if (lines.length > limits.maxLines) {
    return {
      ok: false,
      code: GIT_ERROR_CODES.MULTILINE_COMMIT_MESSAGE,
      reason: `Commit message must not exceed ${limits.maxLines} line${limits.maxLines === 1 ? '' : 's'}`,
    };
  }

  if (message.length > limits.maxLength) {
    return {
      ok: false,
      code: GIT_ERROR_CODES.COMMIT_MESSAGE_TOO_LONG,
      reason: `Commit message (${message.length} characters) exceeds limit (${limits.maxLength})`,
    };
  }

  if (MESSAGE_CONTROL_CHARACTERS.test(message)) {
    return {
      ok: false,
      code: GIT_ERROR_CODES.CONTROL_CHARACTER,
      reason: 'Commit message contains control characters',
    };
  }

  for (const ch of MESSAGE_SHELL_METACHARACTERS) {
    if (message.includes(ch)) {
      return {
        ok: false,
        code: GIT_ERROR_CODES.SHELL_METACHARACTER,
        reason: `Commit message contains unsupported character "${ch}"`,
      };
    }
  }

  return { ok: true, message };
}
