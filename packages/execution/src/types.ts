/**
 * @devforge/execution — Shared types for the Workspace subsystem.
 */

/**
 * A workspace-relative path. Always POSIX-style with `/` separators,
 * never absolute, and never containing `..`.
 */
export type WorkspacePath = string;

/** File content. Either text or a byte buffer (validated on write). */
export type FileContent = string | Uint8Array;

/** Metadata about a single entry in the workspace. */
export interface FileInfo {
  /** Workspace-relative POSIX path. */
  readonly path: WorkspacePath;
  /** Entry name (last path segment). */
  readonly name: string;
  /** Size in bytes. */
  readonly size: number;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
  readonly createdAtMs: number;
  readonly modifiedAtMs: number;
}

/** Options accepted by the {@link Workspace} constructor. */
export interface WorkspaceOptions {
  /** Absolute path to the workspace root directory. */
  readonly root: string;
  /**
   * Maximum accepted file size in bytes for reads and writes.
   * @defaultValue `DEFAULT_MAX_FILE_SIZE`
   */
  readonly maxFileSize?: number;
}

/** Default maximum file size (8 MiB). */
export const DEFAULT_MAX_FILE_SIZE = 8 * 1024 * 1024;

/** Lifecycle state of a {@link WorkspaceTransaction}. */
export type TransactionStatus =
  | 'pending'
  | 'committed'
  | 'rolled-back';

/**
 * A single recorded (not yet applied) transaction operation.
 * Operations are only applied inside {@link WorkspaceTransaction.commit}.
 */
export type TransactionOperation =
  | { readonly type: 'write'; readonly path: WorkspacePath; readonly content: FileContent }
  | { readonly type: 'create'; readonly path: WorkspacePath; readonly content: FileContent }
  | { readonly type: 'delete'; readonly path: WorkspacePath }
  | { readonly type: 'rename'; readonly from: WorkspacePath; readonly to: WorkspacePath }
  | { readonly type: 'move'; readonly from: WorkspacePath; readonly to: WorkspacePath };

/** An operation that was actually applied to the filesystem. */
export type AppliedOperation =
  | { readonly type: 'write'; readonly path: WorkspacePath }
  | { readonly type: 'create'; readonly path: WorkspacePath }
  | { readonly type: 'delete'; readonly path: WorkspacePath }
  | { readonly type: 'rename'; readonly from: WorkspacePath; readonly to: WorkspacePath }
  | { readonly type: 'move'; readonly from: WorkspacePath; readonly to: WorkspacePath };

/** Result returned by a successful transaction commit. */
export interface TransactionResult {
  readonly status: 'committed';
  /** Number of operations applied. */
  readonly operationsApplied: number;
  /** The operations, in application order. */
  readonly applied: readonly AppliedOperation[];
}

/** Outcome of a deterministic path validation. */
export type PathValidation =
  | {
      readonly ok: true;
      /** Normalized workspace-relative POSIX path. */
      readonly normalizedPath: WorkspacePath;
      /** Absolute path resolved inside the workspace root. */
      readonly absolutePath: string;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly reason: string;
    };

/** Outcome of a deterministic content validation. */
export type ContentValidation =
  | {
      readonly ok: true;
      /** The canonical UTF-8 text form of the content. */
      readonly text: string;
      /** Size in bytes of the UTF-8 encoding. */
      readonly byteLength: number;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly reason: string;
    };
