/**
 * Path Security for repository.readFile
 *
 * Defends against:
 * - ../ traversal
 * - ../../ traversal
 * - Absolute paths outside workspace
 * - Symlink escapes (via realpath canonicalization)
 * - Encoded/normalized traversal patterns
 *
 * Also enforces:
 * - Sensitive file policy (.env, .pem, .key, etc.)
 * - File size limits
 * - Binary file detection
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Sensitive File Patterns ──

/**
 * Files that must never be exposed through repository.readFile.
 * Uses a simple explicit deny policy — NOT a complete secret scanner.
 */
const SENSITIVE_PATTERNS: ReadonlyArray<{ test: (basename: string, relativePath: string) => boolean }> = [
  // .env files
  { test: (_b, rel) => /^\.env$/i.test(path.basename(rel)) || /^\.env\./i.test(path.basename(rel)) },
  // PEM / key files
  { test: (b) => /\.pem$/i.test(b) },
  { test: (b) => /\.key$/i.test(b) },
  { test: (b) => /\.p12$/i.test(b) },
  { test: (b) => /\.pfx$/i.test(b) },
  // SSH keys
  { test: (b) => /^id_rsa$/i.test(b) || /^id_ed25519$/i.test(b) || /^id_ecdsa$/i.test(b) },
  // Certificate / credential files
  { test: (b) => /\.cert$/i.test(b) || /\.crt$/i.test(b) },
  { test: (b) => /^credentials$/i.test(b) },
  { test: (b) => /\.keystore$/i.test(b) || /\.jks$/i.test(b) },
  // Secrets / tokens
  { test: (b) => /^\.secret$/i.test(b) || /^\.token$/i.test(b) },
  { test: (b) => /^\.npmrc$/i.test(b) || /^\.yarnrc$/i.test(b) },
];

/**
 * Check if a file matches the sensitive file policy.
 * Returns true if the file is sensitive and should NOT be exposed.
 */
export function isSensitiveFile(relativePath: string): boolean {
  const basename = path.basename(relativePath);
  return SENSITIVE_PATTERNS.some(p => p.test(basename, relativePath));
}

// ── Path Validation ──

export interface PathValidationResult {
  readonly valid: boolean;
  /** The canonical absolute path if valid. */
  readonly canonicalPath?: string;
  /** Repository-relative path (1-based line semantics). */
  readonly relativePath?: string;
  /** Error code if invalid. */
  readonly errorCode?: string;
  /** Human-readable error message if invalid. */
  readonly error?: string;
}

/**
 * Validate that a target path is safely within the workspace root.
 *
 * Steps:
 * 1. Resolve target relative to workspaceRoot
 * 2. Canonicalize both root and target (resolves symlinks)
 * 3. Verify canonical target starts with canonical root + path.sep (or === root)
 * 4. Check sensitive file policy
 *
 * @param targetPath - Repository-relative path to validate
 * @param workspaceRoot - Absolute path to workspace root
 * @returns PathValidationResult with canonical path or error
 */
export function validateSafePath(
  targetPath: string,
  workspaceRoot: string,
): PathValidationResult {
  // Reject absolute paths as input — must be repo-relative
  if (path.isAbsolute(targetPath)) {
    return {
      valid: false,
      errorCode: 'INVALID_PATH',
      error: 'Path must be repository-relative, not absolute',
    };
  }

  // Reject empty paths
  if (!targetPath.trim()) {
    return {
      valid: false,
      errorCode: 'INVALID_PATH',
      error: 'Path must not be empty',
    };
  }

  // Reject obvious traversal patterns before resolution
  // This catches both raw ../ and encoded forms after normalization
  const normalizedTarget = path.normalize(targetPath);
  if (normalizedTarget.startsWith('..') || path.isAbsolute(normalizedTarget)) {
    return {
      valid: false,
      errorCode: 'INVALID_PATH',
      error: 'Path traversal is not allowed',
    };
  }

  // Construct the full absolute path
  const absoluteTarget = path.resolve(workspaceRoot, normalizedTarget);

  // Canonicalize workspace root (handle symlinks)
  let canonicalRoot: string;
  try {
    canonicalRoot = fs.realpathSync(workspaceRoot);
  } catch {
    return {
      valid: false,
      errorCode: 'WORKSPACE_ERROR',
      error: 'Workspace root does not exist or is not accessible',
    };
  }

  // Canonicalize target path
  let canonicalTarget: string;
  try {
    canonicalTarget = fs.realpathSync(absoluteTarget);
  } catch {
    // File doesn't exist yet — use the canonical form of what it WOULD be
    // We check containment by canonicalizing the parent and appending
    const parentDir = path.dirname(absoluteTarget);
    try {
      const canonicalParent = fs.realpathSync(parentDir);
      canonicalTarget = path.join(canonicalParent, path.basename(absoluteTarget));
    } catch {
      return {
        valid: false,
        errorCode: 'INVALID_PATH',
        error: 'Target path is not accessible',
      };
    }
  }

  // Security check: canonical target must be inside canonical root
  // Must start with root + separator to prevent root-as-prefix attacks
  // (e.g., /tmp/foo vs /tmp/foobar)
  if (
    canonicalTarget !== canonicalRoot &&
    !canonicalTarget.startsWith(canonicalRoot + path.sep)
  ) {
    return {
      valid: false,
      errorCode: 'PERMISSION_DENIED',
      error: 'Path escapes workspace root',
    };
  }

  // Compute relative path for output
  const relativePath = path.relative(canonicalRoot, canonicalTarget);

  // Check sensitive file policy
  if (isSensitiveFile(relativePath)) {
    return {
      valid: false,
      errorCode: 'PERMISSION_DENIED',
      error: 'Access to sensitive files is denied',
    };
  }

  return {
    valid: true,
    canonicalPath: canonicalTarget,
    relativePath,
  };
}

// ── File Size ──

export interface SizeCheckResult {
  readonly ok: boolean;
  readonly size?: number;
  readonly errorCode?: string;
  readonly error?: string;
}

/**
 * Check if file size is within the allowed limit.
 */
export function checkFileSize(
  filePath: string,
  maxBytes: number,
): SizeCheckResult {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return { ok: false, errorCode: 'INVALID_INPUT', error: 'Path is not a file' };
    }
    if (stat.size > maxBytes) {
      return {
        ok: false,
        errorCode: 'LIMIT_EXCEEDED',
        error: `File size (${stat.size} bytes) exceeds limit (${maxBytes} bytes)`,
      };
    }
    return { ok: true, size: stat.size };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, errorCode: 'NOT_FOUND', error: 'File not found' };
    }
    return { ok: false, errorCode: 'EXECUTION_FAILED', error: String(err) };
  }
}

// ── Binary File Detection ──

/**
 * Detect if content appears to be binary by scanning the first 512 bytes
 * for null bytes (standard heuristic used by many tools including git).
 */
export function isBinaryContent(buffer: Buffer): boolean {
  const checkLen = Math.min(buffer.length, 512);
  for (let i = 0; i < checkLen; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}