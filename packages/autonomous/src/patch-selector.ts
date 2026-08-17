/**
 * @devforge/autonomous — Patch selector (DF-019).
 *
 * Ranks generated patches deterministically and selects the highest-confidence
 * subset, dropping lower-confidence or conflicting patches. Ordering is fully
 * deterministic so the same input always selects the same output.
 */

import type { CodePatch } from '@devforge/execution';
import type { ConfidenceScore } from './types.js';
import type { ConfidenceContext, ConfidenceEvaluator } from './confidence.js';
import { maxConfidence } from './confidence.js';

/** A patch plus its awarded confidence score. */
export interface ScoredPatch {
  readonly patch: CodePatch;
  readonly score: ConfidenceScore;
}

/** A selected patch with its deterministic rank. */
export interface SelectedPatch {
  readonly patch: CodePatch;
  readonly score: ConfidenceScore;
  /** 1-based selection rank (highest confidence first). */
  readonly order: number;
}

/** Result of a selection pass. */
export interface PatchSelectionResult {
  readonly selected: readonly SelectedPatch[];
  readonly rejected: readonly ScoredPatch[];
  /** Files dropped because another patch claimed them. */
  readonly conflicts: readonly string[];
}

/** Contextful options accepted by selectors. */
export interface SelectorOptions {
  readonly context?: Omit<ConfidenceContext, 'attempt'> & { readonly attempt?: number };
  readonly scores?: readonly ConfidenceScore[];
}

/** Deterministic selection interface. */
export interface PatchSelector {
  readonly name?: string;
  select(patches: readonly CodePatch[], options?: SelectorOptions): PatchSelectionResult;
}

/** Default contexts when omitted. */

/** Drop duplicates while preserving first occurrence (by file). */
function uniqueFiles(patches: readonly CodePatch[]): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const patch of patches) {
    if (!seen.has(patch.file)) {
      seen.add(patch.file);
      files.push(patch.file);
    }
  }
  return files;
}

/** Stable ranking comparison. Higher confidence, higher impact, then file/id. */
function compareScored(a: ScoredPatch, b: ScoredPatch): number {
  const byConfidence = b.score.confidence - a.score.confidence;
  if (byConfidence !== 0) return byConfidence;
  const byImpact = b.score.estimatedImpact - a.score.estimatedImpact;
  if (byImpact !== 0) return byImpact;
  const byFile = a.patch.file.localeCompare(b.patch.file, 'en');
  if (byFile !== 0) return byFile;
  return a.patch.id.localeCompare(b.patch.id, 'en');
}

/** Deterministic selection engine with optional per-file conflict prevention. */
export class DeterministicPatchSelector implements PatchSelector {
  readonly name = 'deterministic';

  constructor(
    private readonly evaluator: ConfidenceEvaluator,
    private readonly allowSameFile = false,
  ) {}

  select(patches: readonly CodePatch[], options: SelectorOptions = {}): PatchSelectionResult {
    const context: ConfidenceContext = {
      goal: options.context?.goal ?? '',
      attempt: options.context?.attempt ?? 1,
      failures: options.context?.failures ?? 0,
      existingFiles: options.context?.existingFiles,
    };
    const scored: ScoredPatch[] = patches.map((patch, index) => {
      const score = options.scores?.[index] ?? this.evaluator.evaluate([patch], context);
      return { patch, score };
    });

    const ordered = [...scored].sort(compareScored);
    const selected: SelectedPatch[] = [];
    const rejected: ScoredPatch[] = [];
    const conflicts: string[] = [];
    const claimed = new Set<string>();

    for (const entry of ordered) {
      if (!this.allowSameFile && claimed.has(entry.patch.file)) {
        rejected.push(entry);
        conflicts.push(entry.patch.file);
        continue;
      }
      claimed.add(entry.patch.file);
      selected.push({ patch: entry.patch, score: entry.score, order: selected.length + 1 });
    }

    return { selected, rejected, conflicts };
  }
}

/** Select the single highest-confidence patch from a batch. */
export function selectBestPatch(
  patches: readonly CodePatch[],
  evaluator: ConfidenceEvaluator,
  context: ConfidenceContext,
): ScoredPatch | null {
  if (patches.length === 0) return null;
  const scored = patches.map((patch) => ({
    patch,
    score: evaluator.evaluate([patch], context),
  }));
  scored.sort(compareScored);
  return scored[0] as ScoredPatch;
}

/** Aggregate (best) confidence across a selection result, or null when empty. */
export function selectionConfidence(result: PatchSelectionResult): ConfidenceScore | null {
  return maxConfidence(result.selected.map((entry) => entry.score));
}

/** Report which files were targeted by the selected patches. */
export function selectedFiles(result: PatchSelectionResult): readonly string[] {
  return uniqueFiles(result.selected.map((entry) => entry.patch));
}