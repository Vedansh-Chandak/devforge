/**
 * @devforge/autonomous — Rollback manager (DF-019).
 *
 * Snapshots every file a patch set touches before it is applied. On verification
 * failure, budget exhaustion, or catastrophic failure the previous workspace
 * state is restored. Restores are purely deterministic and reversed.
 */

import { createSnapshot, restoreSnapshot, type BackupSnapshot, type Workspace } from '@devforge/execution';
import { AutonomousRollbackError } from './errors.js';

/** Restore function signature (injectable for testing error surfaces). */
export type RestoreFn = (root: string, snapshot: BackupSnapshot) => Promise<void>;

/** A snapshot ledger entry grouped by the token that created it. */
interface LedgerEntry {
  readonly token: string;
  readonly snapshot: BackupSnapshot;
}

/** Handle returned by {@link RollbackManager.snapshotFor}. */
export interface RollbackToken {
  readonly token: string;
  /** Timestamp via the configured clock. */
  readonly at: number;
  readonly targets: readonly string[];
}

/** Injectable restore for deterministic failure testing. */
export interface RollbackHooks {
  readonly restore?: RestoreFn;
  readonly now?: () => number;
}

/**
 * Records snapshots per token and reverses them. Disabled by default fencing
 * never mutates the workspace. Cleanup is idempotent.
 */
export class RollbackManager {
  private readonly workspace: Workspace;
  private readonly enabled: boolean;
  private readonly restoreFn: RestoreFn;
  private readonly now: () => number;
  private readonly ledger: LedgerEntry[] = [];
  private counter = 0;
  private appliedCount = 0;

  constructor(workspace: Workspace, enabled = true, hooks: RollbackHooks = {}) {
    this.workspace = workspace;
    this.enabled = enabled;
    this.restoreFn = hooks.restore ?? restoreSnapshot;
    this.now = hooks.now ?? (() => Date.now());
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Snapshots taken that have not yet been restored. */
  get pending(): number {
    return this.ledger.length;
  }

  /** Restore operations performed in total. */
  get rollbackCount(): number {
    return this.appliedCount;
  }

  get isDirty(): boolean {
    return this.ledger.length > 0;
  }

  /** Snapshot every file a patch touches. Returns an opaque handle. */
  async snapshotFor(files: readonly string[]): Promise<RollbackToken> {
    if (!this.enabled) {
      const dry = `noop:${this.counter++}`;
      return { token: dry, at: this.now(), targets: [] };
    }
    const token = `rollback-${this.counter++}`;
    const unique = Array.from(new Set(files)).sort();
    for (const file of unique) {
      const snapshot = await createSnapshot(this.workspace.root, file);
      this.ledger.push({ token, snapshot });
    }
    return { token, at: this.now(), targets: unique };
  }

  /** Restore snapshots created for a specific handle. */
  async restoreToken(token: string): Promise<number> {
    if (!this.enabled) return 0;
    const targeted = this.ledger.filter((entry) => entry.token === token);
    if (targeted.length === 0) return 0;
    return this.restoreLedger(targeted);
  }

  /** Restore every pending snapshot (oldest first reversed). */
  async restoreAll(): Promise<number> {
    if (!this.enabled) return 0;
    if (this.ledger.length === 0) return 0;
    const all = [...this.ledger];
    return this.restoreLedger(all);
  }

  private async restoreLedger(entries: readonly LedgerEntry[]): Promise<number> {
    const toRestore = entries.slice().reverse();
    for (const entry of toRestore) {
      try {
        await this.restoreFn(this.workspace.root, entry.snapshot);
        this.appliedCount += 1;
      } catch (error) {
        throw new AutonomousRollbackError(
          `Failed to restore previous workspace state: ${String(error)}`,
          { cause: error },
        );
      }
    }
    for (const entry of entries) {
      this.removeByToken(entry.token);
    }
    return toRestore.length;
  }

  private removeByToken(token: string): void {
    for (let i = this.ledger.length - 1; i >= 0; i--) {
      const entry = this.ledger[i];
      if (entry?.token === token) this.ledger.splice(i, 1);
    }
  }

  /** Drop all pending snapshots without restoring (final, e.g. on success). */
  clear(): void {
    this.ledger.length = 0;
  }
}