/**
 * @devforge/benchmark — Repository fixtures (DF-024).
 *
 * Every benchmark task executes against an isolated fixture: a temporary,
 * deterministic copy of the dataset's source files. Fixtures are created fresh
 * per task, cleaned up after execution, and protected by timeouts. A failed
 * benchmark never contaminates another.
 */
import { sha256, shortHash, stableStringify } from "@devforge/memory";
import type { FileSystemIO } from "./file-system.js";
import { realFileSystemIO } from "./file-system.js";
import { FixtureError } from "./errors.js";
import type {
  BenchmarkTask,
  CommandResult,
  DatasetRepository,
  RepositoryFixtureAbstraction,
} from "./types.js";

/* ------------------------------------------------------------------ *
 * Commands                                                            *
 * ------------------------------------------------------------------ */

export interface CommandOptions {
  readonly timeoutMs?: number;
}

/** Runs a command inside a fixture directory. Injectable for tests. */
export interface CommandRunner {
  readonly name: string;
  run(
    dir: string,
    command: string,
    options?: CommandOptions,
  ): Promise<CommandResult>;
}

/** Production command runner via `node:child_process` (shell). */
export class RealCommandRunner implements CommandRunner {
  readonly name = "real";

  async run(
    dir: string,
    command: string,
    options: CommandOptions = {},
  ): Promise<CommandResult> {
    const { execFile } = await import("node:child_process");
    const { spawn } = await import("node:child_process");
    const startedAt = Date.now();
    return new Promise<CommandResult>((resolve) => {
      const child = execFile(
        "/bin/sh",
        ["-c", command],
        { cwd: dir, timeout: options.timeoutMs, maxBuffer: 16 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const exitCode =
            error === null
              ? 0
              : typeof (error as { code?: number | string }).code === "number"
                ? ((error as { code?: number | string }).code as number)
                : 1;
          resolve({
            command,
            exitCode,
            stdout: String(stdout),
            stderr: String(stderr),
            durationMs: Math.max(0, Date.now() - startedAt),
          });
        },
      );
      if (options.timeoutMs !== undefined && child) {
        const timer = setTimeout(() => {
          try {
            spawn("/bin/sh", ["-c", `kill -9 ${child.pid ?? ""} 2>/dev/null || true`]);
            child.kill("SIGKILL");
          } catch {
            /* already exited */
          }
        }, options.timeoutMs);
        child.on("close", () => clearTimeout(timer));
      }
    });
  }
}

/* ------------------------------------------------------------------ *
 * Fixture                                                             *
 * ------------------------------------------------------------------ */

/** Deterministic id derived from the task/repository/base revision. */
export function fixtureIdFor(
  task: BenchmarkTask,
  repository: DatasetRepository,
): string {
  return shortHash(
    stableStringify({
      task: task.id,
      repository: repository.id,
      baseRevision: task.baseRevision,
    }),
    24,
  );
}

export interface RepositoryFixture extends RepositoryFixtureAbstraction {
  readonly fixtureId: string;
  readonly rootDir: string;
  readonly repositoryId: string;
  readonly baseRevision: string;
  isGit(): boolean;
  exists(relativePath: string): Promise<boolean>;
  deleteFile(relativePath: string): Promise<void>;
  run(command: string, options?: CommandOptions): Promise<CommandResult>;
  /** Materialize the initial state. Idempotent. */
  initialize(): Promise<void>;
  /** Tear down; idempotent. All operations after cleanup reject. */
  cleanup(): Promise<void>;
  /** Deterministic sha-256 snapshot of every file's content. */
  snapshotContents(): Promise<Readonly<Record<string, string>>>;
}

export interface RepositoryFixtureFactory {
  readonly name: string;
  create(
    task: BenchmarkTask,
    repository: DatasetRepository,
  ): Promise<RepositoryFixture>;
}

/* ------------------------------------------------------------------ *
 * Shared fixture core                                                 *
 * ------------------------------------------------------------------ */

export interface FixtureCoreOptions {
  readonly io: FileSystemIO;
  readonly commandRunner: CommandRunner;
  readonly task: BenchmarkTask;
  readonly repository: DatasetRepository;
  readonly rootDir: string;
  /** Optional post-materialize hook (e.g. git init/commit). */
  readonly afterMaterialize?: (fixture: RepositoryFixture) => Promise<void>;
}

export class FixtureCore implements RepositoryFixture {
  readonly fixtureId: string;
  readonly rootDir: string;
  readonly repositoryId: string;
  readonly baseRevision: string;
  private closed = false;
  private initialized = false;

  constructor(private readonly options: FixtureCoreOptions) {
    this.fixtureId = fixtureIdFor(options.task, options.repository);
    this.rootDir = options.rootDir;
    this.repositoryId = options.repository.id;
    this.baseRevision = options.task.baseRevision;
  }

  private checkOpen(): void {
    if (this.closed) {
      throw new FixtureError(
        `fixture '${this.fixtureId}' is closed after cleanup`,
      );
    }
  }

  private path(relativePath: string): string {
    return `${this.rootDir.replace(/\/+$/, "")}/${relativePath.replace(/^\/+/, "")}`;
  }

  /** Recursively list files (relative paths) under the fixture root. */
  private async walkFiles(prefix = ""): Promise<string[]> {
    const dir = `${this.rootDir.replace(/\/+$/, "")}${prefix.length === 0 ? "" : `/${prefix}`}`;
    const entries = await this.options.io.listFiles(dir);
    const files: string[] = [];
    for (const name of entries.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      const relativePath = prefix.length === 0 ? name : `${prefix}/${name}`;
      const fullPath = `${this.rootDir.replace(/\/+$/, "")}/${relativePath}`;
      try {
        await this.options.io.readFile(fullPath);
        files.push(relativePath);
      } catch {
        files.push(...(await this.walkFiles(relativePath)));
      }
    }
    return files;
  }

