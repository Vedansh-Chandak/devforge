/**
 * Progress detection (DF-011.5 Phase 1).
 *
 * Determines whether a reasoning round produced *new* evidence that was
 * not seen in any earlier round, and tracks the consecutive no-progress
 * streak that ultimately terminates the loop.
 */

import type { EvidenceItem } from './evidence.js';

/**
 * Compute a deterministic key for a piece of evidence. Two evidence items
 * with the same toolId and structurally equal `result` are considered the
 * same evidence — useful for spotting zero-progress rounds.
 */
export function evidenceKey(item: EvidenceItem): string {
  // Cheap + deterministic: toolId + JSON of result.
  // structurally-equal results map to the same key string.
  try {
    return `${item.toolId}::${JSON.stringify(item.result) ?? 'null'}`;
  } catch {
    return `${item.toolId}::<unserialisable>`;
  }
}

/** A pure set of evidence keys seen so far. */
export function toEvidenceKeySet(items: readonly EvidenceItem[]): Set<string> {
  const out = new Set<string>();
  for (const item of items) {
    out.add(evidenceKey(item));
  }
  return out;
}

/**
 * True when `newItems` contains at least one evidence item whose key is
 * absent from `priorItems`. The inputs are never mutated.
 */
export function hasNewEvidence(
  priorItems: readonly EvidenceItem[],
  newItems: readonly EvidenceItem[],
): boolean {
  if (newItems.length === 0) return false;
  const priorKeys = toEvidenceKeySet(priorItems);
  for (const item of newItems) {
    if (!priorKeys.has(evidenceKey(item))) {
      return true;
    }
  }
  return false;
}

/**
 * No-progress streak tracker. Purely functional — each function returns a
 * new streak value instead of mutating.
 */
export function incrementStreak(current: number): number {
  return Number.isFinite(current) && current >= 0 ? current + 1 : 1;
}

/** Reset the streak (progress was made this round). */
export function resetStreak(): number {
  return 0;
}

/** True when the configured no-progress limit has been reached. */
export function hasReachedNoProgressLimit(streak: number, maxNoProgressRounds: number): boolean {
  return streak >= maxNoProgressRounds;
}

/**
 * Convenience: given prior evidence, new evidence, current streak, and
 * limit, return the next streak and whether the limiter has tripped.
 */
export function evaluateProgress(input: {
  readonly priorItems: readonly EvidenceItem[];
  readonly newItems: readonly EvidenceItem[];
  readonly currentStreak: number;
  readonly maxNoProgressRounds: number;
}): { readonly nextStreak: number; readonly reached: boolean; readonly progressed: boolean } {
  const progressed = hasNewEvidence(input.priorItems, input.newItems);
  const nextStreak = progressed ? resetStreak() : incrementStreak(input.currentStreak);
  const reached = hasReachedNoProgressLimit(nextStreak, input.maxNoProgressRounds);
  return { nextStreak, reached, progressed };
}
