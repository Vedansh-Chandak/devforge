/**
 * @devforge/memory — Generic typed in-memory store (DF-023).
 *
 * Deterministic CRUD + search over records keyed by stable IDs. Reads operate
 * on the current snapshot; every mutation is enqueued through a serial queue
 * so concurrent writers commit in a deterministic (FIFO) order. The store is
 * dependency-free and does not execute commands, touch files, or generate
 * patches.
 */
import { NotFoundError, DuplicateRecordError, ClosedMemoryError } from "./errors.js";
import { compare } from "./ids.js";
import { tokenSet, tokenize, type TokenSet } from "./text.js";

/** A minimal serial queue giving deterministic mutation ordering. */
class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(operation: () => Promise<T> | T): Promise<T> {
    const next = this.tail.then(operation);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

export interface MemoryStoreConfig<R extends { readonly id: string }> {
  /** When true, inserting an existing ID throws instead of upserting. */
  readonly rejectDuplicates?: boolean;
  /** When true, deletes/updates of missing IDs throw instead of no-op. */
  readonly strictMissing?: boolean;
  /** Injected clock; exposed through {@link MemoryStore.now}. */
  readonly now?: () => number;
  /**
   * Called after each successful mutation settles (put, putMany, update,
   * delete, clear, mutate). May be async; awaited inside the queue so save
   * ordering stays deterministic.
   */
  readonly onMutation?: (op: MutationOp) => void | Promise<void>;
}

export type MutationOp =
  | "put"
  | "putMany"
  | "update"
  | "delete"
  | "clear"
  | "mutate";

export interface MemorySearchOptions<R extends { readonly id: string }> {
  readonly query?: string;
  readonly limit?: number;
  readonly predicate?: (record: R) => boolean;
}

export interface MemorySearchResult<R extends { readonly id: string }> {
  readonly records: readonly R[];
  readonly total: number;
}

/**
 * A generic, deterministic, typed memory store. `R` is any record carrying a
 * stable string `id`.
 */
export class MemoryStore<R extends { readonly id: string }> {
  private readonly records = new Map<string, R>();
  private readonly queue = new SerialQueue();
  private readonly config: Required<Omit<MemoryStoreConfig<R>, "now" | "onMutation">> & {
    now: () => number;
    onMutation?: (op: MutationOp) => void | Promise<void>;
  };
  private closed = false;

  constructor(config: MemoryStoreConfig<R> = {}) {
    this.config = {
      rejectDuplicates: config.rejectDuplicates ?? false,
      strictMissing: config.strictMissing ?? false,
      now: config.now ?? Date.now,
      onMutation: config.onMutation,
    };
  }

  private async notifyMutation(op: MutationOp): Promise<void> {
    if (this.config.onMutation) {
      await this.config.onMutation(op);
    }
  }

  now(): number {
    return this.config.now();
  }

  private assertOpen(): void {
    if (this.closed) throw new ClosedMemoryError();
  }

  /** PKI-style deterministic ordering for list output. */
  private sorted(records: Iterable<R>): R[] {
    return Array.from(records).sort((a, b) => compare(a.id, b.id));
  }

