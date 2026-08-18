/**
 * @devforge/memory — Architecture knowledge (DF-023).
 *
 * Records repository structure, module ownership, subsystem relationships, and
 * constraints. The facade exposes add/update/get/delete/list over typed,
 * repository-scoped records.
 */
import {
  buildMemoryRecord,
  TypedRepositoryMemory,
  type MemoryContext,
  type RecordBuildOptions,
} from "./record-builder.js";
import type { TypePatch } from "./type-common.js";
import type { MemoryRecord, MemoryRecordOf } from "./types.js";
import { MemoryStore } from "./memory-store.js";
import { InvalidRecordError } from "./errors.js";

export interface ArchitectureInput {
  readonly title: string;
  /** The module, package, or subsystem the fact is about. */
  readonly owner: string;
  /** One-line statement of the owner's responsibility. */
  readonly responsibility: string;
  readonly constraints?: readonly string[];
  readonly confidence?: number;
  readonly importance?: number;
  readonly tags?: readonly string[];
  readonly source?: string;
  readonly id?: string;
  readonly createdAt?: number;
  readonly updatedAt?: number;
}

export type ArchitecturePatch = TypePatch<
  ArchitectureInput,
  "title" | "owner" | "responsibility" | "constraints"
>;

/** Pure, deterministic builder for an architecture record. */
export function buildArchitectureRecord(
  ctx: MemoryContext,
  input: ArchitectureInput,
): MemoryRecordOf<"architecture"> {
  if (!input.title || input.title.trim().length === 0) {
    throw new InvalidRecordError("Architecture memory requires a title.");
  }
  if (!input.owner || input.owner.trim().length === 0) {
    throw new InvalidRecordError("Architecture memory requires an owner.");
  }
  if (!input.responsibility || input.responsibility.trim().length === 0) {
    throw new InvalidRecordError("Architecture memory requires a responsibility.");
  }
  return buildMemoryRecord(
    ctx,
    "architecture",
    input.title,
    {
      owner: input.owner,
      responsibility: input.responsibility,
      constraints: [...(input.constraints ?? [])],
    },
    toBuildOptions(input),
  );
}

/** Repository-scoped facade for architecture memories. */
export class ArchitectureMemory extends TypedRepositoryMemory<"architecture"> {
  constructor(
    repositoryId: string,
    store: MemoryStore<MemoryRecord>,
    ctx: MemoryContext,
  ) {
    super(repositoryId, store, ctx);
  }

  protected type(): "architecture" {
    return "architecture";
  }

  async add(input: ArchitectureInput): Promise<MemoryRecordOf<"architecture">> {
    return this.put(buildArchitectureRecord(this.ctx, input));
  }

  async update(
    id: string,
    patch: ArchitecturePatch,
  ): Promise<MemoryRecordOf<"architecture">> {
    const current = await this.getOrThrow(id);
    const input: ArchitectureInput = {
      title: patch.title ?? current.title,
      owner: patch.owner ?? current.data.owner,
      responsibility: patch.responsibility ?? current.data.responsibility,
      constraints: patch.constraints ?? current.data.constraints,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: this.ctx.now(),
      confidence: patch.confidence ?? current.confidence,
      importance: patch.importance ?? current.importance,
      tags: patch.tags ?? current.tags,
      source: patch.source ?? current.source,
    };
    return this.put(buildArchitectureRecord(this.ctx, input));
  }
}

function toBuildOptions(input: ArchitectureInput): RecordBuildOptions {
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