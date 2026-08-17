/**
 * @devforge/execution — Shared patch model for autonomous coding (DF-016B).
 *
 * Defines the core data types for code patches, operations, budgets, and hashing.
 * All types are pure, deterministic, and serialization-friendly.
 */

import * as crypto from 'node:crypto';

/** Category of a diagnostic signal. */
export type DiagnosticCategory =
  | 'COMPILER'
  | 'TEST'
  | 'LINT'
  | 'COMMAND'
  | 'VERIFICATION';

/** Allowed patch operations. */
export type CodePatchOperation = 'CREATE' | 'MODIFY' | 'DELETE';

/** A single code patch targeting one file. */
export interface CodePatch {
  /** Unique identifier within a generation batch. */
  readonly id: string;
  /** Workspace-relative POSIX path (never absolute, never contains '..'). */
  readonly file: string;
  /** Operation to perform. */
  readonly operation: CodePatchOperation;
  /**
   * Expected hash of the file content before the patch (for MODIFY/DELETE).
   * If provided, must match the current file content hash or validation fails.
   */
  readonly expectedHash?: string;
  /**
   * New file content for CREATE and MODIFY operations.
   * Must be non-empty for CREATE and MODIFY.
   */
  readonly newContent?: string;
}

/** Deterministic hash of file content using FNV-1a 32-bit (hex). */
export function hashText(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** Deterministic SHA-256 hex hash (for stronger content addressing). */
export function hashTextSHA256(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Budgets governing the autonomous coding repair loop. */
export const CODING_BUDGETS = {
  /** Maximum repair loop iterations after initial verification failure. */
  maxRepairAttempts: 3,
  /** Maximum PatchEngine.generate() calls across initial + all repairs. */
  maxPatchGenerations: 5,
  /** Maximum verification runs (initial + repair verifications). */
  maxVerificationRuns: 5,
  /** Maximum bytes in a single patch's newContent. */
  maxPatchBytes: 256 * 1024,
  /** Maximum total bytes across all patches in a single generation. */
  maxTotalPatchBytes: 1024 * 1024,
} as const;

/** Budget configuration type (number-based so values can be overridden). */
export interface CodingBudgets {
  readonly maxRepairAttempts: number;
  readonly maxPatchGenerations: number;
  readonly maxVerificationRuns: number;
  readonly maxPatchBytes: number;
  readonly maxTotalPatchBytes: number;
}

/** Configuration for patch validation (pure structural + workspace-aware). */
export interface PatchValidationConfig {
  /** Maximum bytes in newContent for CREATE/MODIFY. */
  readonly maxPatchBytes?: number;
  /** Maximum total bytes across all patches in a batch. */
  readonly maxTotalPatchBytes?: number;
  /** Whether to validate file existence (requires workspace). */
  readonly validateExistence?: boolean;
  /** Whether to validate expectedHash (requires workspace read). */
  readonly validateHash?: boolean;
}

/** Result of structural (pure) patch validation. */
export interface PatchStructureValidationResult {
  readonly valid: boolean;
  /** Violations found; empty when valid. */
  readonly violations: readonly PatchViolation[];
  /** Patches normalized (ids trimmed, file normalized). */
  readonly normalized: readonly NormalizedPatch[];
}

/** A patch with normalized file path (POSIX, no '..', no leading '/'). */
export interface NormalizedPatch extends CodePatch {
  /** The normalized file path. */
  readonly file: string;
}

/** A single validation violation. */
export interface PatchViolation {
  /** Machine-readable violation code. */
  readonly code:
    | 'DUPLICATE_ID'
    | 'INVALID_OPERATION'
    | 'INVALID_FILE_PATH'
    | 'ABSOLUTE_PATH'
    | 'TRAVERSAL'
    | 'EMPTY_FILE_PATH'
    | 'DUPLICATE_TARGET'
    | 'MISSING_FILE'
    | 'FILE_EXISTS'
    | 'HASH_MISMATCH'
    | 'EMPTY_CONTENT'
    | 'OVERSIZED_PATCH'
    | 'OVERSIZED_BATCH';
  /** Human-readable description. */
  readonly message: string;
  /** The patch id involved (when applicable). */
  readonly patchId?: string;
  /** The target file involved (when applicable). */
  readonly file?: string;
}

/** Default validation config derived from budgets. */
export function defaultPatchValidationConfig(
  budgets: Partial<CodingBudgets> = {},
): Required<PatchValidationConfig> {
  const merged: Required<CodingBudgets> = {
    ...CODING_BUDGETS,
    ...budgets,
  };
  return {
    maxPatchBytes: merged.maxPatchBytes,
    maxTotalPatchBytes: merged.maxTotalPatchBytes,
    validateExistence: false,
    validateHash: false,
  };
}