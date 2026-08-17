/**
 * @devforge/execution — Workspace subsystem exports.
 */

export { Workspace } from './workspace.js';
export { WorkspaceTransaction } from './transaction.js';
export { BackupStore, createSnapshot, restoreSnapshot } from './backup.js';
export type { BackupSnapshot, BackupEntry } from './backup.js';
export {
  validatePath,
  validateContent,
  validateSymlinkEscape,
  validateWorkspaceRoot,
  PATH_VALIDATION_CODES,
  CONTENT_VALIDATION_CODES,
} from './validator.js';
export type { SymlinkEscapeResult } from './validator.js';
export { generateTextDiff, renderDiff, MAX_DIFF_CELLS } from './diff.js';
export type { TextDiff, DiffHunk, DiffLine, DiffLineKind } from './diff.js';
export { normalizeSeparators, splitSegments, joinRel, resolveInside, isInside } from './paths.js';
