/**
 * Shared test helpers: create/cleanup temporary workspace roots.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/** Create a unique temporary directory to use as a workspace root. */
export async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'devforge-exec-'));
}

/** Recursively remove a temporary directory. */
export async function cleanupTempDir(root: string): Promise<void> {
  await fs.rm(root, { recursive: true, force: true });
}

/** True when symlink creation is supported (skipped on Windows without privilege). */
export const SYMLINKS_SUPPORTED = process.platform !== 'win32';
