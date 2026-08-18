/**
 * @devforge/memory — RepositoryMemory facade (DF-023).
 *
 * The primary entry point: binds a {@link MemoryStore} to a stable
 * {@link RepositoryIdentity} and a {@link MemoryPersistence}, and exposes the
 * typed facades for architecture, conventions, decisions, task/failure
 * history, and sessions, plus retrieval, garbage collection, and
 * summarization. This class never executes commands, generates patches, or
 * modifies repository files other than its own scoped memory store.
 */
import { MemoryStore } from "./memory-store.js";
import {
  MemoryPersistence,
  DEFAULT_MEMORY_DIR,
  type PersistedState,
} from "./persistence.js";
import { ArchitectureMemory } from "./architecture.js";
import { ConventionMemory } from "./conventions.js";
import { DecisionMemory } from "./decisions.js";
import { TaskMemory } from "./task.js";
import { FailureMemory } from "./failure.js";
import { SessionMemory } from "./session-memory.js";
import { HistoryRecorder } from "./history.js";
import {
  createRepositoryIdentity,
  type RepositoryIdentity,
} from "./repository-identity.js";
import {
  buildMemoryRecord,
  defaultIdFactory,
  type MemoryContext,
} from "./record-builder.js";
import { retrieve, type RetrieveOptions, type RetrievalResult } from "./retrieval.js";
import { collectGarbage, type GcConfig, type GcResult } from "./garbage-collector.js";
import {
  DeterministicSummarizer,
  type Summarizer,
} from "./summarizer.js";
import { memoryText } from "./text.js";
import { NotFoundError, RepositoryMismatchError } from "./errors.js";
import type { IdInput, MemoryRecord, MemoryType, PayloadByType } from "./types.js";
import { join } from "node:path";

export interface RepositoryMemoryOptions {
  /** The repository this memory belongs to. */
  readonly repository: RepositoryIdentity;
  /** Root directory holding one subfolder per repository id. */
  readonly baseDir?: string;
  readonly persistence?: MemoryPersistence;
  readonly store?: MemoryStore<MemoryRecord>;
  /** Injected clock. */
  readonly clock?: () => number;
  /** Injected deterministic ID factory. */
  readonly idFactory?: (input: IdInput) => string;
  /** Default garbage-collection bounds applied on demand. */
  readonly gc?: GcConfig;
  /** Persist after every mutation (default true). */
  readonly autoSave?: boolean;
  /** Persistence strict mode: corrupt files throw instead of recovering. */
  readonly strictPersistence?: boolean;
  /** Summarizer override (default {@link DeterministicSummarizer}). */
  readonly summarizer?: Summarizer;
}

/** Minimal interface exposed to future consumers (Brain, Planner, CLI, ...). */
export interface MemoryFacade {
  readonly repository: RepositoryIdentity;
  readonly architecture: ArchitectureMemory;
  readonly conventions: ConventionMemory;
  readonly decisions: DecisionMemory;
  readonly tasks: TaskMemory;
  readonly failures: FailureMemory;
  readonly sessions: SessionMemory;
  readonly history: HistoryRecorder;
  retrieve(query: string, options?: RetrieveOptions): Promise<RetrievalResult>;
  count(type?: MemoryType): Promise<number>;
}

export interface RepositoryMemoryLoadResult {
  readonly state: PersistedState;
}

export class RepositoryMemory implements MemoryFacade {
  readonly repository: RepositoryIdentity;
  readonly architecture: ArchitectureMemory;
  readonly conventions: ConventionMemory;
  readonly decisions: DecisionMemory;
  readonly tasks: TaskMemory;
  readonly failures: FailureMemory;
  readonly sessions: SessionMemory;
  readonly history: HistoryRecorder;

  private readonly store: MemoryStore<MemoryRecord>;
  private readonly persistence: MemoryPersistence;
  private readonly ctx: MemoryContext;
  private readonly gcConfig: GcConfig;
  private readonly autoSave: boolean;
  private readonly summarizer: Summarizer;
  private saveTail: Promise<unknown> = Promise.resolve();
  private lastSaveError: unknown = null;
  private dirty = false;
  private loaded = false;
  private disposed = false;
  private lastRecovery: string | null = null;

  constructor(options: RepositoryMemoryOptions) {
    this.repository = options.repository;
    this.autoSave = options.autoSave ?? true;
    this.gcConfig = options.gc ?? {};
    this.summarizer = options.summarizer ?? new DeterministicSummarizer();
    const now = options.clock ?? Date.now;
    const idFactory = options.idFactory ?? defaultIdFactory();
    this.ctx = { repositoryId: this.repository.id, now, id: idFactory };
    this.store =
      options.store ??
      new MemoryStore<MemoryRecord>({
        now,
        onMutation: (op) => {
          if (this.autoSave && this.loaded && !this.disposed) {
            void this.markDirty(op);
          }
        },
      });
    this.persistence =
      options.persistence ??
      new MemoryPersistence({
        baseDir: options.baseDir ?? join(process.cwd(), DEFAULT_MEMORY_DIR),
        repositoryId: this.repository.id,
        now,
        strict: options.strictPersistence ?? false,
      });
    this.architecture = new ArchitectureMemory(this.repository.id, this.store, this.ctx);
    this.conventions = new ConventionMemory(this.repository.id, this.store, this.ctx);
    this.decisions = new DecisionMemory(this.repository.id, this.store, this.ctx);
    this.tasks = new TaskMemory(this.repository.id, this.store, this.ctx);
    this.failures = new FailureMemory(this.repository.id, this.store, this.ctx);
    this.sessions = new SessionMemory(this.repository.id, this.store, this.ctx);
    this.history = new HistoryRecorder({
      repositoryId: this.repository.id,
      store: this.store,
      ctx: this.ctx,
    });
  }

