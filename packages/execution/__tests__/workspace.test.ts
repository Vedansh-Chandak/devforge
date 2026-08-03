import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Workspace } from '../src/workspace/workspace.js';
import {
  WorkspaceConflictError,
  WorkspacePermissionError,
  WorkspaceValidationError,
} from '../src/errors.js';
import { cleanupTempDir, createTempDir, SYMLINKS_SUPPORTED } from './helpers.js';

const ROOTS: string[] = [];

afterEach(async () => {
  for (const root of ROOTS.splice(0)) {
    await cleanupTempDir(root);
  }
});

async function makeWorkspace(maxFileSize?: number): Promise<{ root: string; ws: Workspace }> {
  const root = await createTempDir();
  ROOTS.push(root);
  return { root, ws: new Workspace({ root, maxFileSize }) };
}

describe('Workspace.readFile', () => {
  it('returns the text content of an existing file', async () => {
    const { root, ws } = await makeWorkspace();
    await fs.writeFile(path.join(root, 'a.txt'), 'hello world');
    await expect(ws.readFile('a.txt')).resolves.toBe('hello world');
  });

  it('throws a conflict error when the file is missing', async () => {
    const { ws } = await makeWorkspace();
    await expect(ws.readFile('missing.txt')).rejects.toBeInstanceOf(WorkspaceConflictError);
  });

  it('throws a validation error when reading a directory', async () => {
    const { ws } = await makeWorkspace();
    await ws.writeFile('dir/file.txt', 'x');
    await expect(ws.readFile('dir')).rejects.toBeInstanceOf(WorkspaceValidationError);
  });

  it('rejects path traversal', async () => {
    const { ws } = await makeWorkspace();
    await expect(ws.readFile('../etc/passwd')).rejects.toBeInstanceOf(WorkspaceValidationError);
  });

  it('rejects absolute paths', async () => {
    const { ws } = await makeWorkspace();
    await expect(ws.readFile('/etc/passwd')).rejects.toBeInstanceOf(WorkspaceValidationError);
  });

  it('rejects files larger than the configured limit', async () => {
    const { root, ws } = await makeWorkspace(4);
    await fs.writeFile(path.join(root, 'big.txt'), 'toolong');
    await expect(ws.readFile('big.txt')).rejects.toBeInstanceOf(WorkspaceValidationError);
  });

  it('rejects files that are not valid UTF-8', async () => {
    const { root, ws } = await makeWorkspace();
    await fs.writeFile(path.join(root, 'binary.bin'), Buffer.from([0xff, 0xfe, 0x00, 0x01]));
    await expect(ws.readFile('binary.bin')).rejects.toBeInstanceOf(WorkspaceValidationError);
  });
});

describe('Workspace.writeFile / createFile', () => {
  it('creates a file with content', async () => {
    const { ws } = await makeWorkspace();
    await ws.writeFile('a.txt', 'content');
    await expect(ws.readFile('a.txt')).resolves.toBe('content');
  });

  it('overwrites an existing file', async () => {
    const { ws } = await makeWorkspace();
    await ws.writeFile('a.txt', 'one');
    await ws.writeFile('a.txt', 'two');
    await expect(ws.readFile('a.txt')).resolves.toBe('two');
  });

  it('creates nested parent directories automatically', async () => {
    const { ws } = await makeWorkspace();
    await ws.writeFile('deep/nested/dir/file.txt', 'x');
    await expect(ws.exists('deep/nested/dir/file.txt')).resolves.toBe(true);
  });

  it('rejects byte content that is not valid UTF-8', async () => {
    const { ws } = await makeWorkspace();
    await expect(ws.writeFile('bad.txt', new Uint8Array([0xff, 0xfe, 0xff]))).rejects.toBeInstanceOf(
      WorkspaceValidationError,
    );
  });

  it('rejects oversized content', async () => {
    const { ws } = await makeWorkspace(3);
    await expect(ws.writeFile('big.txt', 'toolong')).rejects.toBeInstanceOf(WorkspaceValidationError);
  });

  it('createFile writes an empty file by default', async () => {
    const { ws } = await makeWorkspace();
    await ws.createFile('empty.txt');
    await expect(ws.readFile('empty.txt')).resolves.toBe('');
  });

  it('createFile throws a conflict when the path already exists', async () => {
    const { ws } = await makeWorkspace();
    await ws.writeFile('x.txt', 'x');
    await expect(ws.createFile('x.txt')).rejects.toBeInstanceOf(WorkspaceConflictError);
  });
});

