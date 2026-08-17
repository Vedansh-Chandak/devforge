/**
 * @devforge/autonomous — Attempt history (DF-019).
 *
 * Records every patch-apply-verify attempt with a deterministic fingerprint.
 * The agent never generates the same patch set twice: duplicates are detected
 * cheaply and stop the loop.
 */

import { hashText, type CodePatch } from '@devforge/execution';
import type { AttemptRecord } from './types.js';

export const FINGERPRINT_PREFIX = 'autonomous-v1';

const FIELD_SEPARATOR = '\u0000';
const PATCH_SEPARATOR = '\u0001';

/**
 * Build a deterministic fingerprint for a batch of patches.
 * Independent of input order, patch id casing, and trailing variance.
 */
export function fingerprintPatches(patches: readonly CodePatch[]): string {
  const canonical = patches
    .map((patch) =>
      [patch.file, patch.operation, patch.expectedHash ?? '', patch.newContent ?? '']
        .join(FIELD_SEPARATOR),
    )
    .sort()
    .join(PATCH_SEPARATOR);
  return hashText(`${FINGERPRINT_PREFIX}:${canonical}`);
}

/** Collapse the summary down to the patch ids. */
export function patchSummary(patches: readonly CodePatch[]): string {
  const summary = patches
    .map((patch) => `${patch.operation} ${patch.file}`)
    .sort();
  return summary.join(', ');
}

/**
 * Deterministic byte estimate of the token cost of a patch set.
 * Uses `AUTONOMOUS_DEFAULTS.tokenGranularity` chars per token.
 */
export function estimatePatchTokens(
  patches: readonly CodePatch[],
  granularity = 4,
): number {
  let chars = 0;
  for (const patch of patches) {
    chars += patch.file.length;
    chars += patch.operation.length;
    chars += patch.newContent?.length ?? 0;
  }
  return Math.max(1, Math.ceil(chars / granularity));
}

/** Human-readable report of what differs between two attempt sets. */
export function diffAttempts(a: AttemptRecord, b: AttemptRecord): string[] {
  const differences: string[] = [];
  if (a.patchIds.length !== b.patchIds.length) {
    differences.push(`patch count ${a.patchIds.length} -> ${b.patchIds.length}`);
  }
  const aFiles = a.summary;
  const bFiles = b.summary;
  if (aFiles !== bFiles) differences.push(`patches ${aFiles} -> ${bFiles}`);
  return differences;
}

/** In-memory ledger of attempts with duplicate detection. */
export class AttemptHistory {
  private readonly entries: AttemptRecord[] = [];
  private readonly capacity: number;

  constructor(capacity = 200) {
    this.capacity = capacity;
  }

  get size(): number {
    return this.entries.length;
  }

  get isEmpty(): boolean {
    return this.entries.length === 0;
  }

  /** Snapshot of every recorded attempt, oldest first. */
  list(): readonly AttemptRecord[] {
    return [...this.entries];
  }

  /** Most recent recorded attempt, or null when empty. */
  latest(): AttemptRecord | null {
    return this.entries.length === 0
      ? null
      : (this.entries[this.entries.length - 1] as AttemptRecord);
  }

  /** Fingerprint of a patch set. */
  fingerprint(patches: readonly CodePatch[]): string {
    return fingerprintPatches(patches);
  }

  /** Whether any recorded attempt shares this fingerprint. */
  hasFingerprint(fingerprint: string, knownAttempt?: number): boolean {
    return this.entries.some((entry) => {
      if (entry.fingerprint !== fingerprint) return false;
      if (knownAttempt !== undefined && entry.attempt === knownAttempt) return false;
      return true;
    });
  }

  /** Whether an unrecorded patch set duplicates an existing attempt. */
  isDuplicate(patches: readonly CodePatch[], currentAttempt?: number): boolean {
    return this.hasFingerprint(
      fingerprintPatches(patches),
      currentAttempt,
    );
  }

  /** Number of attempts sharing this fingerprint. */
  countFingerprint(fingerprint: string): number {
    let count = 0;
    for (const entry of this.entries) {
      if (entry.fingerprint === fingerprint) count += 1;
    }
    return count;
  }

  /** Count of attempts that touched a given file. */
  countFile(file: string): number {
    let count = 0;
    for (const entry of this.entries) {
      if (entry.files.includes(file)) count += 1;
    }
    return count;
  }

  /** Record a completed attempt, dropping the oldest entry on overflow. */
  record(entry: AttemptRecord): AttemptRecord {
    this.entries.push(entry);
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity);
    }
    return entry;
  }

  clear(): void {
    this.entries.length = 0;
  }
}