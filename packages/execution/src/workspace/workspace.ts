/**
 * @devforge/execution — The Workspace subsystem.
 *
 * A `Workspace` is a sandboxed view over a single root directory. Every
 * operation resolves a user-supplied relative path deterministically and
 * refuses anything that could escape the root (traversal, absolute paths,
 * symlinks).
 *
 * All mutations go through this class or through transactions it spawns.
 * Direct methods apply immediately; `beginTransaction` defers all mutation
 * until `commit`.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  DEFAULT_MAX_FILE_SIZE,
  type FileContent,
  type FileInfo,
  type WorkspaceOptions,
} from '../types.js';
import {
  WorkspaceConflictError,
  WorkspaceError,
  WorkspacePermissionError,
  WorkspaceValidationError,
} from '../errors.js';
import { validateContent, validatePath, validateSymlinkEscape, validateWorkspaceRoot } from './validator.js';
import { WorkspaceTransaction } from './transaction.js';

/** @internal Machine codes used by the workspace surface. */
const { INVALID_PATH, TRAVERSAL, NOT_FOUND, ALREADY_EXISTS, OVERSIZED, INVALID_UTF8, SYMLINK_ESCAPE } = {
  INVALID_PATH: 'INVALID_PATH',
  TRAVERSAL: 'TRAVERSAL',
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  OVERSIZED: 'OVERSIZED',
  INVALID_UTF8: 'INVALID_UTF8',
  SYMLINK_ESCAPE: 'SYMLINK_ESCAPE',
} as const;

export class Workspace {
  /** Absolute path of the workspace root. */
  readonly root: string;

  /** Maximum accepted file size in bytes. */
  readonly maxFileSize: number;

  constructor(options: WorkspaceOptions) {
    const check = validateWorkspaceRoot(options.root);
    if (!check.ok) {
      throw new WorkspaceValidationError(check.reason ?? 'Invalid workspace root');
    }
    this.root = options.root;
    this.maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  }

  // ── Validation helpers ──────────────────────────────────────────────

  /** Validate a workspace-relative path and return its normalized + absolute form. */
  private validate(relativePath: string): { readonly normalizedPath: string; readonly absolutePath: string } {
    const result = validatePath(relativePath, this.root);
    if (!result.ok) {
      const code = result.code === 'TRAVERSAL' || result.code === 'ESCAPES_ROOT' ? TRAVERSAL : INVALID_PATH;
      throw new WorkspaceValidationError(result.reason, { code, path: relativePath });
    }
    return { normalizedPath: result.normalizedPath, absolutePath: result.absolutePath };
  }

  /** Validate content and return its canonical text form. */
  private validateContent(content: FileContent): string {
    const result = validateContent(content, this.maxFileSize);
    if (!result.ok) {
      const code = result.code === 'OVERSIZED' ? OVERSIZED : INVALID_UTF8;
      throw new WorkspaceValidationError(result.reason, { code });
    }
    return result.text;
  }

  /** Reject paths that escape the canonical root through a symlink. */
  private async assertNoSymlinkEscape(absolutePath: string, relativePath: string): Promise<void> {
    const result = await validateSymlinkEscape(this.root, absolutePath);
    if (!result.ok) {
      throw new WorkspacePermissionError(result.reason, { code: SYMLINK_ESCAPE, path: relativePath });
    }
  }

  // ── Reads ───────────────────────────────────────────────────────────

