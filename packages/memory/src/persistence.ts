/**
 * @devforge/memory — Repository-scoped persistence (DF-023).
 *
 * Records are persisted as a single canonical JSON file per repository:
 *
 *   <baseDir>/<repositoryId>/records.json
 *
 * Guarantees:
 *   - Atomic writes (temp file + rename).
 *   - Corruption detection (embedded SHA-256 checksum + schema validation).
 *   - Safe recovery (corrupt bytes are preserved aside; a fresh state loads).
 *   - Deterministic serialization (records sorted by id, keys sorted).
 *   - Secret redaction of every persisted text field.
 *
 * No database dependency is introduced.
 */
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { sha256, stableStringify, compare } from "./ids.js";
import { redactSecrets, REDACTED } from "./secrets.js";
import type { MemoryRecord } from "./types.js";
import { StorageCorruptError } from "./errors.js";

export const PERSISTENCE_VERSION = 1;
export const RECORDS_FILE = "records.json";
export const DEFAULT_MEMORY_DIR = ".devforge/memory";

/** Minimal filesystem surface so persistence is testable without disk. */
export interface MemoryFileSystem {
  mkdir(path: string): Promise<void>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  size(path: string): Promise<number>;
}

export const realFileSystem: MemoryFileSystem = {
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  readFile: async (path) => readFile(path, "utf8"),
  writeFile: async (path, content) => {
    await writeFile(path, content, "utf8");
  },
  rename: async (oldPath, newPath) => {
    await rename(oldPath, newPath);
  },
  unlink: async (path) => {
    await unlink(path);
  },
  exists: async (path) => {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  },
  size: async (path) => {
    return (await stat(path)).size;
  },
};

export interface MemoryPersistenceConfig {
  /** Directory under which per-repository folders are created. */
  readonly baseDir: string;
  readonly repositoryId: string;
  /** Deterministic stringifier (default: key-sorted stable JSON). */
  readonly stringify?: (value: unknown) => string;
  /** Text redactor applied to persisted strings (default: redactSecrets). */
  readonly redact?: (text: string) => string;
  /** Injectable clock for deterministic recovery naming. */
  readonly now?: () => number;
  /** Injectable filesystem (default: real disk). */
  readonly fs?: MemoryFileSystem;
  /** When true a single corrupt file aborts instead of recovering. */
  readonly strict?: boolean;
}

export interface PersistedState {
  readonly records: readonly MemoryRecord[];
  readonly fileVersion: number;
  readonly recovered: boolean;
  readonly recoveryReason: string | null;
}

export interface PersistResult {
  readonly filePath: string;
  readonly bytes: number;
}

export interface PersistedFile {
  readonly version: number;
  readonly repositoryId: string;
  readonly records: readonly MemoryRecord[];
  readonly checksum: string;
}

/** Deep-redact every persisted string field of a memory record. */
export function redactMemoryRecord(
  record: MemoryRecord,
  redact: (text: string) => string = redactSecrets,
): MemoryRecord {
  const redactStrings = (value: unknown): unknown => {
    if (typeof value === "string") return redact(value);
    if (Array.isArray(value)) return value.map(redactStrings);
    if (value !== null && typeof value === "object") {
      const result = {} as Record<string, unknown>;
      for (const [key, item] of Object.entries(
        value as Record<string, unknown>,
      )) {
        result[key] = redactStrings(item);
      }
      return result;
    }
    return value;
  };
  return redactStrings(record) as unknown as MemoryRecord;
}

/** Deterministic file serialization with embedded integrity checksum. */
export function serializeRecords(
  repositoryId: string,
  records: readonly MemoryRecord[],
  config: Pick<
    MemoryPersistenceConfig,
    "stringify" | "redact"
  > = {},
  version: number = PERSISTENCE_VERSION,
): string {
  const stringify = config.stringify ?? stableStringify;
  const redact = config.redact ?? redactSecrets;
  const redacted = records
    .map((record) => redactMemoryRecord(record, redact))
    .sort((a, b) => compare(a.id, b.id));
  const checksum = sha256(
    `${version}|${repositoryId}|${stringify(redacted)}`,
  );
  return stringify({
    version,
    repositoryId,
    records: redacted,
    checksum,
  } satisfies PersistedFile);
}

