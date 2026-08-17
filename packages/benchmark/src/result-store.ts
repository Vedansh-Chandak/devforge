/**
 * @devforge/benchmark — Result store (DF-024).
 *
 * Persists benchmark results with deterministic serialization, atomic writes,
 * integrity checks, and stable content-derived result ids. Reuses
 * `@devforge/memory`'s canonical stringify + hashing instead of reimplementing.
 */
import { sha256, shortHash, stableStringify } from "@devforge/memory";
import type { FileSystemIO } from "./file-system.js";
import type { Clock } from "./clock.js";
import { SystemClock } from "./clock.js";
import type { BenchmarkResult } from "./types.js";
import { CorruptStoreError, ResultStoreError } from "./errors.js";

export const RESULT_SCHEMA_VERSION = 1;

export interface StoredRun {
  readonly schemaVersion: number;
  readonly resultId: string;
  readonly storedAtMs: number;
  readonly result: BenchmarkResult;
  readonly checksum: string;
}

export interface ResultStore {
  save(result: BenchmarkResult): Promise<StoredRun>;
  load(resultId: string): Promise<StoredRun>;
  list(): Promise<string[]>;
  latest(): Promise<StoredRun | null>;
  delete(resultId: string): Promise<boolean>;
}

/** Stable, content-derived id for a benchmark result. */
export function resultIdFor(result: BenchmarkResult): string {
  return shortHash(
    stableStringify({
      dataset: result.datasetName,
      datasetVersion: result.datasetVersion,
      benchmark: result.benchmarkVersion,
      devforge: result.devforgeVersion,
      configuration: result.configuration,
      tasks: result.tasks.map((task) => [
        task.taskId,
        task.status,
        task.score,
        task.taskVersion,
      ]),
    }),
    24,
  );
}

/** Checksum over the stable payload (excluding the checksum itself). */
function checksumOf(payload: Omit<StoredRun, "checksum">): string {
  return sha256(
    stableStringify({
      schemaVersion: payload.schemaVersion,
      resultId: payload.resultId,
      storedAtMs: payload.storedAtMs,
      result: payload.result,
    }),
  );
}

interface StoreBackend {
  save(stored: StoredRun): Promise<void>;
  load(resultId: string): Promise<StoredRun>;
  list(): Promise<string[]>;
  delete(resultId: string): Promise<boolean>;
}

/** In-memory backend used for tests and ephemeral runs. */
export class MemoryBackend implements StoreBackend {
  readonly entries = new Map<string, StoredRun>();

  async save(stored: StoredRun): Promise<void> {
    this.entries.set(stored.resultId, stored);
  }

  async load(resultId: string): Promise<StoredRun> {
    const stored = this.entries.get(resultId);
    if (!stored) throw new ResultStoreError(`no stored run '${resultId}'`);
    return stored;
  }

  async list(): Promise<string[]> {
    return Array.from(this.entries.keys()).sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
  }

  async delete(resultId: string): Promise<boolean> {
    return this.entries.delete(resultId);
  }
}

/** Result store on top of any {@link FileSystemIO} (atomic tmp + rename). */
export class FileBackend implements StoreBackend {
  constructor(
    private readonly io: FileSystemIO,
    private readonly baseDir: string,
  ) {}

  private fileFor(resultId: string): string {
    return `${this.baseDir.replace(/\/+$/, "")}/${resultId}.json`;
  }

  async save(stored: StoredRun): Promise<void> {
    await this.io.mkdir(this.baseDir);
    const target = this.fileFor(stored.resultId);
    const tmp = `${target}.tmp`;
    await this.io.writeFile(tmp, `${stableStringify(stored)}\n`);
    await this.io.rename(tmp, target);
    await this.io.deleteFile(tmp);
  }

  async load(resultId: string): Promise<StoredRun> {
    const filePath = this.fileFor(resultId);
    let raw: string;
    try {
      raw = await this.io.readFile(filePath);
    } catch (error) {
      throw new ResultStoreError(`no stored run '${resultId}'`);
    }
    return parseStoredRun(raw, resultId);
  }

  async list(): Promise<string[]> {
    await this.io.mkdir(this.baseDir);
    const names = await this.io.listFiles(this.baseDir);
    return names
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.replace(/\.json$/, ""))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  async delete(resultId: string): Promise<boolean> {
    const existed = await this.io.exists(this.fileFor(resultId));
    await this.io.deleteFile(this.fileFor(resultId));
    return existed;
  }
}

/** Parse + integrity check a stored run payload. */
export function parseStoredRun(raw: string, expectedId?: string): StoredRun {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CorruptStoreError(
      `stored payload is not valid JSON: ${(error as Error).message}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new CorruptStoreError("stored payload is not an object");
  }
  const record = parsed as Record<string, unknown>;
  if (record.schemaVersion !== RESULT_SCHEMA_VERSION) {
    throw new CorruptStoreError(
      `unsupported schema version '${String(record.schemaVersion)}'`,
    );
  }
  if (typeof record.resultId !== "string") {
    throw new CorruptStoreError("stored payload is missing resultId");
  }
  if (expectedId !== undefined && expectedId !== record.resultId) {
    throw new CorruptStoreError(
      `stored resultId '${record.resultId}' does not match requested '${expectedId}'`,
    );
  }
  const stored = record as unknown as StoredRun;
  const expected = checksumOf({
    schemaVersion: stored.schemaVersion,
    resultId: stored.resultId,
    storedAtMs: stored.storedAtMs,
    result: stored.result,
  });
  if (stored.checksum !== expected) {
    throw new CorruptStoreError("stored payload checksum mismatch");
  }
  return stored;
}

export interface ResultStoreFactoryOptions {
  readonly backend?: StoreBackend;
  readonly io?: FileSystemIO;
  readonly baseDir?: string;
  readonly clock?: Clock;
}

/** Build a result store over an in-memory or file backend. */
export function createResultStore(
  options: ResultStoreFactoryOptions = {},
): ResultStore {
  const backend: StoreBackend =
    options.backend ?? new FileBackend(options.io!, options.baseDir ?? "/results");
  const clock = options.clock ?? new SystemClock();
  return new StoreController(backend, clock);
}

class StoreController implements ResultStore {
  constructor(
    private readonly backend: StoreBackend,
    private readonly clock: Clock,
  ) {}

  async save(result: BenchmarkResult): Promise<StoredRun> {
    const payload = {
      schemaVersion: RESULT_SCHEMA_VERSION,
      resultId: result.resultId,
      storedAtMs: this.clock.now(),
      result,
    };
    const stored: StoredRun = { ...payload, checksum: checksumOf(payload) };
    await this.backend.save(stored);
    return stored;
  }

  async load(resultId: string): Promise<StoredRun> {
    return this.backend.load(resultId);
  }

  async list(): Promise<string[]> {
    return this.backend.list();
  }

  async latest(): Promise<StoredRun | null> {
    const ids = await this.backend.list();
    if (ids.length === 0) return null;
    let latestStored: StoredRun | null = null;
    for (const id of ids) {
      const stored = await this.backend.load(id);
      if (
        latestStored === null ||
        stored.storedAtMs > latestStored.storedAtMs ||
        (stored.storedAtMs === latestStored.storedAtMs &&
          stored.resultId > latestStored.resultId)
      ) {
        latestStored = stored;
      }
    }
    return latestStored;
  }

  async delete(resultId: string): Promise<boolean> {
    return this.backend.delete(resultId);
  }
}

export { sha256, shortHash, stableStringify };