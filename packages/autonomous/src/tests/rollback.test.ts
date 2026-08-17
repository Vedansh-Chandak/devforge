import { describe, expect, it } from 'vitest';
import { Workspace } from '@devforge/execution';
import { RollbackManager } from '../rollback.js';
import { AutonomousRollbackError } from '../errors.js';
import { fileExists, fixedClock, readFile, tempWorkspace } from './helpers.js';

function manager(root: string, enabled = true) {
  const workspace = new Workspace({ root });
  return new RollbackManager(workspace, enabled, { now: fixedClock(100, 10) });
}

describe('RollbackManager.snapshotFor', () => {
  it('captures existing file content', async () => {
    const root = tempWorkspace({ 'src/a.ts': 'alpha' });
    const rollback = manager(root);
    const token = await rollback.snapshotFor(['src/a.ts']);
    expect(token.targets).toEqual(['src/a.ts']);
    expect(rollback.pending).toBe(1);
    expect(rollback.isDirty).toBe(true);
  });

  it('captures a missing file as a non-existent target', async () => {
    const root = tempWorkspace();
    const rollback = manager(root);
    const token = await rollback.snapshotFor(['src/new.ts']);
    expect(token.targets).toEqual(['src/new.ts']);
    expect(rollback.pending).toBe(1);
  });

  it('deduplicates repeated targets', async () => {
    const root = tempWorkspace({ 'a.ts': 'x' });
    const rollback = manager(root);
    const token = await rollback.snapshotFor(['a.ts', 'a.ts']);
    expect(token.targets).toEqual(['a.ts']);
    expect(rollback.pending).toBe(1);
  });

  it('stamps a token with the clock', async () => {
    const root = tempWorkspace();
    const rollback = manager(root);
    const token = await rollback.snapshotFor(['a.ts']);
    expect(token.at).toBe(100);
  });

  it('does not snapshot when disabled', async () => {
    const root = tempWorkspace({ 'a.ts': 'x' });
    const rollback = manager(root, false);
    const token = await rollback.snapshotFor(['a.ts']);
    expect(rollback.isEnabled).toBe(false);
    expect(token.targets).toEqual([]);
    expect(rollback.pending).toBe(0);
    expect(rollback.isDirty).toBe(false);
  });
});

describe('RollbackManager.restoreToken', () => {
  it('restores an overwritten file', async () => {
    const root = tempWorkspace({ 'src/a.ts': 'original' });
    const workspace = new Workspace({ root });
    const rollback = new RollbackManager(workspace, true, { now: fixedClock() });
    const token = await rollback.snapshotFor(['src/a.ts']);
    await workspace.writeFile('src/a.ts', 'changed');
    await rollback.restoreToken(token.token);
    expect(readFile(root, 'src/a.ts')).toBe('original');
    expect(rollback.rollbackCount).toBe(1);
    expect(rollback.pending).toBe(0);
  });

  it('removes a created file that did not exist before', async () => {
    const root = tempWorkspace();
    const workspace = new Workspace({ root });
    const rollback = new RollbackManager(workspace, true, { now: fixedClock() });
    const token = await rollback.snapshotFor(['created.ts']);
    await workspace.createFile('created.ts', 'new');
    await rollback.restoreToken(token.token);
    expect(fileExists(root, 'created.ts')).toBe(false);
  });

  it('restores a deleted file', async () => {
    const root = tempWorkspace({ 'keep.ts': 'content' });
    const workspace = new Workspace({ root });
    const rollback = new RollbackManager(workspace, true, { now: fixedClock() });
    const token = await rollback.snapshotFor(['keep.ts']);
    await workspace.deleteFile('keep.ts');
    await rollback.restoreToken(token.token);
    expect(readFile(root, 'keep.ts')).toBe('content');
  });

  it('returns zero when no snapshots match the token', async () => {
    const root = tempWorkspace();
    const rollback = manager(root);
    expect(await rollback.restoreToken('unknown-token')).toBe(0);
  });

  it('is a no-op when disabled', async () => {
    const root = tempWorkspace({ 'a.ts': 'x' });
    const workspace = new Workspace({ root });
    const rollback = new RollbackManager(workspace, false, { now: fixedClock() });
    const token = await rollback.snapshotFor(['a.ts']);
    await workspace.writeFile('a.ts', 'changed');
    await expect(rollback.restoreToken(token.token)).resolves.toBe(0);
  });
});

