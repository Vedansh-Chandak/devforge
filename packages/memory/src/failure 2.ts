/**
 * @devforge/memory — Failure history (DF-023).
 *
 * Records failures with a deterministic fingerprint (same error → same
 * fingerprint → same ID), error category, affected subsystem, attempted
 * solution, and resolution status, so repeated failures can be reasoned about
 * and future repairs can be recalled.
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
import { FAILURE_RESULTS, type FailureResult } from "./types.js";
import { MemoryStore } from "./memory-store.js";
import { sha256 } from "./ids.js";

/** A deterministic fingerprint for a failure across occurrences. */
export function failureFingerprint(...parts: readonly string[]): string {
  return sha256(parts.join("|"));
}

export interface FailureInput {
  readonly title: string;
  /** Deterministic key identifying the failure; derived when omitted. */
  readonly fingerprint: string;
  /** Coarse category, e.g. "build", "test", "runtime". */
  readonly errorCategory: string;
  readonly affectedSubsystem: string;
  readonly attemptedSolution: string;
  readonly result: FailureResult;
  readonly confidence?: number;
  readonly importance?: number;
  readonly tags?: readonly string[];
  readonly source?: string;
  readonly id?: string;
  readonly createdAt?: number;
  readonly updatedAt?: number;
}

export type FailurePatch = TypePatch<
  FailureInput,
  | "title"
  | "fingerprint"
  | "errorCategory"
  | "affectedSubsystem"
  | "attemptedSolution"
  | "result"
>;

/** Pure deterministic builder for a failure record. */
export function buildFailureRecord(
  ctx: MemoryContext,
  input: FailureInput,
): MemoryRecordOf<"failure"> {
  if (!input.title || input.title.trim().length === 0) {
    throw new InvalidRecordError("Failure memory requires a title.");
  }
  if (!input.fingerprint || input.fingerprint.trim().length === 0) {
    throw new InvalidRecordError("Failure memory requires a fingerprint.");
  }
  if (!(FAILURE_RESULTS as readonly string[]).includes(input.result)) {
    throw new InvalidRecordError(`Unknown failure result: ${String(input.result)}`);
  }
  return buildMemoryRecord(
    ctx,
    "failure",
    input.title,
    {
      fingerprint: input.fingerprint,
      errorCategory: input.errorCategory || "unknown",
      affectedSubsystem: input.affectedSubsystem || "*",
      attemptedSolution: input.attemptedSolution || "",
      result: input.result,
    },
    toBuildOptions(input),
  );
}

/** Repository-scoped facade for failure memories. */
export class FailureMemory extends TypedRepositoryMemory<"failure"> {
  constructor(
    repositoryId: string,
    store: MemoryStore<MemoryRecord>,
    ctx: MemoryContext,
  ) {
    super(repositoryId, store, ctx);
  }

  protected type(): "failure" {
    return "failure";
  }

  async add(input: FailureInput): Promise<MemoryRecordOf<"failure">> {
    return this.put(buildFailureRecord(this.ctx, input));
  }

  /** Find every record for a fingerprint, newest first. */
  async findByFingerprint(
    fingerprint: string,
  ): Promise<readonly MemoryRecordOf<"failure">[]> {
    const all = await this.list();
    return all
      .filter((record) => record.data.fingerprint === fingerprint)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Mark a previously unresolved failure as resolved. */
  async markResolved(
    id: string,
    attemptedSolution: string,
  ): Promise<MemoryRecordOf<"failure">> {
    return this.updateRecord(id, (current) =>
      buildFailureRecord(
        this.ctx,
        {
          title: current.title,
          fingerprint: current.data.fingerprint,
          errorCategory: current.data.errorCategory,
          affectedSubsystem: current.data.affectedSubsystem,
          attemptedSolution,
          result: "resolved",
          id: current.id,
          createdAt: current.createdAt,
          updatedAt: this.ctx.now(),
          confidence: current.confidence,
          importance: current.importance,
          tags: current.tags,
          source: current.source,
        },
      ),
    );
  }
}

function toBuildOptions(input: FailureInput): RecordBuildOptions {
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