/**
 * @devforge/memory — Session memory (DF-023).
 *
 * Summarized agent sessions scoped to the repository: what was asked, what was
 * done, the outcome, and important discoveries worth remembering.
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
import { MemoryStore } from "./memory-store.js";

export interface SessionInput {
  readonly title: string;
  readonly sessionId: string;
  readonly userRequest: string;
  readonly actions?: readonly string[];
  readonly result: string;
  readonly discoveries?: readonly string[];
  readonly confidence?: number;
  readonly importance?: number;
  readonly tags?: readonly string[];
  readonly source?: string;
  readonly id?: string;
  readonly createdAt?: number;
  readonly updatedAt?: number;
}

export type SessionPatch = TypePatch<
  SessionInput,
  "title" | "sessionId" | "userRequest" | "actions" | "result" | "discoveries"
>;

/** Pure deterministic builder for a session record. */
export function buildSessionRecord(
  ctx: MemoryContext,
  input: SessionInput,
): MemoryRecordOf<"session"> {
  if (!input.title || input.title.trim().length === 0) {
    throw new InvalidRecordError("Session memory requires a title.");
  }
  if (!input.sessionId || input.sessionId.trim().length === 0) {
    throw new InvalidRecordError("Session memory requires a session id.");
  }
  if (!input.userRequest || input.userRequest.trim().length === 0) {
    throw new InvalidRecordError("Session memory requires a user request.");
  }
  return buildMemoryRecord(
    ctx,
    "session",
    input.title,
    {
      sessionId: input.sessionId,
      userRequest: input.userRequest,
      actions: [...(input.actions ?? [])],
      result: input.result || "",
      discoveries: [...(input.discoveries ?? [])],
    },
    toBuildOptions(input),
  );
}

/** Repository-scoped facade for session memories. */
export class SessionMemory extends TypedRepositoryMemory<"session"> {
  constructor(
    repositoryId: string,
    store: MemoryStore<MemoryRecord>,
    ctx: MemoryContext,
  ) {
    super(repositoryId, store, ctx);
  }

  protected type(): "session" {
    return "session";
  }

  async add(input: SessionInput): Promise<MemoryRecordOf<"session">> {
    return this.put(buildSessionRecord(this.ctx, input));
  }

  /** The most recent session, or null. */
  async latest(): Promise<MemoryRecordOf<"session"> | null> {
    const all = await this.list();
    if (all.length === 0) return null;
    const sorted = Array.from(all).sort((a, b) => b.updatedAt - a.updatedAt);
    return sorted[0] ?? null;
  }
}

function toBuildOptions(input: SessionInput): RecordBuildOptions {
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