  /** Wrap a synchronous read so closed-store errors reject rather than throw. */
  private read<T>(fn: () => T): Promise<T> {
    try {
      this.assertOpen();
      return Promise.resolve(fn());
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /** Insert or replace a record. Duplicates resolve deterministically. */
  put(record: R): Promise<R> {
    return this.queue.run(async () => {
      this.assertOpen();
      const existing = this.records.get(record.id);
      if (existing && this.config.rejectDuplicates) {
        throw new DuplicateRecordError(
          record.id,
          `Record already exists with id ${record.id}`,
        );
      }
      this.records.set(record.id, record);
      await this.notifyMutation("put");
      return record;
    });
  }

  /** Insert many records; duplicates are upserted deterministically. */
  putMany(records: readonly R[]): Promise<number> {
    return this.queue.run(async () => {
      this.assertOpen();
      for (const record of records) {
        const existing = this.records.get(record.id);
        if (existing && this.config.rejectDuplicates) {
          throw new DuplicateRecordError(
            record.id,
            `Record already exists with id ${record.id}`,
          );
        }
        this.records.set(record.id, record);
      }
      await this.notifyMutation("putMany");
      return records.length;
    });
  }

  get(id: string): Promise<R | null> {
    return this.read(() => this.records.get(id) ?? null);
  }

  getOrThrow(id: string): Promise<R> {
    return this.get(id).then((record) => {
      if (!record) throw new NotFoundError(id);
      return record;
    });
  }

  has(id: string): Promise<boolean> {
    return this.get(id).then((record) => record !== null);
  }

  /**
   * Deterministic update: applies a pure patch function to the current
   * record. When `strictMissing` is set, a missing ID throws.
   */
  update(
    id: string,
    patch: (current: R) => R,
    options: { upsert?: R } = {},
  ): Promise<R> {
    return this.queue.run(async () => {
      this.assertOpen();
      let current = this.records.get(id);
      if (!current) {
        if (options.upsert) {
          current = options.upsert;
        } else if (this.config.strictMissing) {
          throw new NotFoundError(id);
        }
      }
      if (!current) throw new NotFoundError(id);
      const next = patch(current);
      this.records.set(id, next);
      await this.notifyMutation("update");
      return next;
    });
  }

  delete(id: string): Promise<boolean> {
    return this.queue.run(async () => {
      this.assertOpen();
      const existed = this.records.delete(id);
      if (this.config.strictMissing && !existed) throw new NotFoundError(id);
      await this.notifyMutation("delete");
      return existed;
    });
  }

  /** All records sorted by id ascending. Deterministic. */
  list(): Promise<readonly R[]> {
    return this.read(() => this.sorted(this.records.values()));
  }

  /** All records matching a predicate, sorted by id ascending. */
  find(predicate: (record: R) => boolean): Promise<readonly R[]> {
    return this.read(() => {
      const matches: R[] = [];
      for (const record of this.records.values()) {
        if (predicate(record)) matches.push(record);
      }
      return this.sorted(matches);
    });
  }

  /**
   * Primitive deterministic search: text-token matching plus predicate.
   * Uses the injected {@link textOf} mapping. Results are sorted by id;
   * ranking semantics live in retrieval.ts.
   */
  search(
    options: MemorySearchOptions<R> & { textOf: (record: R) => string },
  ): Promise<MemorySearchResult<R>> {
    return this.read(() => {
      const queryTokens = options.query ? tokenize(options.query) : [];
      const limit = options.limit ?? Number.POSITIVE_INFINITY;
      const matches: R[] = [];
      const querySet = new Set(queryTokens);
      for (const record of this.records.values()) {
        if (options.predicate && !options.predicate(record)) continue;
        if (queryTokens.length > 0) {
          const target = options.textOf(record);
          const { lookups } = tokenSet(target);
          let hit = false;
          for (const token of querySet) {
            if (lookups.has(token)) {
              hit = true;
              break;
            }
          }
          if (!hit) continue;
        }
        matches.push(record);
      }
      this.sorted(matches);
      return {
        records: matches.slice(0, limit),
        total: matches.length,
      };
    });
  }

  /** Count all records. */
  count(): Promise<number> {
    return this.read(() => this.records.size);
  }

  countWhere(predicate: (record: R) => boolean): Promise<number> {
    return this.read(() => {
      let total = 0;
      for (const record of this.records.values()) {
        if (predicate(record)) total += 1;
      }
      return total;
    });
  }

  /** Remove every record; returns the number removed. */
  clear(): Promise<number> {
    return this.queue.run(async () => {
      this.assertOpen();
      const size = this.records.size;
      this.records.clear();
      await this.notifyMutation("clear");
      return size;
    });
  }

  /** Take a read-only snapshot array (sorted by id). */
  snapshot(): readonly R[] {
    return this.sorted(this.records.values());
  }

  /** Run an arbitrary read over the live snapshot, deterministically. */
  withSnapshot<T>(fn: (records: readonly R[]) => T): T {
    return fn(this.sorted(this.records.values()));
  }

  /** Atomically enqueue a batch operation over the live snapshot. */
  mutate<T>(fn: (mutation: StoreMutation<R>) => T): Promise<T> {
    return this.queue.run(async () => {
      this.assertOpen();
      const result = fn(new StoreMutation(this.records));
      await this.notifyMutation("mutate");
      return result;
    });
  }

  /** Freeze the store; future mutations throw {@link ClosedMemoryError}. */
  close(): void {
    this.closed = true;
  }

  isClosed(): boolean {
    return this.closed;
  }
}

/** Lower-level mutation handle backing {@link MemoryStore.mutate}. */
export class StoreMutation<R extends { readonly id: string }> {
  private readonly records: Map<string, R>;

  constructor(records: Map<string, R>) {
    this.records = records;
  }

  raw(): ReadonlyMap<string, R> {
    return this.records;
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  get(id: string): R | null {
    return this.records.get(id) ?? null;
  }

  set(record: R): void {
    this.records.set(record.id, record);
  }

  delete(id: string): void {
    this.records.delete(id);
  }

  assign(newRecords: Map<string, R>): void {
    this.records.clear();
    for (const [id, record] of newRecords) {
      this.records.set(id, record);
    }
  }
}

export type { TokenSet };