describe('Workspace.deleteFile', () => {
  it('deletes an existing file', async () => {
    const { ws } = await makeWorkspace();
    await ws.writeFile('a.txt', 'x');
    await ws.deleteFile('a.txt');
    await expect(ws.exists('a.txt')).resolves.toBe(false);
  });

  it('deletes a directory recursively', async () => {
    const { ws } = await makeWorkspace();
    await ws.writeFile('dir/a.txt', 'x');
    await ws.writeFile('dir/sub/b.txt', 'y');
    await ws.deleteFile('dir');
    await expect(ws.exists('dir')).resolves.toBe(false);
  });

  it('throws a conflict when the path is missing', async () => {
    const { ws } = await makeWorkspace();
    await expect(ws.deleteFile('missing.txt')).rejects.toBeInstanceOf(WorkspaceConflictError);
  });
});

describe('Workspace.renameFile / moveFile', () => {
  it('renames a file', async () => {
    const { ws } = await makeWorkspace();
    await ws.writeFile('old.txt', 'content');
    await ws.renameFile('old.txt', 'new.txt');
    await expect(ws.exists('old.txt')).resolves.toBe(false);
    await expect(ws.readFile('new.txt')).resolves.toBe('content');
  });

  it('throws a conflict when the source is missing', async () => {
    const { ws } = await makeWorkspace();
    await expect(ws.renameFile('missing.txt', 'new.txt')).rejects.toBeInstanceOf(WorkspaceConflictError);
  });

  it('moves a file into a new directory, creating parents', async () => {
    const { ws } = await makeWorkspace();
    await ws.writeFile('src.txt', 'moved');
    await ws.moveFile('src.txt', 'folder/sub/target.txt');
    await expect(ws.exists('src.txt')).resolves.toBe(false);
    await expect(ws.readFile('folder/sub/target.txt')).resolves.toBe('moved');
  });
});

describe('Workspace.exists / stat / list', () => {
  it('reports existence correctly', async () => {
    const { ws } = await makeWorkspace();
    await ws.writeFile('a.txt', 'x');
    await expect(ws.exists('a.txt')).resolves.toBe(true);
    await expect(ws.exists('nope.txt')).resolves.toBe(false);
  });

  it('stat returns file metadata', async () => {
    const { ws } = await makeWorkspace();
    await ws.writeFile('a.txt', 'abcd');
    const info = await ws.stat('a.txt');
    expect(info.name).toBe('a.txt');
    expect(info.size).toBe(4);
    expect(info.isFile).toBe(true);
    expect(info.isDirectory).toBe(false);
  });

  it('stat throws a conflict when the path is missing', async () => {
    const { ws } = await makeWorkspace();
    await expect(ws.stat('missing.txt')).rejects.toBeInstanceOf(WorkspaceConflictError);
  });

  it('list returns entries sorted by name', async () => {
    const { ws } = await makeWorkspace();
    await ws.writeFile('c.txt', '1');
    await ws.writeFile('a.txt', '1');
    await ws.writeFile('b.txt', '1');
    const entries = await ws.list();
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'b.txt', 'c.txt']);
  });

  it('list returns entries of a subdirectory', async () => {
    const { ws } = await makeWorkspace();
    await ws.writeFile('sub/one.txt', '1');
    await ws.writeFile('sub/two.txt', '2');
    const entries = await ws.list('sub');
    expect(entries.map((e) => e.path)).toEqual(['sub/one.txt', 'sub/two.txt']);
  });

  it('list throws a conflict when the directory is missing', async () => {
    const { ws } = await makeWorkspace();
    await expect(ws.list('nope')).rejects.toBeInstanceOf(WorkspaceConflictError);
  });
});

describe('Workspace boundary enforcement', () => {
  it('rejects a relative workspace root at construction', async () => {
    expect(() => new Workspace({ root: 'relative/path' })).toThrow(WorkspaceValidationError);
  });

  it.skipIf(!SYMLINKS_SUPPORTED)('rejects reads that escape through a symlink', async () => {
    const { root, ws } = await makeWorkspace();
    const outside = await createTempDir();
    ROOTS.push(outside);
    await fs.writeFile(path.join(outside, 'secret.txt'), 'secret');
    await fs.symlink(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
    await expect(ws.readFile('link.txt')).rejects.toBeInstanceOf(WorkspacePermissionError);
  });

  it.skipIf(!SYMLINKS_SUPPORTED)('rejects writes that escape through a symlink', async () => {
    const { root, ws } = await makeWorkspace();
    const outside = await createTempDir();
    ROOTS.push(outside);
    await fs.symlink(outside, path.join(root, 'outside'));
    await expect(ws.writeFile('outside/evil.txt', 'x')).rejects.toBeInstanceOf(WorkspacePermissionError);
  });
});
