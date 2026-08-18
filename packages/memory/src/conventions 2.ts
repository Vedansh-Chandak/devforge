/**
 * @devforge/memory — Coding conventions (DF-023).
 *
 * Repository-specific conventions, e.g. "use pnpm", "use Vitest", "single
 * quotes". Conventions are only ever stored when explicitly supplied; the
 * package never invents them. Duplicate conventions (same category + text)
 * collapse to the same deterministic ID.
 */
import {
  buildMemoryRecord,
  TypedRepositoryMemory,
  type MemoryContext,
  type RecordBuildOptions,
} from "./record-builder.js";
import type { TypePatch } from "./type-common.js";
import { InvalidRecordError } from "./errors.js";
import type { MemoryRecord, MemoryRecordOf } from "./types.js";
import { CONVENTION_CATEGORIES, type ConventionCategory } from "./types.js";
import { MemoryStore } from "./memory-store.js";

export interface ConventionInput {
  readonly title: string;
  readonly category: ConventionCategory;
  /** The convention itself, e.g. "use pnpm". */
  readonly convention: string;
  readonly confidence?: number;
  readonly importance?: number;
  readonly tags?: readonly string[];
  readonly source?: string;
  readonly id?: string;
  readonly createdAt?: number;
  readonly updatedAt?: number;
}

export type ConventionPatch = TypePatch<
  ConventionInput,
  "title" | "category" | "convention"
>;

/** Pure deterministic builder for a convention record. */
export function buildConventionRecord(
  ctx: MemoryContext,
  input: ConventionInput,
): MemoryRecordOf<"convention"> {
  if (!input.title || input.title.trim().length === 0) {
    throw new InvalidRecordError("Convention memory requires a title.");
  }
  if (!(CONVENTION_CATEGORIES as readonly string[]).includes(input.category)) {
    throw new InvalidRecordError(
      `Unknown convention category: ${String(input.category)}`,
    );
  }
  if (!input.convention || input.convention.trim().length === 0) {
    throw new InvalidRecordError("Convention memory requires content.");
  }
  return buildMemoryRecord(
    ctx,
    "convention",
    input.title,
    { category: input.category, convention: input.convention },
    toBuildOptions(input),
  );
}

/** Repository-scoped facade for convention memories. */
export class ConventionMemory extends TypedRepositoryMemory<"convention"> {
  constructor(
    repositoryId: string,
    store: MemoryStore<MemoryRecord>,
    ctx: MemoryContext,
  ) {
    super(repositoryId, store, ctx);
  }

  protected type(): "convention" {
    return "convention";
  }

  async add(input: ConventionInput): Promise<MemoryRecordOf<"convention">> {
    return this.put(buildConventionRecord(this.ctx, input));
  }

  async update(
    id: string,
    patch: ConventionPatch,
  ): Promise<MemoryRecordOf<"convention">> {
    const current = await this.getOrThrow(id);
    return this.put(
      buildConventionRecord(
        this.ctx,
        {
          title: patch.title ?? current.title,
          category: patch.category ?? current.data.category,
          convention: patch.convention ?? current.data.convention,
          id: current.id,
          createdAt: current.createdAt,
          updatedAt: this.ctx.now(),
          confidence: patch.confidence ?? current.confidence,
          importance: patch.importance ?? current.importance,
          tags: patch.tags ?? current.tags,
          source: patch.source ?? current.source,
        },
      ),
    );
  }
}

function toBuildOptions(input: ConventionInput): RecordBuildOptions {
  return {
    id: input.id,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    confidence: input.confidence,
    importance: input.importance,
    tags: input.tags,
    source: input.source,
  };
}