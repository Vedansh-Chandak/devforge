/**
 * @devforge/execution — Workspace transactions.
 *
 * A transaction records operations without touching the filesystem.
 * `commit` performs deterministic validation of every recorded operation,
 * then applies them, snapshotting each affected path to an in-memory backup
 * before any destructive change. If any apply step fails, the transaction
 * rolls back automatically and throws {@link WorkspaceTransactionError}.
 *
 * `rollback` is idempotent: after the first rollback, further calls are no-ops.
 */
import type { FileContent, TransactionOperation, TransactionResult, TransactionStatus } from '../types.js';
import {
  WorkspaceConflictError,
  WorkspacePermissionError,
  WorkspaceTransactionError,
  WorkspaceValidationError,
} from '../errors.js';
import { BackupStore, createSnapshot } from './backup.js';
import { validateContent, validatePath, validateSymlinkEscape } from './validator.js';
import type { Workspace } from './workspace.js';

const { TRAVERSAL, INVALID_PATH, ALREADY_EXISTS, NOT_FOUND, DUPLICATE_OPERATION, OVERSIZED, INVALID_UTF8, SYMLINK_ESCAPE } =
  {
    TRAVERSAL: 'TRAVERSAL',
    INVALID_PATH: 'INVALID_PATH',
    ALREADY_EXISTS: 'ALREADY_EXISTS',
    NOT_FOUND: 'NOT_FOUND',
    DUPLICATE_OPERATION: 'DUPLICATE_OPERATION',
    OVERSIZED: 'OVERSIZED',
    INVALID_UTF8: 'INVALID_UTF8',
    SYMLINK_ESCAPE: 'SYMLINK_ESCAPE',
  } as const;

export class WorkspaceTransaction {
  readonly workspace: Workspace;

  private readonly operations_: TransactionOperation[] = [];
  private status_: TransactionStatus = 'pending';
  private readonly backups_ = new BackupStore();
  private result_: TransactionResult | null = null;

  constructor(workspace: Workspace) {
    this.workspace = workspace;
  }

  /** Current lifecycle status. */
  get status(): TransactionStatus {
    return this.status_;
  }

  get isPending(): boolean {
    return this.status_ === 'pending';
  }

  /** Recorded (not yet applied) operations, in order. */
  get operations(): readonly TransactionOperation[] {
    return this.operations_;
  }

  /** Result of a successful commit. */
  get result(): TransactionResult | null {
    return this.result_;
  }

  /** Record an overwrite-or-create write. */
  write(path: string, content: FileContent): this {
    this.assertPending();
    this.operations_.push({ type: 'write', path, content });
    return this;
  }

  /** Record a create (fails at commit when the path already exists). */
  create(path: string, content: FileContent = ''): this {
    this.assertPending();
    this.operations_.push({ type: 'create', path, content });
    return this;
  }

  /** Record a delete. */
  delete(path: string): this {
    this.assertPending();
    this.operations_.push({ type: 'delete', path });
    return this;
  }

  /** Record a rename within the workspace. */
  rename(from: string, to: string): this {
    this.assertPending();
    this.operations_.push({ type: 'rename', from, to });
    return this;
  }

  /** Record a move within the workspace (destination parents are created). */
  move(from: string, to: string): this {
    this.assertPending();
    this.operations_.push({ type: 'move', from, to });
    return this;
  }

  /**
   * Validate and apply every recorded operation.
   *
   * Deterministic validation (paths, content, duplicates, existence) runs
   * before any mutation. If any apply step fails afterwards, automatic
   * rollback restores the workspace and the error is rethrown wrapped in a
   * {@link WorkspaceTransactionError}.
   */
  async commit(): Promise<TransactionResult> {
    this.assertPending();
    await this.validateOperations();

    try {
      for (const op of this.operations_) {
        await this.applyWithBackup(op);
      }
    } catch (err) {
      await this.backups_.restoreAll(this.workspace.root);
      this.status_ = 'rolled-back';
      throw new WorkspaceTransactionError(
        'Transaction commit failed; all changes were automatically rolled back',
        { code: 'COMMIT_FAILED', cause: err },
      );
    }

    const applied = this.operations_.map(toApplied);
    this.status_ = 'committed';
    this.result_ = { status: 'committed', operationsApplied: applied.length, applied };
    return this.result_;
  }

  /**
   * Discard pending operations, or — after a commit — restore every
   * backup so the workspace returns to its pre-commit state.
   * Idempotent: calling twice (or after an automatic rollback) is a no-op.
   */
  async rollback(): Promise<void> {
    if (this.status_ === 'rolled-back') return;

    if (this.status_ === 'pending') {
      this.operations_.length = 0;
      this.backups_.clear();
      this.status_ = 'rolled-back';
      return;
    }

    // Committed: restore from backups.
    await this.backups_.restoreAll(this.workspace.root);
    this.status_ = 'rolled-back';
    this.result_ = null;
  }

