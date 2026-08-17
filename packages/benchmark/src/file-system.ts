/**
 * @devforge/benchmark — Byte-level IO abstraction (DF-024).
 *
 * Every on-disk interaction (repository fixtures, result store, artifacts)
 * flows through a {@link FileSystemIO}. Production uses the real filesystem;
 * tests inject an {@link InMemoryFileSystemIO} so no benchmark test touches
 * external state. All operations are deterministic for identical inputs.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

/** Paths are normalized with POSIX separators and no trailing slash. */
export function normalizePath(input: string): string {
  const converted = input.replace(/\\/g, "/").split("/").join("/");
  const normalized = converted.replace(/\/+$/, "");
  return normalized === "" ? "/" : normalized;
}

/** Minimal, injectable filesystem surface used across the framework. */
export interface FileSystemIO {
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  deleteFile(filePath: string): Promise<void>;
  rename(fromPath: string, toPath: string): Promise<void>;
  listFiles(dir: string): Promise<string[]>;
  has(dir: string, name: string): Promise<boolean>;
  exists(filePath: string): Promise<boolean>;
  mkdir(dir: string): Promise<void>;
  makeTempDir(prefix: string): Promise<string>;
}

/** Real filesystem backed by `node:fs/promises`. */
export const realFileSystemIO: FileSystemIO = {
  async readFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, "utf8");
  },
  async writeFile(filePath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
  },
  async deleteFile(filePath: string): Promise<void> {
    await fs.rm(filePath, { force: true });
  },
  async rename(fromPath: string, toPath: string): Promise<void> {
    await fs.mkdir(path.dirname(toPath), { recursive: true });
    await fs.rename(fromPath, toPath);
  },
  async listFiles(dir: string): Promise<string[]> {
    return fs.readdir(dir);
  },
  async has(dir: string, name: string): Promise<boolean> {
    try {
      await fs.access(path.join(dir, name));
      return true;
    } catch {
      return false;
    }
  },
  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  },
  async mkdir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  },
  async makeTempDir(prefix: string): Promise<string> {
    return fs.mkdtemp(`${prefix}`);
  },
};

/**
 * In-memory filesystem for deterministic tests. Paths are normalized with
 * POSIX separators; every write is authoritative and immediately visible.
 */
export class InMemoryFileSystemIO implements FileSystemIO {
  readonly files: Map<string, string> = new Map();

  private constructor() {}

  static create(): InMemoryFileSystemIO {
    return new InMemoryFileSystemIO();
  }

  async readFile(filePath: string): Promise<string> {
    const normalized = normalizePath(filePath);
    const content = this.files.get(normalized);
    if (content === undefined) {
      throw new Error(`ENOENT: no such file '${filePath}'`);
    }
    return content;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    this.files.set(normalizePath(filePath), content);
  }

  async deleteFile(filePath: string): Promise<void> {
    this.files.delete(normalizePath(filePath));
  }

  async rename(fromPath: string, toPath: string): Promise<void> {
    const normalized = normalizePath(fromPath);
    const content = this.files.get(normalized);
    if (content === undefined) {
      throw new Error(`ENOENT: cannot rename missing file '${fromPath}'`);
    }
    this.files.delete(normalized);
    this.files.set(normalizePath(toPath), content);
  }

  async listFiles(dir: string): Promise<string[]> {
    const prefix = normalizePath(dir) === "/" ? "/" : `${normalizePath(dir)}/`;
    const names = new Set<string>();
    for (const filePath of this.files.keys()) {
      if (prefix === "/") {
        if (filePath.startsWith("/")) {
          const rest = filePath.slice(1);
          const first = rest.includes("/") ? rest.slice(0, rest.indexOf("/")) : rest;
          if (first) names.add(first);
        }
        continue;
      }
      if (!filePath.startsWith(prefix)) continue;
      const rest = filePath.slice(prefix.length);
      const first = rest.includes("/") ? rest.slice(0, rest.indexOf("/")) : rest;
      if (first) names.add(first);
    }
    return Array.from(names).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  async has(dir: string, name: string): Promise<boolean> {
    const prefix = normalizePath(dir) === "/" ? "/" : `${normalizePath(dir)}/`;
    for (const filePath of this.files.keys()) {
      if (!filePath.startsWith(prefix)) continue;
      const rest = filePath.slice(prefix.length);
      if (rest.split("/")[0] === name) return true;
    }
    return false;
  }

  async exists(filePath: string): Promise<boolean> {
    return this.files.has(normalizePath(filePath));
  }

  async mkdir(dir: string): Promise<void> {
    // In-memory mode does not need real directories; no-op by design.
  }

  async makeTempDir(prefix: string): Promise<string> {
    const name = `${prefix}mem-${this.files.size}`;
    this.files.set(normalizePath(name), "");
    return name;
  }

  /** Deterministic snapshot of every stored path. */
  paths(): string[] {
    return Array.from(this.files.keys()).sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
  }
}