/**
 * Evidence accumulation (DF-011.5 Phase 1).
 *
 * Tracks cumulative evidence bytes across tool results. Enforces a
 * configurable maxEvidenceBytes budget. When adding an item would exceed
 * the budget, the item is replaced by a deterministic truncation marker.
 *
 * No input arrays are ever mutated — every operation returns new arrays.
 */

/** An evidence item contributed by one tool call. */
export interface EvidenceItem<T = unknown> {
  /** Tool call identifier. */
  readonly callId: string;
  /** Tool identifier. */
  readonly toolId: string;
  /** Raw result (or partial result) as returned by the executor. */
  readonly result?: T;
  /** Error info when the call failed / was denied. */
  readonly error?: { readonly code: string; readonly message: string };
}

/** Byte budget for evidence accumulation. */
export interface EvidenceBudget {
  /** Hard ceiling on cumulative bytes. */
  readonly maxBytes: number;
}

/**
 * Approximate byte size of a value for evidence-accounting purposes.
 * Uses UTF-8 JSON encoding when available. Stable and deterministic.
 */
export function estimateBytes(value: unknown): number {
  try {
    const s = JSON.stringify(value);
    return s ? s.length : 0;
  } catch {
    // JSON.stringify can throw on circular / BigInt — treat as 0 (no evidence).
    return 0;
  }
}

/** Truncation marker inserted when an evidence item exceeds remaining budget. */
export interface TruncatedEvidence {
  readonly truncated: true;
  readonly message: string;
  readonly originalBytes: number;
}

/** A deterministic truncation marker. */
export function buildTruncationMarker(originalBytes: number, maxBytes: number): TruncatedEvidence {
  return {
    truncated: true,
    message: `[Result truncated — exceeds ${maxBytes} byte evidence budget]`,
    originalBytes,
  };
}

/** Guard for truncation markers. */
export function isTruncatedEvidence(value: unknown): value is TruncatedEvidence {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { truncated?: unknown }).truncated === true &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}

/**
 * Append an item to the accumulator, enforcing the byte budget.
 * Returns a new accumulator — does NOT mutate the input array.
 *
 * If the item would exceed the budget, a deterministic truncation marker
 * is appended instead of the raw result. Once truncation has occurred,
 * all subsequent items are also truncated (deterministic tail behaviour).
 */
export function appendEvidence<T>(
  accumulated: readonly EvidenceItem[],
  item: EvidenceItem<T>,
  budget: EvidenceBudget,
): EvidenceItem[] {
  const itemBytes = estimateBytes(item.result);
  const usedBytes = accumulated.reduce((sum, e) => sum + estimateBytes(e.result), 0);
  const remaining = budget.maxBytes - usedBytes;

  const result: EvidenceItem['result'] =
    itemBytes > 0 && itemBytes > remaining
      ? buildTruncationMarker(itemBytes, budget.maxBytes)
      : item.result;

  return [...accumulated, { ...item, result }];
}

/**
 * Total bytes currently accumulated. Pure viewer — does not modify input.
 */
export function totalEvidenceBytes(accumulated: readonly EvidenceItem[]): number {
  return accumulated.reduce((sum, e) => sum + estimateBytes(e.result), 0);
}
