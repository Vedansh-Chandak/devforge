/**
 * @devforge/execution — In-memory backup records for the Workspace subsystem.
 *
 * Before any destructive operation (delete, rename, move, overwrite) a
 * snapshot of the target tree is recorded. If a transaction commit fails,
 * every snapshot is restored so the workspace returns to its pre-commit state.
 *
 * Backups are purely in-memory; there is no persistence yet (later phase).
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { WorkspacePath } from '../types.js';
import { resolveInside } from './paths.js';

export interface BackupEntry {
  /** Path relative to the snapshot target ('' for the target itself). */
  readonly relativePath: string;
  readonly kind: 'file' | 'directory';
  /** Text content for file entries. */
  readonly content: string | null;
}

/** A recursive snapshot of a single workspace path. */
export interface BackupSnapshot {
  /** Workspace-relative path that was snapshotted. */
  readonly target: WorkspacePath;
  /** Whether the target existed when the snapshot was taken. */
  readonly existed: boolean;
  /** Sorted entries (files and directories) beneath the target. */
  readonly entries: readonly BackupEntry[];
}

/**
 * Create a recursive snapshot of `absoluteTarget` (a path inside `root`).
 * When the target does not exist, `existed` is `false` and `entries` is empty.
 */
export async function createSnapshot(root: string, target: WorkspacePath): Promise<BackupSnapshot> {
  const absoluteTarget = resolveInside(root, target);

  let stat;
  try {
    stat = await fs.stat(absoluteTarget);
  } catch {
    return { target, existed: false, entries: [] };
  }

  if (!stat.isDirectory()) {
    return {
      target,
      existed: true,
      entries: [{ relativePath: '', kind: 'file', content: await fs.readFile(absoluteTarget, 'utf-8') }],
    };
  }

  const entries: BackupEntry[] = [];
  const walk = async (dirAbsolute: string, relative: string): Promise<void> => {
    const names = (await fs.readdir(dirAbsolute)).sort();
    for (const name of names) {
      const childAbsolute = path.join(dirAbsolute, name);
      const childRelative = relative === '' ? name : `${relative}/${name}`;
      const childStat = await fs.stat(childAbsolute);
      if (childStat.isDirectory()) {
        entries.push({ relativePath: childRelative, kind: 'directory', content: null });
        await walk(childAbsolute, childRelative);
      } else if (childStat.isFile()) {
        entries.push({
          relativePath: childRelative,
          kind: 'file',
          content: await fs.readFile(childAbsolute, 'utf-8'),
        });
      }
    }
  };
  await walk(absoluteTarget, '');

  entries.sort((a, b) => (a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0));
  return { target, existed: true, entries };
}

/**
 * Remove a path only when it exists. Treats ENOENT/ENOTDIR (missing path,
 * or a parent that is itself a file) as "nothing to remove".
 */
async function safeRemove(absolutePath: string): Promise<void> {
  try {
    await fs.lstat(absolutePath);
  } catch {
    return;
  }
  await fs.rm(absolutePath, { recursive: true, force: true });
}

/**
 * Restore a snapshot: remove whatever currently exists at the target and
 * recreate the recorded tree. Missing targets are removed (they did not exist).
 */
export async function restoreSnapshot(root: string, snapshot: BackupSnapshot): Promise<void> {
  const absoluteTarget = resolveInside(root, snapshot.target);
  await safeRemove(absoluteTarget);

  if (!snapshot.existed) return;

  for (const entry of snapshot.entries) {
    const relative = entry.relativePath === '' ? snapshot.target : `${snapshot.target}/${entry.relativePath}`;
    const absolute = resolveInside(root, relative);
    if (entry.kind === 'directory') {
      await fs.mkdir(absolute, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, entry.content ?? '', 'utf-8');
    }
  }
}

/**
 * In-memory store of snapshots, in creation order.
 * Restores in reverse order so later snapshots undo first.
 */
export class BackupStore {
  private readonly snapshots: BackupSnapshot[] = [];

  get size(): number {
    return this.snapshots.length;
  }

  get isEmpty(): boolean {
    return this.snapshots.length === 0;
  }

  /** Append a snapshot. A later snapshot with the same target supersedes earlier ones. */
  add(snapshot: BackupSnapshot): void {
    this.snapshots.push(snapshot);
  }

  /**
   * Restore every snapshot in reverse creation order, then clear the store.
   * Idempotent: after a successful call the store is empty.
   */
  async restoreAll(root: string): Promise<void> {
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      const snapshot = this.snapshots[i];
      if (snapshot !== undefined) {
        await restoreSnapshot(root, snapshot);
      }
    }
    this.snapshots.length = 0;
  }

  /** Drop all snapshots without restoring. */
  clear(): void {
    this.snapshots.length = 0;
  }
}