  isGit(): boolean {
    return this.options.repository.isGit;
  }

  async initialize(): Promise<void> {
    this.checkOpen();
    if (this.initialized) return;
    const files = Object.keys(this.options.repository.files).sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    for (const relativePath of files) {
      const content = this.options.repository.files[relativePath];
      if (content === undefined) continue;
      await this.options.io.writeFile(this.path(relativePath), content);
    }
    if (this.options.afterMaterialize) {
      await this.options.afterMaterialize(this);
    }
    this.initialized = true;
  }

  async cleanup(): Promise<void> {
    if (this.closed) return;
    try {
      const files = await this.walkFiles();
      for (const relativePath of files) {
        await this.options.io.deleteFile(this.path(relativePath));
      }
    } catch {
      /* best-effort; the root removal below still runs */
    }
    this.closed = true;
    this.initialized = false;
    await this.options.io.deleteFile(this.rootDir);
  }

  async readFile(relativePath: string): Promise<string | null> {
    this.checkOpen();
    if (!(await this.options.io.exists(this.path(relativePath)))) return null;
    try {
      return await this.options.io.readFile(this.path(relativePath));
    } catch {
      return null;
    }
  }

  async writeFile(relativePath: string, content: string): Promise<void> {
    this.checkOpen();
    await this.options.io.writeFile(this.path(relativePath), content);
  }

  async deleteFile(relativePath: string): Promise<void> {
    this.checkOpen();
    await this.options.io.deleteFile(this.path(relativePath));
  }

  async exists(relativePath: string): Promise<boolean> {
    this.checkOpen();
    return this.options.io.exists(this.path(relativePath));
  }

  async listFiles(): Promise<string[]> {
    this.checkOpen();
    return this.walkFiles();
  }

  async run(
    command: string,
    options: CommandOptions = {},
  ): Promise<CommandResult> {
    this.checkOpen();
    return this.options.commandRunner.run(this.rootDir, command, options);
  }

  async snapshotContents(): Promise<Readonly<Record<string, string>>> {
    this.checkOpen();
    const files = await this.walkFiles();
    const snapshot: Record<string, string> = {};
    for (const relativePath of files) {
      snapshot[relativePath] = sha256(
        await this.options.io.readFile(this.path(relativePath)),
      );
    }
    return snapshot;
  }
}

/* ------------------------------------------------------------------ *
 * In-memory factory (deterministic tests, offline)                    *
 * ------------------------------------------------------------------ */

export interface InMemoryFixtureFactoryOptions {
  readonly io: FileSystemIO;
  readonly commandRunner: CommandRunner;
  readonly baseDir?: string;
}

/** Deterministic fixture factory over an injected filesystem. */
export class InMemoryRepositoryFixtureFactory
  implements RepositoryFixtureFactory
{
  readonly name = "in-memory";

  constructor(private readonly options: InMemoryFixtureFactoryOptions) {}

  async create(
    task: BenchmarkTask,
    repository: DatasetRepository,
  ): Promise<RepositoryFixture> {
    const rootDir = `${this.options.baseDir ?? "/fixtures"}/${fixtureIdFor(task, repository)}`;
    return new FixtureCore({
      io: this.options.io,
      commandRunner: this.options.commandRunner,
      task,
      repository,
      rootDir,
    });
  }
}

/* ------------------------------------------------------------------ *
 * Real temp-dir factory                                              *
 * ------------------------------------------------------------------ */

export interface TmpFixtureFactoryOptions {
  readonly io?: FileSystemIO;
  readonly commandRunner?: CommandRunner;
  readonly tempPrefix?: string;
  /** Initialize git metadata when repository.isGit is true. */
  readonly git?: boolean;
}

/** Real factory: one temporary directory per fixture, cleaned afterwards. */
export class TmpRepositoryFixtureFactory implements RepositoryFixtureFactory {
  readonly name = "tmp";
  private readonly io: FileSystemIO;
  private readonly commandRunner: CommandRunner;
  private readonly prefix: string;
  private readonly git: boolean;

  constructor(options: TmpFixtureFactoryOptions = {}) {
    this.io = options.io ?? realFileSystemIO;
    this.commandRunner = options.commandRunner ?? new RealCommandRunner();
    this.prefix =
      options.tempPrefix ??
      `${process.env.TMPDIR ?? "/tmp"}/devforge-benchmark-`;
    this.git = options.git ?? true;
  }

  async create(
    task: BenchmarkTask,
    repository: DatasetRepository,
  ): Promise<RepositoryFixture> {
    const rootDir = await this.io.makeTempDir(this.prefix);
    const fixture = new FixtureCore({
      io: this.io,
      commandRunner: this.commandRunner,
      task,
      repository,
      rootDir,
      ...(this.git && repository.isGit
        ? {
            afterMaterialize: async (current): Promise<void> => {
              const commands = [
                "git init -q",
                "git add -A",
                "git -c user.name=devforge -c user.email=devforge@local commit -q -m initial",
              ];
              for (const command of commands) {
                const result = await current.run(command);
                if (result.exitCode !== 0) {
                  throw new FixtureError(
                    `git setup failed for '${task.id}' with '${command}': ${result.stderr}`,
                  );
                }
              }
              if (task.baseRevision.length > 0) {
                const branch = await current.run(
                  `git checkout -qb ${task.baseRevision}`,
                );
                if (branch.exitCode !== 0) {
                  throw new FixtureError(
                    `git branch setup failed for '${task.id}': ${branch.stderr}`,
                  );
                }
              }
            },
          }
        : {}),
    });
    return fixture;
  }
}

export type { FileSystemIO };