import type { ScoredFile } from "./types.js";

/** Deterministic scoring weights. Exported for tests and documentation. */
export const WEIGHTS = {
  /** Exact symbol-name match against the query. */
  exactSymbol: 100,
  /** Per similar (substring) symbol match, capped. */
  similarSymbol: 8,
  /** Per aggregate reference on matched symbols, capped. */
  reference: 12,
  /** Base credit for any file reachable via the import graph. */
  importReachable: 80,
  /** Credit divided by (importDistance + 1) for near files. */
  importDistance: 80,
  /** Per query token appearing in the file's path segments. */
  pathHit: 20,
  /** Per shared leading path segment with the query anchor. */
  folderDepth: 15,
  /** Flat bonus for a file that was recently modified. */
  recentlyChanged: 15,
  /** Caps applied before a signal saturates. */
  capSimilar: 5,
  capReference: 8,
  capFolder: 6,
} as const;

/** Per-file relevance signals computed by the context service. */
export interface RankInput {
  readonly filePath: string;
  readonly hasExactMatch: boolean;
  readonly similarSymbolCount: number;
  readonly referenceCount: number;
  /** Shortest import distance to a matched file; null when unreachable. */
  readonly importDistance: number | null;
  /** Query tokens present in the file's path segments. */
  readonly pathHits: number;
  /** Number of leading path segments shared with the anchor file. */
  readonly sharedFolderDepth: number;
  readonly recentlyChanged: boolean;
}

/** Pure, deterministic score for a single file given its signals. */
export function scoreFile(input: RankInput): number {
  const exact = input.hasExactMatch ? WEIGHTS.exactSymbol : 0;
  const similar =
    Math.min(input.similarSymbolCount, WEIGHTS.capSimilar) * WEIGHTS.similarSymbol;
  const reference =
    Math.min(input.referenceCount, WEIGHTS.capReference) * WEIGHTS.reference;
  const importCredit =
    input.importDistance === null
      ? 0
      : WEIGHTS.importReachable + WEIGHTS.importDistance / (input.importDistance + 1);
  const pathCredit = Math.min(input.pathHits, 3) * WEIGHTS.pathHit;
  const folderCredit =
    Math.min(input.sharedFolderDepth, WEIGHTS.capFolder) * WEIGHTS.folderDepth;
  const recentCredit = input.recentlyChanged ? WEIGHTS.recentlyChanged : 0;

  return exact + similar + reference + importCredit + pathCredit + folderCredit + recentCredit;
}

function toScoredFile(input: RankInput): ScoredFile {
  return {
    filePath: input.filePath,
    score: scoreFile(input),
    hasExactMatch: input.hasExactMatch,
    referenceCount: input.referenceCount,
    importDistance: input.importDistance,
    folderProximity: input.sharedFolderDepth,
    pathSimilarity: input.pathHits,
    recentlyChanged: input.recentlyChanged,
  };
}

/** Deterministic ordering: descending score, ascending path on ties. */
export function rankFiles(inputs: ReadonlyArray<RankInput>): ScoredFile[] {
  return inputs
    .map(toScoredFile)
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0;
    });
}