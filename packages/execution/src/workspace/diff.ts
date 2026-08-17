/**
 * @devforge/execution — Deterministic line-based text diff.
 *
 * Used only for change previews. Never touches the filesystem.
 * Implements a longest-common-subsequence diff with a fixed tie-break
 * (prefer removal), so output is identical for identical input.
 *
 * The LCS table is capped at {@link MAX_DIFF_CELLS}; beyond that the diff
 * degrades deterministically to "all old lines removed, all new lines added".
 */
import type { WorkspacePath } from '../types.js';

/** Maximum cells in the LCS table (oldLines × newLines). */
export const MAX_DIFF_CELLS = 2_000_000;

/** Kind of a single diff line. */
export type DiffLineKind = 'context' | 'add' | 'remove';

export interface DiffLine {
  readonly kind: DiffLineKind;
  readonly text: string;
}

/** A contiguous region of changes (with bounded context lines). */
export interface DiffHunk {
  /** 1-based start line in the old text. */
  readonly oldStart: number;
  /** Number of old lines covered by the hunk. */
  readonly oldLines: number;
  /** 1-based start line in the new text. */
  readonly newStart: number;
  /** Number of new lines covered by the hunk. */
  readonly newLines: number;
  readonly lines: readonly DiffLine[];
}

/** Full result of a text diff. */
export interface TextDiff {
  readonly hunks: readonly DiffHunk[];
  /** Number of added lines. */
  readonly additions: number;
  /** Number of removed lines. */
  readonly deletions: number;
  /** Number of unchanged (context) lines. */
  readonly unchanged: number;
}

/** Context lines to keep around each change run. */
const CONTEXT = 3;

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  return text.split('\n');
}

/** Compute a unified diff of two texts using a capped LCS. */
export function generateTextDiff(oldText: string, newText: string): TextDiff {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  const ops = computeDiffOps(oldLines, newLines);
  const additions = ops.filter((op) => op.kind === 'add').length;
  const deletions = ops.filter((op) => op.kind === 'remove').length;
  const unchanged = ops.filter((op) => op.kind === 'context').length;

  const hunks = buildHunks(oldLines, newLines, ops);

  return { hunks, additions, deletions, unchanged };
}

type DiffOp = { readonly kind: DiffLineKind; readonly oldIndex: number; readonly newIndex: number };

function computeDiffOps(oldLines: string[], newLines: string[]): DiffOp[] {
  const m = oldLines.length;
  const n = newLines.length;

  if (m * n > MAX_DIFF_CELLS || m * n === 0) {
    if (m === 0) {
      return newLines.map((_, newIndex) => ({ kind: 'add' as const, oldIndex: 0, newIndex }));
    }
    if (n === 0) {
      return oldLines.map((_, oldIndex) => ({ kind: 'remove' as const, oldIndex, newIndex: 0 }));
    }
    const ops: DiffOp[] = [];
    for (let i = 0; i < m; i++) ops.push({ kind: 'remove', oldIndex: i, newIndex: 0 });
    for (let j = 0; j < n; j++) ops.push({ kind: 'add', oldIndex: m, newIndex: j });
    return ops;
  }

  const width = n + 1;
  const dp = new Uint32Array((m + 1) * width);
  const cell = (i: number, j: number): number => dp[i * width + j] as number;

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      const diag = cell(i + 1, j + 1);
      const down = cell(i + 1, j);
      const right = cell(i, j + 1);
      if (oldLines[i] === newLines[j]) {
        dp[i * width + j] = diag + 1;
      } else {
        dp[i * width + j] = down >= right ? down : right;
      }
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ kind: 'context', oldIndex: i, newIndex: j });
      i++;
      j++;
    } else if (cell(i + 1, j) >= cell(i, j + 1)) {
      ops.push({ kind: 'remove', oldIndex: i, newIndex: j });
      i++;
    } else {
      ops.push({ kind: 'add', oldIndex: i, newIndex: j });
      j++;
    }
  }
  while (i < m) {
    ops.push({ kind: 'remove', oldIndex: i, newIndex: n });
    i++;
  }
  while (j < n) {
    ops.push({ kind: 'add', oldIndex: m, newIndex: j });
    j++;
  }

  return ops;
}

function buildHunks(oldLines: string[], newLines: string[], ops: DiffOp[]): DiffHunk[] {
  // Compute runs of changes (non-context ops).
  const runs: Array<{ oldStart: number; oldEnd: number; newStart: number; newEnd: number }> = [];
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    if (op === undefined || op.kind === 'context') continue;
    const run: { oldStart: number; oldEnd: number; newStart: number; newEnd: number } = {
      oldStart: op.oldIndex,
      oldEnd: op.oldIndex,
      newStart: op.newIndex,
      newEnd: op.newIndex,
    };
    while (k + 1 < ops.length && ops[k + 1]?.kind !== 'context') {
      k++;
      const next = ops[k];
      if (next === undefined) break;
      run.oldEnd = next.oldIndex;
      run.newEnd = next.newIndex;
    }
    runs.push(run);
  }

  // Merge runs separated by at most 2×CONTEXT context lines.
  const merged: typeof runs = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (
      last &&
      run.oldStart - last.oldEnd - 1 <= 2 * CONTEXT &&
      run.newStart - last.newEnd - 1 <= 2 * CONTEXT
    ) {
      last.oldEnd = run.oldEnd;
      last.newEnd = run.newEnd;
    } else {
      merged.push({ ...run });
    }
  }

  const hunks: DiffHunk[] = [];
  for (const run of merged) {
    const oldStart = Math.max(0, run.oldStart - CONTEXT);
    const newStart = Math.max(0, run.newStart - CONTEXT);
    const oldEnd = Math.min(oldLines.length - 1, run.oldEnd + CONTEXT);
    const newEnd = Math.min(newLines.length - 1, run.newEnd + CONTEXT);

    const lines: DiffLine[] = [];
    for (const op of ops) {
      if (op.kind === 'context' && op.oldIndex >= oldStart && op.oldIndex <= oldEnd) {
        lines.push({ kind: 'context', text: oldLines[op.oldIndex] ?? '' });
      } else if (op.kind === 'remove' && op.oldIndex >= oldStart && op.oldIndex <= oldEnd) {
        lines.push({ kind: 'remove', text: oldLines[op.oldIndex] ?? '' });
      } else if (op.kind === 'add' && op.newIndex >= newStart && op.newIndex <= newEnd) {
        lines.push({ kind: 'add', text: newLines[op.newIndex] ?? '' });
      }
    }

    hunks.push({
      oldStart: oldStart + 1,
      oldLines: oldEnd - oldStart + 1,
      newStart: newStart + 1,
      newLines: newEnd - newStart + 1,
      lines,
    });
  }

  return hunks;
}

/**
 * Render a {@link TextDiff} to a human-readable unified preview.
 * Returns an empty string when the texts are identical.
 */
export function renderDiff(diff: TextDiff, options: { oldLabel?: string; newLabel?: string } = {}): string {
  if (diff.hunks.length === 0) return '';
  const oldLabel = options.oldLabel ?? 'old';
  const newLabel = options.newLabel ?? 'new';
  const chunks: string[] = [];
  for (const hunk of diff.hunks) {
    chunks.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@ (${oldLabel} → ${newLabel})`);
    for (const line of hunk.lines) {
      const prefix = line.kind === 'context' ? ' ' : line.kind === 'add' ? '+' : '-';
      chunks.push(`${prefix}${line.text}`);
    }
  }
  return chunks.join('\n');
}
