import { describe, it, expect, afterEach } from 'vitest';
import { Workspace } from '../src/workspace/workspace.js';
import {
  WorkspaceConflictError,
  WorkspaceTransactionError,
  WorkspaceValidationError,
} from '../src/errors.js';
import { cleanupTempDir, createTempDir } from './helpers.js';

const ROOTS: string[] = [];

afterEach(async () => {
  for (const root of ROOTS.splice(0)) {
    await cleanupTempDir(root);
  }
});

async function makeWorkspace(): Promise<{ root: string; ws: Workspace }> {
  const root = await createTempDir();
  ROOTS.push(root);
  return { root, ws: new Workspace({ root }) };
}

describe('WorkspaceTransaction.commit', () => {
  it('persists a write', async () => {
    const { ws } = await makeWorkspace();
    const tx = ws.beginTransaction();
    tx.write('a.txt', 'hello');
    await tx.commit();
    await expect(ws.readFile('a.txt')).resolves.toBe('hello');
  });

  it('persists a create', async () => {
    const { ws } = await makeWorkspace();
    const tx = ws.beginTransaction();
    tx.create('new.txt', 'x');
    await tx.commit();
    await expect(ws.readFile('new.txt')).resolves.toBe('x');
  });

  it('persists a delete', async () => {
    const { ws } = await makeWorkspace();
    await ws.writeFile('a.txt', 'x');
    const tx = ws.beginTransaction();
    tx.delete('a.txt');
    await tx.commit();
    await expect(ws.exists('a.txt')).resolves.toBe(false);
  });

  it('persists a rename', async () => {
    const { ws } = await makeWorkspace();
    await ws.writeFile('old.txt', 'content');
    const tx = ws.beginTransaction();
    tx.rename('old.txt', 'new.txt');
    await tx.commit();
    await expect(ws.exists('old.txt')).resolves.toBe(false);
    await expect(ws.readFile('new.txt')).resolves.toBe('content');
  });

  it('persists a move into a new directory', async () => {
    const { ws } = await makeWorkspace();
    await ws.writeFile('src.txt', 'moved');
    const tx = ws.beginTransaction();
    tx.move('src.txt', 'folder/deep/target.txt');
    await tx.commit();
    await expect(ws.readFile('folder/deep/target.txt')).resolves.toBe('moved');
  });

  it('applies multiple operations in order', async () => {
    const { ws } = await makeWorkspace();
    await ws.writeFile('keep.txt', 'keep');
    await ws.writeFile('existing.txt', 'old');
    const tx = ws.beginTransaction();
    tx.write('created-by-tx.txt', 'a');
    tx.delete('keep.txt');
    tx.rename('existing.txt', 'renamed.txt');
    const result = await tx.commit();
    expect(result.status).toBe('committed');
    expect(result.operationsApplied).toBe(3);
    await expect(ws.exists('keep.txt')).resolves.toBe(false);
    await expect(ws.readFile('created-by-tx.txt')).resolves.toBe('a');
    await expect(ws.readFile('renamed.txt')).resolves.toBe('old');
  });
});

describe('WorkspaceTransaction deferral', () => {
  it('does not mutate the filesystem before commit', async () => {
    const { ws } = await makeWorkspace();
    const tx = ws.beginTransaction();
    tx.write('deferred.txt', 'x');
    await expect(ws.exists('deferred.txt')).resolves.toBe(false);
    expect(tx.status).toBe('pending');
  });

  it('rejects operations after the transaction finished', async () => {
    const { ws } = await makeWorkspace();
    const tx = ws.beginTransaction();
    tx.write('a.txt', 'x');
    await tx.commit();
    expect(() => tx.write('b.txt', 'y')).toThrow(WorkspaceTransactionError);
    await expect(tx.commit()).rejects.toBeInstanceOf(WorkspaceTransactionError);
  });
});

describe('WorkspaceTransaction.rollback', () => {
  it('discards pending operations when rolled back before commit', async () => {
    const { ws } = await makeWorkspace();
    const tx = ws.beginTransaction();
    tx.write('a.txt', 'x');
    await tx.rollback();
    expect(tx.status).toBe('rolled-back');
    expect(tx.operations).toHaveLength(0);
    await expect(ws.exists('a.txt')).resolves.toBe(false);
  });

  it('restores an overwritten file after commit', async () => {
    const { ws } = await makeWorkspace();
    await ws.writeFile('a.txt', 'original');
    const tx = ws.beginTransaction();
    tx.write('a.txt', 'changed');
    await tx.commit();
    await expect(ws.readFile('a.txt')).resolves.toBe('changed');
    await tx.rollback();
    await expect(ws.readFile('a.txt')).resolves.toBe('original');
  });

  it('restores a deleted file after commit', async () => {
    const { ws } = await makeWorkspace();
    await ws.writeFile('a.txt', 'doomed');
    const tx = ws.beginTransaction();
    tx.delete('a.txt');
    await tx.commit();
    await expect(ws.exists('a.txt')).resolves.toBe(false);
    await tx.rollback();
    await expect(ws.readFile('a.txt')).resolves.toBe('doomed');
  });

  it('restores a renamed file after commit', async () => {
    const { ws } = await makeWorkspace();
    await ws.writeFile('a.txt', 'content');
    const tx = ws.beginTransaction();
    tx.rename('a.txt', 'b.txt');
    await tx.commit();
    await tx.rollback();
    await expect(ws.readFile('a.txt')).resolves.toBe('content');
    await expect(ws.exists('b.txt')).resolves.toBe(false);
  });

  it('restores a moved file after commit', async () => {
    const { ws } = await makeWorkspace();
    await ws.writeFile('a.txt', 'content');
    const tx = ws.beginTransaction();
    tx.move('a.txt', 'dir/b.txt');
    await tx.commit();
    await tx.rollback();
    await expect(ws.readFile('a.txt')).resolves.toBe('content');
    await expect(ws.exists('dir/b.txt')).resolves.toBe(false);
  });

  it('rollback is idempotent', async () => {
    const { ws } = await makeWorkspace();
    await ws.writeFile('a.txt', 'original');
    const tx = ws.beginTransaction();
    tx.write('a.txt', 'changed');
    await tx.commit();
    await tx.rollback();
    await tx.rollback();
    await tx.rollback();
    await expect(ws.readFile('a.txt')).resolves.toBe('original');
    expect(tx.status).toBe('rolled-back');
  });
});

