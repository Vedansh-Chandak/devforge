/**
 * @devforge/multi-agent — Conflict resolver (DF-022).
 *
 * Deterministic rules for resolving write conflicts: duplicate edits are
 * deduplicated, disjoint edits are concatenated in a stable order, and
 * overlapping edits are resolved by a fixed strategy. Guiding principle:
 * identical inputs always produce identical output.
 */

import type { Artifact, PatchRange } from '../types.js';

/** Strategy applied when contributions to a path differ. */
export type ConflictStrategy = 'KEEP_FIRST' | 'KEEP_LAST' | 'CONCATENATE' | 'MANUAL';

/** All valid conflict strategies. */
export const CONFLICT_STRATEGIES: readonly ConflictStrategy[] = [
  'KEEP_FIRST',
  'KEEP_LAST',
  'CONCATENATE',
  'MANUAL',
];

/** A single contributor to a path. */
export interface Contribution {
  readonly taskId: string;
  readonly artifactId: string;
  readonly content: string;
  /** Sequence order used for stable tie-breaking (0-based). */
  readonly order: number;
}

/** The resolved outcome for one path. */
export interface Resolution {
  readonly path: string;
  readonly content: string | null;
  readonly strategy: ConflictStrategy;
  readonly conflict: boolean;
  readonly contributors: readonly string[];
}

/** Whether two line ranges overlap. */
export function rangesOverlap(a: PatchRange, b: PatchRange): boolean {
  const aStart = a.startLine;
  const aEnd = a.startLine + a.lineCount;
  const bStart = b.startLine;
  const bEnd = b.startLine + b.lineCount;
  return aStart < bEnd && bStart < aEnd;
}

/** Whether any hunk in `a` overlaps any hunk in `b`. */
export function patchesOverlap(a: readonly PatchRange[], b: readonly PatchRange[]): boolean {
  for (const ha of a) {
    for (const hb of b) {
      if (rangesOverlap(ha, hb)) return true;
    }
  }
  return false;
}

/** Deterministic default strategy for a path given its contribution kinds. */
export function defaultStrategy(contributors: readonly Contribution[]): ConflictStrategy {
  const kinds = new Set(contributors.map((c) => c.artifactId.split(':')[0]));
  const usesDoc = contributors.some((c) => c.artifactId.includes('doc') || c.artifactId.includes(':doc'));
  const usesTest = contributors.some((c) => c.artifactId.includes('test') || c.artifactId.includes(':test'));
  void kinds;
  if (usesDoc || usesTest) {
    return 'CONCATENATE';
  }
  return 'KEEP_FIRST';
}

/** Options controlling the resolver. */
export interface ConflictResolverOptions {
  readonly fallback?: ConflictStrategy;
}

/**
 * Resolves a batch of contributions to a single path. Contributions are
 * expected to arrive already ordered (task order). Returns the merged content
 * when resolvable, otherwise `null` for a MANUAL (unresolved) conflict.
 */
export function resolvePath(
  path: string,
  contributions: readonly Contribution[],
  options: ConflictResolverOptions = {},
): Resolution {
  const fallback = options.fallback ?? defaultStrategy(contributions);

  // Deduplicate identical contents, keeping the earliest contribution.
  const seen = new Set<string>();
  const unique: Contribution[] = [];
  for (const c of contributions) {
    if (seen.has(c.content)) continue;
    seen.add(c.content);
    unique.push(c);
  }

  const contributorIds = contributions.map((c) => c.taskId);
  if (unique.length === 0) {
    return { path, content: '', strategy: 'KEEP_FIRST', conflict: false, contributors: contributorIds };
  }
  if (unique.length === 1) {
    const only = unique[0]!;
    return {
      path,
      content: only.content,
      strategy: 'KEEP_FIRST',
      conflict: false,
      contributors: contributorIds,
    };
  }

  // Multiple distinct contents → apply the strategy.
  const first = unique[0]!;
  const last = unique[unique.length - 1]!;
  switch (fallback) {
    case 'KEEP_FIRST':
      return {
        path,
        content: first.content,
        strategy: 'KEEP_FIRST',
        conflict: true,
        contributors: contributorIds,
      };
    case 'KEEP_LAST':
      return {
        path,
        content: last.content,
        strategy: 'KEEP_LAST',
        conflict: true,
        contributors: contributorIds,
      };
    case 'CONCATENATE':
      return {
        path,
        content: unique.map((c) => c.content).join('\n\n'),
        strategy: 'CONCATENATE',
        conflict: true,
        contributors: contributorIds,
      };
    case 'MANUAL':
      return {
        path,
        content: null,
        strategy: 'MANUAL',
        conflict: true,
        contributors: contributorIds,
      };
  }
}

/** A stateful resolver used by the merge manager. */
export class ConflictResolver {
  readonly fallback: ConflictStrategy | undefined;

  constructor(options: ConflictResolverOptions = {}) {
    this.fallback = options.fallback;
  }

  resolve(path: string, contributions: readonly Contribution[]): Resolution {
    // Without an explicit fallback, defer to defaultStrategy so that doc/test
    // contributions concatenate while code keeps KEEP_FIRST.
    if (this.fallback) {
      return resolvePath(path, contributions, { fallback: this.fallback });
    }
    return resolvePath(path, contributions);
  }
}
