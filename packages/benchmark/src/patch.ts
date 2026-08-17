/**
 * @devforge/benchmark — Patch application (DF-024).
 *
 * Patches describe target file states; grading verifies a patch applies
 * cleanly against the fixture. Application is deterministic: conflicts are
 * reported in sorted path order and no file halves are left behind.
 */
import type { FilePatch } from "./types.js";

export interface AppliedPatch {
  readonly applied: boolean;
  readonly conflicts: readonly string[];
  readonly changedPaths: readonly string[];
}

/** Apply `patch` over `files` (in place) and report clean application. */
export function applyPatch(
  files: Record<string, string>,
  patch: FilePatch,
): AppliedPatch {
  const conflicts = new Set<string>();
  const changed = new Set<string>();

  for (const change of patch.changes) {
    const current = files[change.path];
    if (change.before !== undefined && current !== change.before) {
      conflicts.add(change.path);
      continue;
    }
    if (change.after === undefined) {
      delete files[change.path];
    } else {
      files[change.path] = change.after;
    }
    changed.add(change.path);
  }

  return {
    applied: conflicts.size === 0,
    conflicts: uniquePreserveSorted(Array.from(conflicts)),
    changedPaths: uniquePreserveSorted([...changed, ...conflicts]),
  };
}

/** Deterministic unique-sorted paths from a collection. */
export function uniquePreserveSorted(items: readonly string[]): string[] {
  const set = new Set(items);
  return Array.from(set).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export interface PatchStatsValue {
  readonly filesChanged: number;
  readonly additions: number;
  readonly deletions: number;
}

/** Count changed files and added/deleted lines deterministically. */
export function patchStats(patch: FilePatch): PatchStatsValue {
  const filesChanged = uniquePreserveSorted(
    patch.changes.map((change) => change.path),
  ).length;
  let additions = 0;
  let deletions = 0;
  for (const change of patch.changes) {
    deletions += change.before === undefined ? 0 : lineCount(change.before);
    additions += change.after === undefined ? 0 : lineCount(change.after);
  }
  return { filesChanged, additions, deletions };
}

/** Number of newline-separated lines in `value`. */
export function lineCount(value: string): number {
  if (value.length === 0) return 0;
  return value.split("\n").length;
}

/** Canonical patch diff text (deterministic order of changes). */
export function patchToText(patch: FilePatch): string {
  const lines: string[] = [];
  const sortedChanges = Array.from(patch.changes).sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  for (const change of sortedChanges) {
    lines.push(`diff --git a/${change.path} b/${change.path}`);
    lines.push("@@ -0,0 +0,0 @@");
    if (change.before !== undefined) {
      for (const line of change.before.split("\n")) lines.push(`-${line}`);
    }
    if (change.after !== undefined) {
      for (const line of change.after.split("\n")) lines.push(`+${line}`);
    }
  }
  return `${lines.join("\n")}\n`;
}