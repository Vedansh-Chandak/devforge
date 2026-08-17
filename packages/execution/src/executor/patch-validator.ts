/**
 * @devforge/execution — Patch validation (DF-016B).
 *
 * Validates CodePatch arrays structurally and against the workspace.
 * Provides pure validation (no side effects) and async workspace-aware validation.
 */

import * as path from 'node:path';
import { validatePath, PATH_VALIDATION_CODES } from '../workspace/validator.js';
import type { Workspace } from '../workspace/workspace.js';
import type {
  CodePatch,
  NormalizedPatch,
  PatchValidationConfig,
  PatchViolation,
  PatchStructureValidationResult,
} from './patch-model.js';
import { defaultPatchValidationConfig, hashText } from './patch-model.js';
import { PatchValidationError } from './coding-errors.js';

/** Normalize a workspace-relative POSIX path. */
function normalizeFilePath(file: string): string {
  const segments = file.split('/').filter((s) => s.length > 0);
  return segments.join('/');
}

/** Check if a path is absolute (POSIX or Windows). */
function isAbsolutePath(file: string): boolean {
  if (file.startsWith('/')) return true;
  if (/^[A-Za-z]:[\\/]/.test(file)) return true;
  return false;
}

/** Check if a path contains traversal sequences. */
function hasTraversal(file: string): boolean {
  const segments = file.split('/');
  return segments.some((s) => s === '..' || s === '.');
}

/** Validate a single patch structurally (pure, no workspace). */
function validatePatchStructure(
  patch: CodePatch,
  config: Required<PatchValidationConfig>,
): PatchViolation[] {
  const violations: PatchViolation[] = [];

  // 1. Invalid operation
  if (patch.operation !== 'CREATE' && patch.operation !== 'MODIFY' && patch.operation !== 'DELETE') {
    violations.push({
      code: 'INVALID_OPERATION',
      message: `Invalid operation "${patch.operation}"`,
      patchId: patch.id,
      file: patch.file,
    });
  }

  // 2. Empty file path
  if (!patch.file || patch.file.trim().length === 0) {
    violations.push({
      code: 'EMPTY_FILE_PATH',
      message: 'File path must not be empty',
      patchId: patch.id,
      file: patch.file,
    });
    return violations; // Can't continue with empty path
  }

  // 3. Absolute path
  if (isAbsolutePath(patch.file)) {
    violations.push({
      code: 'ABSOLUTE_PATH',
      message: 'File path must be workspace-relative (not absolute)',
      patchId: patch.id,
      file: patch.file,
    });
    return violations;
  }

  // 4. Traversal
  if (hasTraversal(patch.file)) {
    violations.push({
      code: 'TRAVERSAL',
      message: 'File path must not contain ".." or "." traversal',
      patchId: patch.id,
      file: patch.file,
    });
    return violations;
  }

  // 5. Path validation via workspace validator (pure check)
  const pathResult = validatePath(patch.file, '/workspace'); // root doesn't matter for pure check
  if (!pathResult.ok) {
    const code =
      pathResult.code === PATH_VALIDATION_CODES.TRAVERSAL ||
      pathResult.code === PATH_VALIDATION_CODES.ESCAPES_ROOT
        ? 'TRAVERSAL'
        : pathResult.code === PATH_VALIDATION_CODES.ABSOLUTE_PATH
          ? 'ABSOLUTE_PATH'
          : 'INVALID_FILE_PATH';
    violations.push({
      code,
      message: pathResult.reason,
      patchId: patch.id,
      file: patch.file,
    });
  }

  // 6. Content checks for CREATE/MODIFY
  if (patch.operation === 'CREATE' || patch.operation === 'MODIFY') {
    if (!patch.newContent || patch.newContent.length === 0) {
      violations.push({
        code: 'EMPTY_CONTENT',
        message: `${patch.operation} operation requires non-empty newContent`,
        patchId: patch.id,
        file: patch.file,
      });
    }
    if (patch.newContent) {
      const bytes = new TextEncoder().encode(patch.newContent).length;
      if (bytes > config.maxPatchBytes) {
        violations.push({
          code: 'OVERSIZED_PATCH',
          message: `Patch content (${bytes} bytes) exceeds limit (${config.maxPatchBytes} bytes)`,
          patchId: patch.id,
          file: patch.file,
        });
      }
    }
  }

  // 7. DELETE should not have newContent
  if (patch.operation === 'DELETE' && patch.newContent && patch.newContent.length > 0) {
    violations.push({
      code: 'EMPTY_CONTENT',
      message: 'DELETE operation must not have newContent',
      patchId: patch.id,
      file: patch.file,
    });
  }

  // 8. expectedHash is only valid for MODIFY/DELETE
  if (patch.expectedHash && patch.operation === 'CREATE') {
    violations.push({
      code: 'INVALID_OPERATION',
      message: 'CREATE operation must not have expectedHash',
      patchId: patch.id,
      file: patch.file,
    });
  }

  return violations;
}