  /** Read a file as UTF-8 text. */
  async readFile(relativePath: string): Promise<string> {
    const { normalizedPath, absolutePath } = this.validate(relativePath);
    await this.assertNoSymlinkEscape(absolutePath, normalizedPath);

    let info;
    try {
      info = await fs.stat(absolutePath);
    } catch (err) {
      if (isErrno(err, 'ENOENT')) {
        throw new WorkspaceConflictError('File not found', { code: NOT_FOUND, path: normalizedPath });
      }
      throw new WorkspaceError(`Failed to stat file: ${String(err)}`, { path: normalizedPath });
    }

    if (info.isDirectory()) {
      throw new WorkspaceValidationError('Path is a directory, not a file', { path: normalizedPath });
    }
    if (info.size > this.maxFileSize) {
      throw new WorkspaceValidationError(
        `File size (${info.size} bytes) exceeds limit (${this.maxFileSize} bytes)`,
        { code: OVERSIZED, path: normalizedPath },
      );
    }

    const buffer = await fs.readFile(absolutePath);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      throw new WorkspaceValidationError('File is not valid UTF-8 text', {
        code: INVALID_UTF8,
        path: normalizedPath,
      });
    }
    return text;
  }

  // ── Mutations (immediate) ───────────────────────────────────────────

  /** Write (or overwrite) a file, creating parent directories as needed. */
  async writeFile(relativePath: string, content: FileContent): Promise<void> {
    const { normalizedPath, absolutePath } = this.validate(relativePath);
    const text = this.validateContent(content);
    await this.assertNoSymlinkEscape(absolutePath, normalizedPath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, text, 'utf-8');
  }

  /** Create a new file; fails when the path already exists. */
  async createFile(relativePath: string, content: FileContent = ''): Promise<void> {
    const { normalizedPath, absolutePath } = this.validate(relativePath);
    const text = this.validateContent(content);
    await this.assertNoSymlinkEscape(absolutePath, normalizedPath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    try {
      await fs.writeFile(absolutePath, text, { encoding: 'utf-8', flag: 'wx' });
    } catch (err) {
      if (isErrno(err, 'EEXIST')) {
        throw new WorkspaceConflictError('File already exists', {
          code: ALREADY_EXISTS,
          path: normalizedPath,
        });
      }
      throw err;
    }
  }

  /** Delete a file or directory. Fails when the path does not exist. */
  async deleteFile(relativePath: string): Promise<void> {
    const { normalizedPath, absolutePath } = this.validate(relativePath);
    await this.assertNoSymlinkEscape(absolutePath, normalizedPath);

    let stat;
    try {
      stat = await fs.lstat(absolutePath);
    } catch (err) {
      if (isErrno(err, 'ENOENT')) {
        throw new WorkspaceConflictError('Path not found', { code: NOT_FOUND, path: normalizedPath });
      }
      throw err;
    }
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      await fs.rm(absolutePath, { recursive: true, force: false });
    } else {
      await fs.unlink(absolutePath);
    }
  }

  /** Rename a file or directory within the workspace. */
  async renameFile(from: string, to: string): Promise<void> {
    const fromAbs = this.validate(from).absolutePath;
    const toInfo = this.validate(to);
    await this.assertNoSymlinkEscape(fromAbs, from);
    await this.assertNoSymlinkEscape(toInfo.absolutePath, to);

    if (!(await pathExists(fromAbs))) {
      throw new WorkspaceConflictError('Source path not found', { code: NOT_FOUND, path: from });
    }
    await fs.mkdir(path.dirname(toInfo.absolutePath), { recursive: true });
    await fs.rename(fromAbs, toInfo.absolutePath);
  }

  /** Move a file or directory, creating destination parents as needed. */
  async moveFile(from: string, to: string): Promise<void> {
    const fromAbs = this.validate(from).absolutePath;
    const toInfo = this.validate(to);
    await this.assertNoSymlinkEscape(fromAbs, from);
    await this.assertNoSymlinkEscape(toInfo.absolutePath, to);

    if (!(await pathExists(fromAbs))) {
      throw new WorkspaceConflictError('Source path not found', { code: NOT_FOUND, path: from });
    }
    await fs.mkdir(path.dirname(toInfo.absolutePath), { recursive: true });

    try {
      await fs.rename(fromAbs, toInfo.absolutePath);
    } catch (err) {
      if (isErrno(err, 'EXDEV')) {
        await fs.cp(fromAbs, toInfo.absolutePath, { recursive: true, force: true });
        await fs.rm(fromAbs, { recursive: true, force: true });
        return;
      }
      throw err;
    }
  }

  // ── Queries ─────────────────────────────────────────────────────────

  /** Check whether a path exists inside the workspace. */
  async exists(relativePath: string): Promise<boolean> {
    const { normalizedPath, absolutePath } = this.validate(relativePath);
    const escape = await validateSymlinkEscape(this.root, absolutePath);
    if (!escape.ok) return false;
    return pathExists(absolutePath);
  }

  /** Return metadata for a path. */
  async stat(relativePath: string): Promise<FileInfo> {
    const { normalizedPath, absolutePath } = this.validate(relativePath);
    await this.assertNoSymlinkEscape(absolutePath, normalizedPath);

    let stat;
    try {
      stat = await fs.lstat(absolutePath);
    } catch (err) {
      if (isErrno(err, 'ENOENT')) {
        throw new WorkspaceConflictError('Path not found', { code: NOT_FOUND, path: normalizedPath });
      }
      throw err;
    }
    return toFileInfo(normalizedPath, stat);
  }

  /** List directory entries (sorted by name). Use '' or '.' for the workspace root. */
  async list(relativePath?: string): Promise<FileInfo[]> {
    const requested = relativePath ?? '';
    const resolved =
      requested === '' || requested === '.'
        ? { normalizedPath: '', absolutePath: this.root }
        : this.validate(requested);

    await this.assertNoSymlinkEscape(resolved.absolutePath, resolved.normalizedPath || '.');

    let dirents;
    try {
      dirents = await fs.readdir(resolved.absolutePath, { withFileTypes: true });
    } catch (err) {
      if (isErrno(err, 'ENOENT')) {
        throw new WorkspaceConflictError('Directory not found', {
          code: NOT_FOUND,
          path: resolved.normalizedPath || '.',
        });
      }
      throw err;
    }

    const infos: FileInfo[] = [];
    for (const dirent of dirents) {
      const childPath = resolved.normalizedPath === '' ? dirent.name : `${resolved.normalizedPath}/${dirent.name}`;
      const absolute = path.join(resolved.absolutePath, dirent.name);
      let stat;
      try {
        stat = await fs.lstat(absolute);
      } catch {
        continue;
      }
      infos.push(toFileInfo(childPath, stat));
    }
    infos.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return infos;
  }

  // ── Transactions ────────────────────────────────────────────────────

  /** Begin a deferred transaction bound to this workspace. */
  beginTransaction(): WorkspaceTransaction {
    return new WorkspaceTransaction(this);
  }

  // ── Internal apply hooks (used by WorkspaceTransaction) ─────────────

  /** @internal Apply a write without re-validating content (transaction path). */
  async _applyWrite(relativePath: string, content: FileContent): Promise<void> {
    const { normalizedPath, absolutePath } = this.validate(relativePath);
    const text = this.validateContent(content);
    await this.assertNoSymlinkEscape(absolutePath, normalizedPath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, text, 'utf-8');
  }

  /** @internal Apply a create without re-validating content (transaction path). */
  async _applyCreate(relativePath: string, content: FileContent): Promise<void> {
    const { normalizedPath, absolutePath } = this.validate(relativePath);
    const text = this.validateContent(content);
    await this.assertNoSymlinkEscape(absolutePath, normalizedPath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    try {
      await fs.writeFile(absolutePath, text, { encoding: 'utf-8', flag: 'wx' });
    } catch (err) {
      if (isErrno(err, 'EEXIST')) {
        throw new WorkspaceConflictError('File already exists', {
          code: ALREADY_EXISTS,
          path: normalizedPath,
        });
      }
      throw err;
    }
  }

  /** @internal Apply a delete without existence validation (transaction path). */
  async _applyDelete(relativePath: string): Promise<void> {
    const { normalizedPath, absolutePath } = this.validate(relativePath);
    await this.assertNoSymlinkEscape(absolutePath, normalizedPath);
    await fs.rm(absolutePath, { recursive: true, force: false });
  }

  /** @internal Apply a rename without existence validation (transaction path). */
  async _applyRename(from: string, to: string): Promise<void> {
    const fromAbs = this.validate(from).absolutePath;
    const toInfo = this.validate(to);
    await this.assertNoSymlinkEscape(fromAbs, from);
    await this.assertNoSymlinkEscape(toInfo.absolutePath, to);
    await fs.mkdir(path.dirname(toInfo.absolutePath), { recursive: true });
    await fs.rename(fromAbs, toInfo.absolutePath);
  }

  /** @internal Apply a move without existence validation (transaction path). */
  async _applyMove(from: string, to: string): Promise<void> {
    const fromAbs = this.validate(from).absolutePath;
    const toInfo = this.validate(to);
    await this.assertNoSymlinkEscape(fromAbs, from);
    await this.assertNoSymlinkEscape(toInfo.absolutePath, to);
    await fs.mkdir(path.dirname(toInfo.absolutePath), { recursive: true });
    try {
      await fs.rename(fromAbs, toInfo.absolutePath);
    } catch (err) {
      if (isErrno(err, 'EXDEV')) {
        await fs.cp(fromAbs, toInfo.absolutePath, { recursive: true, force: true });
        await fs.rm(fromAbs, { recursive: true, force: true });
        return;
      }
      throw err;
    }
  }
}

// ── Module helpers ────────────────────────────────────────────────────

function isErrno(err: unknown, code: string): boolean {
  return err !== null && typeof err === 'object' && (err as NodeJS.ErrnoException).code === code;
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.lstat(absolutePath);
    return true;
  } catch {
    return false;
  }
}

function toFileInfo(relativePath: string, stat: Awaited<ReturnType<typeof fs.lstat>>): FileInfo {
  const name = relativePath === '' ? '' : path.posix.basename(relativePath);
  return {
    path: relativePath,
    name,
    size: Number(stat.size),
    isFile: stat.isFile(),
    isDirectory: stat.isDirectory(),
    isSymbolicLink: stat.isSymbolicLink(),
    createdAtMs: Number(stat.birthtimeMs),
    modifiedAtMs: Number(stat.mtimeMs),
  };
}
