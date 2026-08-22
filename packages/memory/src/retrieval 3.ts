/**
 * @devforge/memory — Deterministic retrieval (DF-023).
 *
 * Retrieval is a pure pipeline: scope to a repository, filter by memory type,
 * score with {@link scoreRecord}, sort by the deterministic comparator, and
 * slice to a limit. It never executes commands, never calls out to an
 * embedding API, and never touches a vector database.
 */
import type { MemoryRecord, MemoryType } from "./types.js";
import { compareRanked, rankRecords, type RankedMemory } from "./ranking.js";

export interface RetrieveOptions {
  /** Restrict results to the given memory types. */
  readonly types?: readonly MemoryType[];
  /** Maximum number of returned records. */
  readonly limit?: number;
  /** Drop records scoring below this threshold. */
  readonly minScore?: number;
  /** Per-type bonus overrides, as accepted by the ranker. */
  readonly typeWeights?: Partial<Record<MemoryType, number>>;
  /** Clock value for recency scoring (defaults to Date.now()). */
  readonly now?: number;
  /** Keep superseded decisions in results (default true). */
  readonly includeSuperseded?: boolean;
}

export interface RetrievalResult {
  readonly query: string;
  readonly repositoryId: string;
  /** Candidates considered after repository/type filtering. */
  readonly total: number;
  readonly records: readonly RankedMemory[];
  readonly limit: number;
  readonly truncated: boolean;
}

export interface RetrieveInput {
  readonly query: string;
  readonly repositoryId: string;
  readonly records: readonly MemoryRecord[];
  readonly options?: RetrieveOptions;
}

/** Retrieve and rank records for a query, fully deterministically. */
export function retrieve(input: RetrieveInput): RetrievalResult {
  const {
    query,
    repositoryId,
    records,
    options = {},
  } = input;
  const now = options.now ?? Date.now();
  const types = options.types ? new Set(options.types) : null;
  const limit = options.limit ?? 10;
  const minScore = options.minScore ?? Number.NEGATIVE_INFINITY;
  const includeSuperseded = options.includeSuperseded ?? true;

  const candidates: MemoryRecord[] = [];
  for (const record of records) {
    if (record.repositoryId !== repositoryId) continue;
    if (types !== null && !types.has(record.type)) continue;
    if (!includeSuperseded && record.supersededBy) continue;
    candidates.push(record);
  }
  candidates.sort((a, b) => compareRankedIds(a, b));

  const ranked = rankRecords(
    candidates.map((record) => ({
      record,
      query,
      now,
      typeWeights: options.typeWeights,
    })),
  );

  const filtered = ranked.filter((entry) => entry.score >= minScore);
  const sliced = limit === Infinity ? filtered : filtered.slice(0, limit);
  return {
    query,
    repositoryId,
    total: filtered.length,
    records: sliced,
    limit: Number.isFinite(limit) ? limit : filtered.length,
    truncated: sliced.length !== filtered.length,
  };
}

function compareRankedIds(a: MemoryRecord, b: MemoryRecord): number {
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

export type { RankedMemory };