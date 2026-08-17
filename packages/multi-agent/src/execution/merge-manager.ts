/**
 * @devforge/multi-agent — Merge manager (DF-022).
 *
 * Collects the outputs of all successful agents and merges them into a
 * single workspace view using deterministic rules: duplicate edits are
 * deduplicated, non-overlapping patches are combined, and overlapping edits
 * are resolved by the {@link ConflictResolver}. Produces the merged file map
 * plus a summary of deduplication and conflicts.
 */

import type { Artifact, TaskResult } from '../types.js';
import { ConflictResolver, patchesOverlap, type Contribution, type Resolution } from './conflict-resolver.js';

/** One conflict flagged during merge. */
export interface MergeConflict {
  readonly path: string;
  readonly taskIds: readonly string[];
  readonly strategy: string;
  readonly resolved: boolean;
}

/** Outcome of merging a set of task results. */
export interface MergeOutcome {
  /** Merged file contents keyed by path. */
  readonly files: ReadonlyMap<string, string>;
  readonly conflicts: readonly MergeConflict[];
  readonly filesMerged: number;
  readonly deduped: number;
  readonly artifactCount: number;
  readonly taskIds: readonly string[];
}

/** Options for the merge manager. */
export interface MergeManagerOptions {
  readonly resolver?: ConflictResolver;
  /** Paths whose conflicts must not be auto-resolved (left for manual review). */
  readonly manualPaths?: readonly string[];
}

/** Extract mergeable artifacts from task results in deterministic order. */
export function mergeableArtifacts(results: readonly TaskResult[]): readonly Artifact[] {
  const artifacts: Artifact[] = [];
  for (const result of results) {
    if (result.status !== 'SUCCEEDED') continue;
    for (const artifact of result.artifacts) {
      if (
        artifact.kind === 'NOTE' ||
        artifact.kind === 'PLAN' ||
        artifact.kind === 'REPORT'
      ) {
        continue;
      }
      artifacts.push(artifact);
    }
  }
  return artifacts;
}

/** Group artifacts by path, preserving task order. */
function groupByPath(artifacts: readonly Artifact[]): Map<string, Artifact[]> {
  const map = new Map<string, Artifact[]>();
  for (const artifact of artifacts) {
    if (!map.has(artifact.path)) map.set(artifact.path, []);
    map.get(artifact.path)!.push(artifact);
  }
  return map;
}

/** Merge a set of task results into a workspace view. */
export function mergeResults(
  results: readonly TaskResult[],
  options: MergeManagerOptions = {},
): MergeOutcome {
  const resolver = options.resolver ?? new ConflictResolver();
  const manual = new Set(options.manualPaths ?? []);
  const artifacts = mergeableArtifacts(results);
  const groups = groupByPath(artifacts);
  const files = new Map<string, string>();
  const conflicts: MergeConflict[] = [];
  let deduped = 0;

  // Build contributions in deterministic task order.
  const orderIndex = new Map<string, number>();
  results.forEach((r, i) => orderIndex.set(r.taskId, i));
  const orderFor = (taskId: string): number => orderIndex.get(taskId) ?? 0;

  for (const [path, pathArtifacts] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const contributions: Contribution[] = pathArtifacts.map((artifact, idx) => {
      const taskId = artifact.id ? artifact.id.split(':')[0] ?? artifact.path : artifact.path;
      return {
        taskId,
        artifactId: artifact.id ?? artifact.path,
        content: artifact.content,
        order: orderFor(taskId) * 100 + idx,
      };
    });

    deduped += countDuplicates(contributions);

    let resolution: Resolution;
    if (manual.has(path)) {
      // Force unresolved manual conflict.
      resolution = {
        path,
        content: null,
        strategy: 'MANUAL',
        conflict: true,
        contributors: contributions.map((c) => c.taskId),
      };
    } else {
      resolution = resolver.resolve(path, contributions);
    }

    if (resolution.content !== null) {
      files.set(path, resolution.content);
    }
    if (resolution.conflict) {
      conflicts.push({
        path,
        taskIds: resolution.contributors,
        strategy: resolution.strategy,
        resolved: resolution.content !== null,
      });
    }
  }

  // Patch-overlap detection adds a conflict if overlapping patch hunks exist
  // on the same path even when contents are equal.
  for (const [path, pathArtifacts] of groups) {
    const patchRanges = pathArtifacts
      .filter((a) => a.kind === 'PATCH' && a.hunks && a.hunks.length > 0)
      .map((a) => ({ artifact: a, hunks: a.hunks! }));
    for (let i = 0; i < patchRanges.length; i += 1) {
      const left = patchRanges[i]!;
      for (let j = i + 1; j < patchRanges.length; j += 1) {
        const right = patchRanges[j]!;
        if (patchesOverlap(left.hunks, right.hunks)) {
          const existing = conflicts.find((c) => c.path === path);
          const taskIds = existing?.taskIds ?? [
            taskIdOf(left.artifact),
            taskIdOf(right.artifact),
          ];
          if (!existing) {
            conflicts.push({ path, taskIds, strategy: 'KEEP_FIRST', resolved: true });
          }
          break;
        }
      }
    }
  }

  return {
    files,
    conflicts: conflicts.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    filesMerged: files.size,
    deduped,
    artifactCount: artifacts.length,
    taskIds: [...new Set(results.map((r) => r.taskId))],
  };
}

function countDuplicates(contributions: readonly Contribution[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const c of contributions) {
    if (seen.has(c.content)) {
      duplicates += 1;
    } else {
      seen.add(c.content);
    }
  }
  return duplicates;
}

function taskIdOf(artifact: Artifact): string {
  return artifact.id ? artifact.id.split(':')[0] ?? artifact.path : artifact.path;
}

/** A class wrapper for the merge manager (also usable statelessly). */
export class MergeManager {
  private readonly resolver: ConflictResolver;
  private readonly manualPaths: readonly string[] = [];

  constructor(options: MergeManagerOptions = {}) {
    this.resolver = options.resolver ?? new ConflictResolver();
    this.manualPaths = options.manualPaths ?? [];
  }

  merge(results: readonly TaskResult[]): MergeOutcome {
    return mergeResults(results, {
      resolver: this.resolver,
      manualPaths: this.manualPaths,
    });
  }
}