describe('RollbackManager.restoreAll', () => {
  it('restores every pending snapshot and empties the ledger', async () => {
    const root = tempWorkspace({ 'a.ts': 'a', 'b.ts': 'b' });
    const workspace = new Workspace({ root });
    const rollback = new RollbackManager(workspace, true, { now: fixedClock() });
    await rollback.snapshotFor(['a.ts', 'b.ts']);
    await workspace.writeFile('a.ts', 'A2');
    await workspace.writeFile('b.ts', 'B2');
    const restored = await rollback.restoreAll();
    expect(restored).toBe(2);
    expect(readFile(root, 'a.ts')).toBe('a');
    expect(readFile(root, 'b.ts')).toBe('b');
    expect(rollback.pending).toBe(0);
    expect(rollback.isDirty).toBe(false);
  });

  it('returns zero when nothing is pending', async () => {
    const root = tempWorkspace();
    const rollback = manager(root);
    expect(await rollback.restoreAll()).toBe(0);
  });
});

describe('RollbackManager.clear', () => {
  it('drops snapshots without restoring', async () => {
    const root = tempWorkspace({ 'a.ts': 'x' });
    const rollback = manager(root);
    await rollback.snapshotFor(['a.ts']);
    rollback.clear();
    expect(rollback.pending).toBe(0);
    expect(rollback.isDirty).toBe(false);
    expect(rollback.rollbackCount).toBe(0);
  });
});

describe('RollbackManager restore failure', () => {
  it('wraps restore failures in AutonomousRollbackError', async () => {
    const root = tempWorkspace({ 'a.ts': 'x' });
    const workspace = new Workspace({ root });
    const rollback = new RollbackManager(workspace, true, {
      now: fixedClock(),
      restore: async () => {
        throw new Error('disk full');
      },
    });
    const token = await rollback.snapshotFor(['a.ts']);
    await expect(rollback.restoreToken(token.token)).rejects.toBeInstanceOf(
      AutonomousRollbackError,
    );
  });

  it('reports the underlying cause', async () => {
    const root = tempWorkspace({ 'a.ts': 'x' });
    const workspace = new Workspace({ root });
    const rollback = new RollbackManager(workspace, true, {
      now: fixedClock(),
      restore: async () => {
        throw new Error('boom');
      },
    });
    const token = await rollback.snapshotFor(['a.ts']);
    try {
      await rollback.restoreToken(token.token);
      expect.unreachable();
    } catch (error) {
      expect((error as AutonomousRollbackError).cause).toBeInstanceOf(Error);
    }
  });
});

describe('RollbackManager tokens', () => {
  it('issues incrementing, unique tokens', async () => {
    const root = tempWorkspace({ 'a.ts': 'x' });
    const rollback = manager(root);
    const first = await rollback.snapshotFor(['a.ts']);
    const second = await rollback.snapshotFor(['a.ts']);
    expect(first.token).not.toBe(second.token);
  });

  it('restores only the snapshots of the requested token', async () => {
    const root = tempWorkspace({ 'a.ts': 'a', 'b.ts': 'b' });
    const workspace = new Workspace({ root });
    const rollback = new RollbackManager(workspace, true, { now: fixedClock() });
    const first = await rollback.snapshotFor(['a.ts']);
    await rollback.snapshotFor(['b.ts']);
    await workspace.writeFile('a.ts', 'A2');
    await workspace.writeFile('b.ts', 'B2');
    await rollback.restoreToken(first.token);
    expect(readFile(root, 'a.ts')).toBe('a');
    expect(readFile(root, 'b.ts')).toBe('B2');
  });
});