  /** Load persisted records into memory. Safe to call more than once. */
  async load(): Promise<RepositoryMemoryLoadResult> {
    const state = await this.persistence.load();
    await this.store.clear();
    await this.store.putMany(state.records);
    this.loaded = true;
    this.dirty = false;
    this.lastRecovery = state.recovered ? state.recoveryReason : null;
    return { state };
  }

  /** True after a load detected and recovered from a corrupt store file. */
  get recovered(): boolean {
    return this.lastRecovery !== null;
  }

  get recoveryReason(): string | null {
    return this.lastRecovery;
  }

  /** Serialize the current in-memory state to disk (atomic). */
  async save(): Promise<void> {
    await this.persistence.save(await this.store.list());
    this.dirty = false;
    this.lastSaveError = null;
  }

  /**
   * Await any pending auto-saves. Throws the first persistence failure that
   * occurred during auto-save, so callers can surface storage errors without
   * the auto-save chain silently stalling.
   */
  async flush(): Promise<void> {
    await this.saveTail;
    if (this.lastSaveError !== null) {
      throw this.lastSaveError;
    }
  }

  /**
   * Flush pending writes and stop auto-saving. Safe to call more than once.
   * Later mutations are kept in memory but are no longer persisted.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    await this.flush();
    this.disposed = true;
  }

  private async markDirty(_op: string): Promise<void> {
    this.dirty = true;
    const run = this.saveTail.then(async () => {
      if (!this.dirty) return;
      this.dirty = false;
      try {
        await this.persistence.save(await this.store.list());
        this.lastSaveError = null;
      } catch (error) {
        // Record the first failure so flush() can surface it, but keep the
        // chain alive so later auto-saves still run.
        if (this.lastSaveError === null) this.lastSaveError = error;
      }
    });
    this.saveTail = run;
    await run;
  }

  // ── Generic record operations (repository-scoped) ──────────────────────

  /** Put a fully-formed record after enforcing repository scope. */
  async put(record: MemoryRecord): Promise<MemoryRecord> {
    assertScoped(this.repository.id, record);
    await this.store.put(record);
    return record;
  }

  /** Build and put a generic record from raw fields. */
  async addMemory<T extends MemoryType>(
    type: T,
    input: {
      readonly title: string;
      readonly data: PayloadByType[T];
      readonly id?: string;
      readonly confidence?: number;
      readonly importance?: number;
      readonly tags?: readonly string[];
    },
  ): Promise<MemoryRecord & { readonly type: T }> {
    const record = buildMemoryRecord(
      this.ctx,
      type,
      input.title,
      input.data,
      {
        id: input.id,
        confidence: input.confidence,
        importance: input.importance,
        tags: input.tags,
      },
    );
    await this.store.put(record);
    return record as MemoryRecord & { readonly type: T };
  }

  async get(id: string): Promise<MemoryRecord | null> {
    return this.store.get(id);
  }

  async getOrThrow(id: string): Promise<MemoryRecord> {
    const record = await this.get(id);
    if (!record) throw new NotFoundError(id);
    return record;
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  /** All records (optionally of one type), sorted by id. */
  async list(type?: MemoryType): Promise<readonly MemoryRecord[]> {
    const records = await this.store.list();
    if (type === undefined) return records;
    return records.filter((record) => record.type === type);
  }

  async count(type?: MemoryType): Promise<number> {
    return this.store.countWhere((record) =>
      type === undefined ? true : record.type === type,
    );
  }

  /** Deterministic retrieval across all scoped records. */
  async retrieve(
    query: string,
    options: RetrieveOptions = {},
  ): Promise<RetrievalResult> {
    const records = await this.store.list();
    return retrieve({
      query,
      repositoryId: this.repository.id,
      records,
      options,
    });
  }

  /** Primitive text search over scoped records (unsorted; see retrieve). */
  async search(query: string, limit?: number): Promise<readonly MemoryRecord[]> {
    const result = await this.store.search({
      query,
      limit,
      textOf: memoryText,
      predicate: (record) => record.repositoryId === this.repository.id,
    });
    return result.records;
  }

  /** Remove every record for this repository; returns the count removed. */
  async clear(type?: MemoryType): Promise<number> {
    const records = await this.store.list();
    let removed = 0;
    for (const record of records) {
      if (type === undefined || record.type === type) {
        await this.store.delete(record.id);
        removed += 1;
      }
    }
    return removed;
  }

  // ── Garbage collection & summarization ─────────────────────────────────

  async garbageCollect(config: GcConfig = {}): Promise<GcResult> {
    const records = await this.store.list();
    const result = collectGarbage(records, { ...this.gcConfig, ...config });
    await this.store.clear();
    for (const record of result.remaining) {
      await this.store.put(record);
    }
    return result;
  }

  summarize(record: MemoryRecord): string {
    return this.summarizer.summarize(record);
  }

  summarizeAll(): Promise<string> {
    return this.store.list().then((records) => this.summarizer.summarizeMany(records));
  }

  digestAll(): Promise<string> {
    return this.store.list().then((records) => this.summarizer.digest(records));
  }

  async persistedBytes(): Promise<number> {
    return this.persistence.persistedBytes();
  }

  /** Create a fresh facade for another repository (isolation helper). */
  static forRepository(
    options: Omit<RepositoryMemoryOptions, "repository"> & {
      readonly repository: RepositoryIdentity;
    },
  ): RepositoryMemory {
    return new RepositoryMemory(options);
  }
}

function assertScoped(repositoryId: string, record: MemoryRecord): void {
  if (record.repositoryId !== repositoryId) {
    throw new RepositoryMismatchError(repositoryId, record.repositoryId);
  }
}