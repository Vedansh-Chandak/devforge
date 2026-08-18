/**
 * @devforge/memory — Architecture decisions (DF-023).
 *
 * Historical decision log: decisions are preserved rather than overwritten.
 * A newer decision can {@link supersede} an older one, which links the pair
 * (`supersedes` / `supersededBy`) while keeping the old record in place for
 * history and retrieval. Superseded decisions receive a ranking penalty.
 */
import {
  buildMemoryRecord,
  TypedRepositoryMemory,
  type MemoryContext,
  type RecordBuildOptions,
} from "./record-builder.js";
import type { TypePatch } from "./type-common.js";
import { NotFoundError, InvalidRecordError } from "./errors.js";
import type { MemoryRecord, MemoryRecordOf } from "./types.js";
import { MemoryStore } from "./memory-store.js";

export interface DecisionInput {
  readonly title: string;
  /** The decision statement. */
  readonly decision: string;
  /** Why the decision was made. */
  readonly rationale: string;
  /** The subsystem or area the decision affects. */
  readonly affectedArea: string;
  readonly confidence?: number;
  readonly importance?: number;
  readonly tags?: readonly string[];
  readonly source?: string;
  readonly id?: string;
  readonly createdAt?: number;
  readonly updatedAt?: number;
}

export type DecisionPatch = TypePatch<
  DecisionInput,
  "title" | "decision" | "rationale" | "affectedArea"
>;

/** Pure deterministic builder for a decision record. */
export function buildDecisionRecord(
  ctx: MemoryContext,
  input: DecisionInput,
): MemoryRecordOf<"decision"> {
  if (!input.title || input.title.trim().length === 0) {
    throw new InvalidRecordError("Decision memory requires a title.");
  }
  if (!input.decision || input.decision.trim().length === 0) {
    throw new InvalidRecordError("Decision memory requires a decision.");
  }
  if (!input.rationale || input.rationale.trim().length === 0) {
    throw new InvalidRecordError("Decision memory requires a rationale.");
  }
  return buildMemoryRecord(
    ctx,
    "decision",
    input.title,
    {
      decision: input.decision,
      rationale: input.rationale,
      affectedArea: input.affectedArea ?? "*",
    },
    toBuildOptions(input),
  );
}

export interface SupersedeResult {
  readonly previous: MemoryRecordOf<"decision">;
  readonly current: MemoryRecordOf<"decision">;
}

/** Repository-scoped facade for decision memories. */
export class DecisionMemory extends TypedRepositoryMemory<"decision"> {
  constructor(
    repositoryId: string,
    store: MemoryStore<MemoryRecord>,
    ctx: MemoryContext,
  ) {
    super(repositoryId, store, ctx);
  }

  protected type(): "decision" {
    return "decision";
  }

  async add(input: DecisionInput): Promise<MemoryRecordOf<"decision">> {
    return this.put(buildDecisionRecord(this.ctx, input));
  }

  /** Replace the payload of an existing decision while keeping its identity. */
  async update(
    id: string,
    patch: DecisionPatch,
  ): Promise<MemoryRecordOf<"decision">> {
    const current = await this.getOrThrow(id);
    return this.put(
      buildDecisionRecord(
        this.ctx,
        {
          title: patch.title ?? current.title,
          decision: patch.decision ?? current.data.decision,
          rationale: patch.rationale ?? current.data.rationale,
          affectedArea: patch.affectedArea ?? current.data.affectedArea,
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

  /**
   * Record a new decision that supersedes an older one. The previous decision
   * is preserved (never deleted) and linked via `supersededBy`.
   */
  async supersede(
    previousId: string,
    input: DecisionInput,
  ): Promise<SupersedeResult> {
    const previous = await this.getOrThrow(previousId);
    const currentInput: DecisionInput = {
      ...input,
      tags: [...(input.tags ?? []), "supersedes"],
    };
    const built = buildDecisionRecord(this.ctx, currentInput);
    const current = await this.put({ ...built, supersedes: previous.id });
    await this.store.update(previous.id, (record) => ({
      ...record,
      updatedAt: this.ctx.now(),
      supersededBy: current.id,
    }));
    const after = await this.getOrThrow(previous.id);
    return { previous: after, current };
  }

  /** The currently-active decision for an area, or null when superseded. */
  async activeFor(area: string): Promise<MemoryRecordOf<"decision"> | null> {
    const all = await this.list();
    const candidates = all.filter(
      (record) =>
        record.data.affectedArea === area && !record.supersededBy,
    );
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.createdAt - a.createdAt);
    return candidates[0] ?? null;
  }

  /** All decisions whose history chain includes the given record id. */
  async historyOf(id: string): Promise<readonly MemoryRecordOf<"decision">[]> {
    const all = await this.list();
    const byId = new Map(all.map((record) => [record.id, record]));
    const chain: MemoryRecordOf<"decision">[] = [];
    let cursor: string | undefined = id;
    const visited = new Set<string>();
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      const record = byId.get(cursor);
      if (!record) break;
      chain.push(record);
      cursor = record.supersededBy;
    }
    return chain;
  }
}

function toBuildOptions(input: DecisionInput): RecordBuildOptions {
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

export { NotFoundError };