/**
 * @devforge/memory — Deterministic ranking (DF-023).
 *
 * Pure ranking over memory records. Identical inputs always produce an
 * identical ordering; ties resolve deterministically. No external vector
 * database, no embedding API, fully offline.
 */
import type { MemoryRecord, MemoryType } from "./types.js";
import {
  containsAllTokens,
  containsPhrase,
  jaccard,
  memoryText,
  tokenize,
} from "./text.js";

/** Scoring weights, exported for tests and tuning. */
export const RANKING_WEIGHTS = {
  /** Query phrase appears verbatim in the record title. */
  exactTitle: 100,
  /** Query phrase appears verbatim anywhere in the record text. */
  exactPhrase: 60,
  /** Every query token is present in the record text. */
  allTokens: 45,
  /** Jaccard overlap between query and record tokens. */
  overlap: 30,
  /** Per query tag token present on the record. */
  tagHit: 12,
  /** Query names the record's memory type explicitly. */
  typeExact: 22,
  /** Scaled by the record's confidence. */
  confidence: 18,
  /** Decay factor per week of age (capped). */
  recency: 6,
  /** Flat penalty applied to superseded records. */
  superseded: -45,
} as const;

/** Default per-type weight applied when the query names that type. */
export const DEFAULT_TYPE_WEIGHTS: Readonly<Record<MemoryType, number>> = {
  architecture: 1,
  convention: 1,
  decision: 1.2,
  task: 1,
  failure: 1.1,
  session: 1,
};

const TYPE_WORDS: readonly string[] = [
  "architecture",
  "convention",
  "decision",
  "task",
  "failure",
  "session",
];

/** Everything the scorer needs for one record. */
export interface RankInput {
  readonly record: MemoryRecord;
  readonly query: string;
  readonly now: number;
  /** Optionally boost type weights; merged over {@link DEFAULT_TYPE_WEIGHTS}. */
  readonly typeWeights?: Partial<Record<MemoryType, number>>;
}

/** The scored view of a single record. */
export interface RankedMemory {
  readonly record: MemoryRecord;
  readonly score: number;
  /** Query terms present in the record text or tags. */
  readonly matchedTerms: readonly string[];
  /** Individual signal contributions, for diagnostics and tests. */
  readonly signals: RankedSignals;
}

export interface RankedSignals {
  readonly exactTitle: number;
  readonly exactPhrase: number;
  readonly allTokens: number;
  readonly overlap: number;
  readonly tagHit: number;
  readonly typeExact: number;
  readonly confidence: number;
  readonly recency: number;
  readonly superseded: number;
}

export interface RankedResult {
  readonly score: number;
  readonly matchedTerms: readonly string[];
  readonly signals: RankedSignals;
}

const MAX_WEEKS = 104;

/** Pure score computation for a single record. */
export function scoreRecord(input: RankInput): RankedResult {
  const { record, query, now, typeWeights } = input;
  const text = memoryText(record);
  const queryTokens = tokenize(query);

  const matchedTerms: string[] = [];
  for (const token of queryTokens) {
    if (text.includes(token)) matchedTerms.push(token);
    else if (record.tags.some((tag) => tag.includes(token))) matchedTerms.push(token);
  }

  const titleExact = containsPhrase(query, record.title) ? RANKING_WEIGHTS.exactTitle : 0;
  const phraseExact = containsPhrase(query, text) ? RANKING_WEIGHTS.exactPhrase : 0;
  const allTokens = containsAllTokens(queryTokens, text)
    ? RANKING_WEIGHTS.allTokens
    : 0;

  const overlap =
    jaccard(queryTokens, tokenize(text)) * RANKING_WEIGHTS.overlap;

  const tagSet = record.tags.map((tag) => tag.toLowerCase()).join(" ");
  const tagHit =
    queryTokens.filter((token) => tagSet.includes(token)).length *
    RANKING_WEIGHTS.tagHit;

  const mergedWeights = { ...DEFAULT_TYPE_WEIGHTS, ...typeWeights };
  const namedType = queryTokens.find((token) =>
    (TYPE_WORDS as readonly string[]).includes(token),
  );
  const typeExact =
    namedType !== undefined && namedType === record.type
      ? RANKING_WEIGHTS.typeExact * (mergedWeights[record.type] ?? 1)
      : 0;

  const confidence = record.confidence * RANKING_WEIGHTS.confidence;

  const ageMs = Math.max(0, now - record.createdAt);
  const ageWeeks = ageMs / (7 * 24 * 60 * 60 * 1000);
  const recentFactor = Math.max(0, (MAX_WEEKS - ageWeeks) / MAX_WEEKS);
  const recency = recentFactor * RANKING_WEIGHTS.recency;

  const superseded = record.supersededBy ? RANKING_WEIGHTS.superseded : 0;

  const score =
    titleExact +
    phraseExact +
    allTokens +
    overlap +
    tagHit +
    typeExact +
    confidence +
    recency +
    superseded;

  return {
    score,
    matchedTerms: Array.from(new Set(matchedTerms)).sort(),
    signals: {
      exactTitle: titleExact,
      exactPhrase: phraseExact,
      allTokens,
      overlap,
      tagHit,
      typeExact,
      confidence,
      recency,
      superseded,
    },
  };
}

/**
 * Deterministic ordering: score desc, confidence desc, createdAt desc, id asc.
 * Identical input always yields an identical ordering.
 */
export function compareRanked(
  a: RankedMemory,
  b: RankedMemory,
): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.record.confidence !== b.record.confidence) {
    return b.record.confidence - a.record.confidence;
  }
  if (a.record.createdAt !== b.record.createdAt) {
    return b.record.createdAt - a.record.createdAt;
  }
  if (a.record.id !== b.record.id) {
    return a.record.id < b.record.id ? -1 : 1;
  }
  return 0;
}

/** Rank a list of records for a query. Input order does not matter. */
export function rankRecords(
  inputs: readonly RankInput[],
): readonly RankedMemory[] {
  return inputs
    .map((input) => {
      const result = scoreRecord(input);
      return {
        record: input.record,
        score: result.score,
        matchedTerms: result.matchedTerms,
        signals: result.signals,
      } satisfies RankedMemory;
    })
    .sort(compareRanked);
}