/** Parse a serialized file body, verifying version, shape, and checksum. */
export function deserializeRecords(
  content: string,
  config: Pick<MemoryPersistenceConfig, "stringify"> = {},
): PersistedFile {
  const stringify = config.stringify ?? stableStringify;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new StorageCorruptError(
      "<inline>",
      `Serialized memory is not valid JSON: ${(error as Error).message}`,
    );
  }
  const file = parsed as Partial<PersistedFile>;
  const records = Array.isArray(file.records) ? file.records : null;
  if (typeof file.version !== "number" || records === null) {
    throw new StorageCorruptError(
      "<inline>",
      "Serialized memory has an invalid envelope shape.",
    );
  }
  const expectedChecksum = sha256(
    `${file.version}|${file.repositoryId ?? ""}|${stringify(file.records)}`,
  );
  if (file.checksum !== expectedChecksum) {
    throw new StorageCorruptError(
      "<inline>",
      "Serialized memory checksum mismatch.",
    );
  }
  return file as PersistedFile;
}

/**
 * Repository-scoped persistence for memory records. Safe, atomic, and fully
 * deterministic.
 */
export class MemoryPersistence {
  private readonly baseDir: string;
  private readonly repositoryId: string;
  private readonly stringify: (value: unknown) => string;
  private readonly redact: (text: string) => string;
  private readonly now: () => number;
  private readonly fs: MemoryFileSystem;
  private readonly strict: boolean;

  constructor(config: MemoryPersistenceConfig) {
    this.baseDir = config.baseDir;
    this.repositoryId = config.repositoryId;
    this.stringify = config.stringify ?? stableStringify;
    this.redact = config.redact ?? redactSecrets;
    this.now = config.now ?? Date.now;
    this.fs = config.fs ?? realFileSystem;
    this.strict = config.strict ?? false;
  }

  get repositoryStorageDir(): string {
    return join(this.baseDir, this.repositoryId);
  }

  get filePath(): string {
    return join(this.repositoryStorageDir, RECORDS_FILE);
  }

  /** Load persisted records, recovering from corruption by default. */
  async load(): Promise<PersistedState> {
    const path = this.filePath;
    if (!(await this.fs.exists(path))) {
      return emptyState();
    }
    let content: string;
    try {
      content = await this.fs.readFile(path);
    } catch {
      return emptyState();
    }
    try {
      const file = deserializeRecords(content, { stringify: this.stringify });
      if (file.repositoryId !== this.repositoryId) {
        throw new StorageCorruptError(
          path,
          `Persisted repository '${file.repositoryId}' does not match '${this.repositoryId}'.`,
        );
      }
      return {
        records: file.records,
        fileVersion: file.version,
        recovered: false,
        recoveryReason: null,
      };
    } catch (error) {
      if (this.strict) throw error;
      const reason =
        error instanceof StorageCorruptError
          ? error.message
          : "Unknown persistence failure.";
      await this.preserveCorrupt(path);
      return {
        records: [],
        fileVersion: 0,
        recovered: true,
        recoveryReason: reason,
      };
    }
  }

  /** Persist records atomically; returns the resulting file path and size. */
  async save(records: readonly MemoryRecord[]): Promise<PersistResult> {
    await this.fs.mkdir(this.repositoryStorageDir);
    const serialized = serializeRecords(this.repositoryId, records, {
      stringify: this.stringify,
      redact: this.redact,
    });
    const tempPath = `${this.filePath}.tmp`;
    await this.fs.writeFile(tempPath, serialized);
    try {
      await this.fs.rename(tempPath, this.filePath);
    } catch (error) {
      await this.fs.unlink(tempPath).catch(() => undefined);
      throw error;
    }
    const bytes = Buffer.byteLength(serialized, "utf8");
    return { filePath: this.filePath, bytes };
  }

  /** Approximate persisted size in bytes, or 0 when absent. */
  async persistedBytes(): Promise<number> {
    const path = this.filePath;
    if (!(await this.fs.exists(path))) return 0;
    try {
      return await this.fs.size(path);
    } catch {
      return 0;
    }
  }

  async existsOnDisk(): Promise<boolean> {
    return this.fs.exists(this.filePath);
  }

  /** Move a corrupt file aside so its bytes survive for forensics. */
  private async preserveCorrupt(path: string): Promise<void> {
    const orphanPath = `${path}.corrupt-${this.now()}`;
    try {
      await this.fs.rename(path, orphanPath);
    } catch {
      // If we cannot rename, leave the file untouched and start fresh.
    }
    try {
      const tmp = `${path}.tmp`;
      if (await this.fs.exists(tmp)) {
        await this.fs.unlink(tmp).catch(() => undefined);
      }
    } catch {
      // Best-effort cleanup.
    }
  }
}

function emptyState(): PersistedState {
  return {
    records: [],
    fileVersion: 0,
    recovered: false,
    recoveryReason: null,
  };
}

export { REDACTED };