/**
 * Validate a batch of patches structurally (pure validation).
 * Checks: duplicate IDs, duplicate target files, structural validity, batch size limit.
 */
export function validatePatchStructureBatch(
  patches: readonly CodePatch[],
  config: PatchValidationConfig = {},
): PatchStructureValidationResult {
  const mergedConfig = defaultPatchValidationConfig(config);
  const allViolations: PatchViolation[] = [];
  const normalized: NormalizedPatch[] = [];
  const seenIds = new Set<string>();
  const seenFiles = new Set<string>();
  let totalBytes = 0;

  for (const patch of patches) {
    // Duplicate ID
    if (seenIds.has(patch.id)) {
      allViolations.push({
        code: 'DUPLICATE_ID',
        message: `Duplicate patch id: ${patch.id}`,
        patchId: patch.id,
        file: patch.file,
      });
    }
    seenIds.add(patch.id);

    // Structural validation
    const structural = validatePatchStructure(patch, mergedConfig);
    allViolations.push(...structural);

    // Track normalized file for duplicate target check
    const normalizedFile = normalizeFilePath(patch.file);
    if (seenFiles.has(normalizedFile)) {
      allViolations.push({
        code: 'DUPLICATE_TARGET',
        message: `Duplicate target file: ${normalizedFile}`,
        patchId: patch.id,
        file: normalizedFile,
      });
    }
    seenFiles.add(normalizedFile);

    // Track total bytes for batch limit
    if (patch.newContent) {
      totalBytes += new TextEncoder().encode(patch.newContent).length;
    }

    // Build normalized patch
    normalized.push({
      ...patch,
      file: normalizedFile,
    });
  }

  // Batch size limit
  if (totalBytes > mergedConfig.maxTotalPatchBytes) {
    allViolations.push({
      code: 'OVERSIZED_BATCH',
      message: `Total patch batch (${totalBytes} bytes) exceeds limit (${mergedConfig.maxTotalPatchBytes} bytes)`,
    });
  }

  return {
    valid: allViolations.length === 0,
    violations: allViolations,
    normalized,
  };
}

/**
 * Validate patches against the workspace (existence, hash matching).
 * Requires workspace reads; throws PatchValidationError on any violation.
 */
export async function validatePatchesWorkspace(
  patches: readonly NormalizedPatch[],
  workspace: Workspace,
  config: PatchValidationConfig = {},
): Promise<readonly PatchViolation[]> {
  const violations: PatchViolation[] = [];

  for (const patch of patches) {
    // Existence checks
    const exists = await workspace.exists(patch.file);

    if (patch.operation === 'CREATE') {
      if (exists) {
        violations.push({
          code: 'FILE_EXISTS',
          message: `CREATE target already exists: ${patch.file}`,
          patchId: patch.id,
          file: patch.file,
        });
      }
    } else if (patch.operation === 'MODIFY' || patch.operation === 'DELETE') {
      if (!exists) {
        violations.push({
          code: 'MISSING_FILE',
          message: `${patch.operation} target does not exist: ${patch.file}`,
          patchId: patch.id,
          file: patch.file,
        });
      } else if (patch.expectedHash && config.validateHash !== false) {
        // Hash check
        const content = await workspace.readFile(patch.file);
        const actualHash = hashText(content);
        if (actualHash !== patch.expectedHash) {
          violations.push({
            code: 'HASH_MISMATCH',
            message: `Hash mismatch for ${patch.file}: expected ${patch.expectedHash}, got ${actualHash}`,
            patchId: patch.id,
            file: patch.file,
          });
        }
      }
    }
  }

  return violations;
}

/**
 * Full validation: structural + workspace-aware.
 * Throws PatchValidationError on any violation.
 */
export async function validatePatchesFull(
  patches: readonly CodePatch[],
  workspace: Workspace,
  config: PatchValidationConfig = {},
): Promise<readonly NormalizedPatch[]> {
  const structural = validatePatchStructureBatch(patches, config);
  if (!structural.valid) {
    throw new PatchValidationError('Patch structure validation failed', structural.violations);
  }

  const workspaceViolations = await validatePatchesWorkspace(structural.normalized, workspace, config);
  if (workspaceViolations.length > 0) {
    throw new PatchValidationError('Workspace validation failed', workspaceViolations);
  }

  return structural.normalized;
}

/** Re-export for consumers that need the default config. */
export { defaultPatchValidationConfig } from './patch-model.js';