  private assertPending(): void {
    if (this.status_ !== 'pending') {
      throw new WorkspaceTransactionError('Transaction is already finished', { code: 'TRANSACTION_FINISHED' });
    }
  }

  /**
   * Deterministically validate all operations in recorded order.
   * The first failure wins, so results are reproducible for a given input.
   */
  private async validateOperations(): Promise<void> {
    const touched = new Set<string>();

    for (const op of this.operations_) {
      const paths = touchedPaths(op);
      const abs: Array<{ rel: string; absolute: string }> = [];

      for (const rel of paths) {
        const v = validatePath(rel, this.workspace.root);
        if (!v.ok) {
          const code = v.code === 'TRAVERSAL' || v.code === 'ESCAPES_ROOT' ? TRAVERSAL : INVALID_PATH;
          throw new WorkspaceValidationError(v.reason, { code, path: rel });
        }
        if (touched.has(v.normalizedPath)) {
          throw new WorkspaceConflictError('Operation conflicts with an earlier operation on the same path', {
            code: DUPLICATE_OPERATION,
            path: v.normalizedPath,
          });
        }
        touched.add(v.normalizedPath);
        abs.push({ rel: v.normalizedPath, absolute: v.absolutePath });
      }

      if (op.type === 'write' || op.type === 'create') {
        const content = validateContent(op.content, this.workspace.maxFileSize);
        if (!content.ok) {
          const code = content.code === 'OVERSIZED' ? OVERSIZED : INVALID_UTF8;
          throw new WorkspaceValidationError(content.reason, { code });
        }
      }

      for (const { rel, absolute } of abs) {
        const escape = await validateSymlinkEscape(this.workspace.root, absolute);
        if (!escape.ok) {
          throw new WorkspacePermissionError(escape.reason, { code: SYMLINK_ESCAPE, path: rel });
        }
      }

      await this.validateExistence(op);
    }
  }

  /** Validate target existence against the live filesystem. */
  private async validateExistence(op: TransactionOperation): Promise<void> {
    const ws = this.workspace;
    switch (op.type) {
      case 'create': {
        if (await ws.exists(op.path)) {
          throw new WorkspaceConflictError('Path already exists', { code: ALREADY_EXISTS, path: op.path });
        }
        break;
      }
      case 'delete': {
        if (!(await ws.exists(op.path))) {
          throw new WorkspaceConflictError('Path not found', { code: NOT_FOUND, path: op.path });
        }
        break;
      }
      case 'rename':
      case 'move': {
        if (!(await ws.exists(op.from))) {
          throw new WorkspaceConflictError('Source path not found', { code: NOT_FOUND, path: op.from });
        }
        break;
      }
      case 'write':
        break;
    }
  }

  /** Snapshot a path before mutation, then apply the operation. */
  private async applyWithBackup(op: TransactionOperation): Promise<void> {
    switch (op.type) {
      case 'write':
        this.backups_.add(await createSnapshot(this.workspace.root, op.path));
        await this.workspace._applyWrite(op.path, op.content);
        break;
      case 'create':
        this.backups_.add(await createSnapshot(this.workspace.root, op.path));
        await this.workspace._applyCreate(op.path, op.content);
        break;
      case 'delete':
        this.backups_.add(await createSnapshot(this.workspace.root, op.path));
        await this.workspace._applyDelete(op.path);
        break;
      case 'rename':
        this.backups_.add(await createSnapshot(this.workspace.root, op.from));
        this.backups_.add(await createSnapshot(this.workspace.root, op.to));
        await this.workspace._applyRename(op.from, op.to);
        break;
      case 'move':
        this.backups_.add(await createSnapshot(this.workspace.root, op.from));
        this.backups_.add(await createSnapshot(this.workspace.root, op.to));
        await this.workspace._applyMove(op.from, op.to);
        break;
    }
  }
}

function touchedPaths(op: TransactionOperation): string[] {
  switch (op.type) {
    case 'write':
    case 'create':
    case 'delete':
      return [op.path];
    case 'rename':
    case 'move':
      return [op.from, op.to];
  }
}

function toApplied(op: TransactionOperation): TransactionResult['applied'][number] {
  switch (op.type) {
    case 'write':
      return { type: 'write', path: op.path };
    case 'create':
      return { type: 'create', path: op.path };
    case 'delete':
      return { type: 'delete', path: op.path };
    case 'rename':
      return { type: 'rename', from: op.from, to: op.to };
    case 'move':
      return { type: 'move', from: op.from, to: op.to };
  }
}