describe('WorkspaceTransaction validation', () => {
  it('rejects duplicate write operations on the same path', async () => {
    const { ws } = await makeWorkspace();
    const tx = ws.beginTransaction();
    tx.write('a.txt', '1');
    tx.write('a.txt', '2');
    await expect(tx.commit()).rejects.toBeInstanceOf(WorkspaceConflictError);
  });

  it('rejects a rename whose destination is another operation target', async () => {
    const { ws } = await makeWorkspace();
    const tx = ws.beginTransaction();
    tx.write('b.txt', '1');
    tx.rename('a.txt', 'b.txt');
    await expect(tx.commit()).rejects.toBeInstanceOf(WorkspaceConflictError);
  });

  it('rejects create when the path already exists', async () => {
    const { ws } = await makeWorkspace();
    await ws.writeFile('x.txt', 'x');
    const tx = ws.beginTransaction();
    tx.create('x.txt', 'y');
    await expect(tx.commit()).rejects.toBeInstanceOf(WorkspaceConflictError);
  });

  it('rejects delete when the path is missing', async () => {
    const { ws } = await makeWorkspace();
    const tx = ws.beginTransaction();
    tx.delete('missing.txt');
    await expect(tx.commit()).rejects.toBeInstanceOf(WorkspaceConflictError);
  });

  it('rejects rename when the source is missing', async () => {
    const { ws } = await makeWorkspace();
    const tx = ws.beginTransaction();
    tx.rename('missing.txt', 'x.txt');
    await expect(tx.commit()).rejects.toBeInstanceOf(WorkspaceConflictError);
  });

  it('rejects path traversal at commit', async () => {
    const { ws } = await makeWorkspace();
    const tx = ws.beginTransaction();
    tx.write('../evil.txt', 'x');
    await expect(tx.commit()).rejects.toBeInstanceOf(WorkspaceValidationError);
  });

  it('rejects invalid UTF-8 content at commit', async () => {
    const { ws } = await makeWorkspace();
    const tx = ws.beginTransaction();
    tx.write('bad.txt', new Uint8Array([0xff, 0xfe]));
    await expect(tx.commit()).rejects.toBeInstanceOf(WorkspaceValidationError);
  });

  it('validates every operation before applying any of them', async () => {
    const { ws } = await makeWorkspace();
    const tx = ws.beginTransaction();
    tx.write('good.txt', 'ok');
    tx.write('../bad.txt', 'x');
    await expect(tx.commit()).rejects.toBeInstanceOf(WorkspaceValidationError);
    await expect(ws.exists('good.txt')).resolves.toBe(false);
  });
});

describe('WorkspaceTransaction automatic rollback', () => {
  it('rolls back automatically when commit fails mid-apply', async () => {
    const { ws } = await makeWorkspace();
    const tx = ws.beginTransaction();
    // First op succeeds; second fails because 'a' becomes a file, so 'a/b' cannot be created.
    tx.write('a', 'x');
    tx.write('a/b', 'y');
    await expect(tx.commit()).rejects.toBeInstanceOf(WorkspaceTransactionError);
    expect(tx.status).toBe('rolled-back');
    await expect(ws.exists('a')).resolves.toBe(false);
    await expect(ws.exists('a/b')).resolves.toBe(false);
  });

  it('restores pre-commit state after a failed commit', async () => {
    const { ws } = await makeWorkspace();
    await ws.writeFile('keep.txt', 'original');
    const tx = ws.beginTransaction();
    tx.delete('keep.txt');
    tx.write('doomed/a', 'y'); // fails: 'doomed' parent creation is fine but this is the second failure point
    tx.write('doomed', 'z'); // 'doomed' file conflicts with dir? both apply after delete
    await expect(tx.commit()).rejects.toBeInstanceOf(WorkspaceTransactionError);
    await expect(ws.readFile('keep.txt')).resolves.toBe('original');
  });
});
