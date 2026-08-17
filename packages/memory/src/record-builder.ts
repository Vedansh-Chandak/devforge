/**
 * @devforge/memory — Record construction and typed store access (DF-023).
 *
 * Shared, deterministic building blocks used by the architecture, convention,
 * decision, task, failure, and session modules. Default IDs derive from
 * repository + type + content so identical records collapse deterministically.
 */
import { sha256, compare } from "./ids.js";
import { contentHash } from "./text.js";
import { MemoryStore } from "./memory-store.js";
import {
  assertMemoryType,
  NotFoundError,
} from "./errors.js";
import {
  DEFAULT_CONFIDENCE,
  DEFAULT_IMPORTANCE,
  type IdInput,
  type MemoryRecord,
  type MemoryRecordBase,
  type MemoryType,
  type PayloadByType,
} from "./types.js";
import { retrieve, type RetrieveOptions, type RetrievalResult } from "./retrieval.js";

/** Everything a builder needs to fabricate a scoped record. */
export interface MemoryContext {
  readonly repositoryId: string;
  /** Injected clock. */
  readonly now: () => number;
  /** Injected deterministic ID factory. */
  readonly id: (input: IdInput) => string;
}

export interface RecordBuildOptions {
  /** Explicit ID override; bypasses content-derived ids. */
  readonly id?: string;
  readonly createdAt?: number;
  readonly updatedAt?: number;
  readonly confidence?: number;
  readonly importance?: number;
  readonly tags?: readonly string[];
  readonly source?: string;
}

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return DEFAULT_CONFIDENCE;
  if (!Number.isFinite(value)) return value < 0 ? 0 : 1;
  return Math.min(1, Math.max(0, value));
}

/** Default deterministic ID factory over a repository + content seed. */
export function defaultIdFactory(): (input: IdInput) => string {
  return (input) => sha256(`${input.repositoryId}|${input.type}|${input.seed}`);
}

/**
 * Build a fully-tagged memory record. IDs are deterministic: the default is a
 * content hash, so identical records always produce the same ID, and a
 * re-`put` is an idempotent upsert.
 */
export function buildMemoryRecord<T extends MemoryType>(
  ctx: MemoryContext,
  type: T,
  title: string,
  data: PayloadByType[T],
  options: RecordBuildOptions = {},
): MemoryRecord & { readonly type: T } {
  assertMemoryType(type);
  const createdAt = options.createdAt ?? ctx.now();
  const updatedAt = options.updatedAt ?? createdAt;
  const id =
    options.id ??
    ctx.id({
      repositoryId: ctx.repositoryId,
      type,
      seed: contentHash(ctx.repositoryId, type, title, data),
    });
  const tags = Array.from(new Set(options.tags ?? []));
  const record: MemoryRecordBase<PayloadByType[T]> = {
    id,
    type,
    repositoryId: ctx.repositoryId,
    title,
    createdAt,
    updatedAt,
    confidence: clamp01(options.confidence ?? DEFAULT_CONFIDENCE),
    importance: clamp01(options.importance ?? DEFAULT_IMPORTANCE),
    tags: tags.sort(compare),
    ...(options.source !== undefined ? { source: options.source } : {}),
    data,
  };
  return record as unknown as MemoryRecord & { readonly type: T };
}

/**
 * A typed, repository-scoped access facade sharing deterministic CRUD and
 * retrieval across every memory type. Subclass modules add typed payloads.
 */
export abstract class TypedRepositoryMemory<T extends MemoryType> {
  protected readonly ctx: MemoryContext;
  protected readonly store: MemoryStore<MemoryRecord>;

  constructor(
    repositoryId: string,
    store: MemoryStore<MemoryRecord>,
    ctx: MemoryContext,
  ) {
    this.ctx = { ...ctx, repositoryId };
    this.store = store;
  }

  get repositoryId(): string {
    return this.ctx.repositoryId;
  }

  private matches(record: MemoryRecord): record is MemoryRecord & { type: T } {
    return record.repositoryId === this.ctx.repositoryId && record.type === this.type();
  }

  protected abstract type(): T;

  protected put(record: MemoryRecord): Promise<MemoryRecord & { type: T }> {
    return this.store.put(record) as Promise<MemoryRecord & { type: T }>;
  }

  async get(id: string): Promise<(MemoryRecord & { type: T }) | null> {
    const record = await this.store.get(id);
    if (!record || !this.matches(record)) return null;
    return record;
  }

  async getOrThrow(id: string): Promise<MemoryRecord & { type: T }> {
    const record = await this.get(id);
    if (!record) throw new NotFoundError(id);
    return record;
  }

  async updateRecord(
    id: string,
    updateWith: (current: MemoryRecord & { type: T }) => MemoryRecord & { type: T },
    options: { upsert?: MemoryRecord & { type: T } } = {},
  ): Promise<MemoryRecord & { type: T }> {
    const current = await this.get(id);
    const base = current ?? options.upsert;
    if (!base) throw new NotFoundError(id);
    return this.put(updateWith(base));
  }

  async delete(id: string): Promise<boolean> {
    const record = await this.store.get(id);
    if (!record || !this.matches(record)) return false;
    return this.store.delete(id);
  }

  /** All records of this type for this repository, sorted by id. */
  async list(): Promise<readonly (MemoryRecord & { type: T })[]> {
    const records = await this.store.list();
    return records.filter(this.matches.bind(this)) as readonly (MemoryRecord & {
      type: T;
    })[];
  }

  async count(): Promise<number> {
    const records = await this.store.list();
    return records.filter((record) => this.matches(record)).length;
  }

  /** Type-scoped retrieval through the deterministic pipeline. */
  async retrieve(
    query: string,
    options: Omit<RetrieveOptions, "types"> = {},
  ): Promise<RetrievalResult> {
    const records = await this.store.list();
    return retrieve({
      query,
      repositoryId: this.ctx.repositoryId,
      records,
      options: { ...options, types: [this.type()] },
    });
  }

  async clear(): Promise<number> {
    const records = await this.store.list();
    let removed = 0;
    for (const record of records) {
      if (this.matches(record)) {
        await this.store.delete(record.id);
        removed += 1;
      }
    }
    return removed;
  }
}