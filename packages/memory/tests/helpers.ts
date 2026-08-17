/**
 * Shared test helpers: deterministic clocks, in-memory filesystems, and fast
 * repository memory construction. All helpers are deterministic so tests can
 * assert exact orderings and byte-for-byte output.
 */
import {
  MemoryPersistence,
  type MemoryFileSystem,
} from "../src/persistence.js";
import {
  RepositoryMemory,
  type RepositoryMemoryOptions,
} from "../src/repository-memory.js";
import {
  createRepositoryIdentity,
  type RepositoryIdentity,
} from "../src/repository-identity.js";

let rootCounter = 0;

/** Deterministic monotonic clock with manual advance. */
export function makeClock(start = 1_700_000_000_000) {
  let current = start;
  return {
    clock: () => current,
    advance: (ms: number) => {
      current += ms;
      return current;
    },
  };
}

/** Stable repository identity with a unique root. */
export function makeIdentity(options?: {
  root?: string;
  remoteUrl?: string;
  name?: string;
}): RepositoryIdentity {
  rootCounter += 1;
  return createRepositoryIdentity({
    root: options?.root ?? `/devforge/repo-${rootCounter}`,
    remoteUrl: options?.remoteUrl,
    name: options?.name,
  });
}

/** In-memory filesystem for persistence testing without disk. */
export class FakeFileSystem implements MemoryFileSystem {
  readonly files = new Map<string, string>();
  readonly renames: Array<[string, string]> = [];
  /** When true, writeFile throws (surfaces as a mutate error). */
  writeFailures = 0;
  renameFailures = 0;

  async mkdir(_path: string): Promise<void> {}

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      const error = new Error(`ENOENT: no such file, open '${path}'`) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    return content;
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (this.writeFailures > 0) {
      this.writeFailures -= 1;
      throw new Error(`injected write failure for ${path}`);
    }
    this.files.set(path, content);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    if (this.renameFailures > 0) {
      this.renameFailures -= 1;
      throw new Error(`injected rename failure for ${oldPath}`);
    }
    this.renames.push([oldPath, newPath]);
    const content = this.files.get(oldPath);
    if (content === undefined) {
      const error = new Error(`ENOENT: no such file, open '${oldPath}'`) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    this.files.delete(oldPath);
    this.files.set(newPath, content);
  }

  async unlink(path: string): Promise<void> {
    this.files.delete(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async size(path: string): Promise<number> {
    const content = this.files.get(path);
    return content === undefined ? 0 : Buffer.byteLength(content, "utf8");
  }
}

export interface MakeMemoryOptions {
  readonly repository?: RepositoryIdentity;
  readonly fs?: FakeFileSystem;
  readonly baseDir?: string;
  readonly autoSave?: boolean;
  /** Deterministic clock object; defaults to a fresh makeClock(). */
  readonly clock?: ReturnType<typeof makeClock>;
  readonly gc?: RepositoryMemoryOptions["gc"];
}

/** Build a RepositoryMemory over an in-memory filesystem. */
export function makeMemory(options: MakeMemoryOptions = {}): {
  memory: RepositoryMemory;
  fs: FakeFileSystem;
  clock: ReturnType<typeof makeClock>;
  repository: RepositoryIdentity;
  baseDir: string;
} {
  const repository = options.repository ?? makeIdentity();
  const fs = options.fs ?? new FakeFileSystem();
  const clock = options.clock ?? makeClock();
  const baseDir = options.baseDir ?? "/memory-root";
  const persistence = new MemoryPersistence({
    baseDir,
    repositoryId: repository.id,
    now: clock.clock,
    fs,
  });
  const memory = new RepositoryMemory({
    repository,
    persistence,
    clock: clock.clock,
    autoSave: options.autoSave ?? false,
    gc: options.gc,
  });
  return { memory, fs, clock, repository, baseDir };
}

/** A convenience builder aligning a repo identity with its storage base. */
export function memoryForRoot(root: string, options: Omit<MakeMemoryOptions, "repository"> = {}) {
  const repository = makeIdentity({ root });
  return makeMemory({ ...options, repository });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { RepositoryMemory, createRepositoryIdentity, type RepositoryIdentity };