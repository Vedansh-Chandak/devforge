/**
 * @devforge/github — Diff parsing (DF-021).
 *
 * Pure, deterministic parsing of unified diffs as returned by the GitHub
 * REST API `patch` fields and PR files. Produces typed hunks and lines that
 * the review engine and patch suggester consume.
 */

import type { GitHubChangedFile, GitHubFileStatus } from './types.js';

export type DiffLineKind = 'context' | 'addition' | 'deletion' | 'no-newline';

export interface DiffLine {
  readonly kind: DiffLineKind;
  /** Content without the leading `+`/`-`/` ` marker. */
  readonly content: string;
  /** Line number in the new file, when applicable. */
  readonly newLineNumber: number | null;
  /** Line number in the old file, when applicable. */
  readonly oldLineNumber: number | null;
}

export interface DiffHunk {
  /** Raw `@@ -a,b +c,d @@` header. */
  readonly header: string;
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly DiffLine[];
}

export interface ParsedFileDiff {
  readonly oldPath: string;
  readonly newPath: string;
  readonly status: GitHubFileStatus;
  readonly hunks: readonly DiffHunk[];
}

/** A single changed line within a parsed diff. */
export interface ChangedLine {
  readonly path: string;
  readonly hunk: DiffHunk;
  readonly line: DiffLine;
}

/** Statistics derived from a parsed diff. */
export interface DiffStats {
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Mutable hunk shape used internally while parsing. */
interface MutableHunk {
  readonly header: string;
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: DiffLine[];
}

/** Freeze a mutable hunk into the public read-only shape. */
function freezeHunk(hunk: MutableHunk): DiffHunk {
  return { ...hunk, lines: [...hunk.lines] };
}

/**
 * Parse a unified diff body. Handles `diff --git`, `---`/`+++` markers,
 * `new file mode`, `deleted file mode`, and `Binary files` lines.
 */
export function parseDiff(text: string, status: GitHubFileStatus = 'modified'): ParsedFileDiff {
  const lines = text.split('\n');
  const hunks: DiffHunk[] = [];
  let oldPath = '';
  let newPath = '';
  let current: MutableHunk | null = null;
  let oldLine: number | null = null;
  let newLine: number | null = null;

  for (const raw of lines) {
    if (raw.startsWith('diff --git ')) {
      const match = /^diff --git a\/(.*?) b\/(.*)$/.exec(raw);
      oldPath = match?.[1] ?? '';
      newPath = match?.[2] ?? '';
      continue;
    }
    if (raw.startsWith('--- ')) {
      const p = raw.slice(4);
      if (p !== '/dev/null') oldPath = p.replace(/^a\//, '');
      continue;
    }
    if (raw.startsWith('+++ ')) {
      const p = raw.slice(4);
      if (p !== '/dev/null') newPath = p.replace(/^b\//, '');
      continue;
    }
    if (/^(new file mode|deleted file mode|index |similarity index|rename from|rename to|Binary files|GIT binary patch)/.test(raw)) {
      continue;
    }

    const hunkMatch = HUNK_HEADER.exec(raw);
    if (hunkMatch) {
      if (current) hunks.push(freezeHunk(current));
      current = {
        header: raw,
        oldStart: Number(hunkMatch[1]),
        oldLines: hunkMatch[2] !== undefined ? Number(hunkMatch[2]) : 1,
        newStart: Number(hunkMatch[3]),
        newLines: hunkMatch[4] !== undefined ? Number(hunkMatch[4]) : 1,
        lines: [],
      };
      oldLine = current.oldStart;
      newLine = current.newStart;
      continue;
    }

    if (!current) continue;
    if (raw.startsWith('\\ No newline at end of file')) {
      current.lines.push({ kind: 'no-newline', content: '', oldLineNumber: null, newLineNumber: null });
      continue;
    }

    if (raw.startsWith('+')) {
      current.lines.push({ kind: 'addition', content: raw.slice(1), newLineNumber: newLine, oldLineNumber: null });
      newLine = newLine === null ? null : newLine + 1;
    } else if (raw.startsWith('-')) {
      current.lines.push({ kind: 'deletion', content: raw.slice(1), newLineNumber: null, oldLineNumber: oldLine });
      oldLine = oldLine === null ? null : oldLine + 1;
    } else {
      current.lines.push({ kind: 'context', content: raw, newLineNumber: newLine, oldLineNumber: oldLine });
      newLine = newLine === null ? null : newLine + 1;
      oldLine = oldLine === null ? null : oldLine + 1;
    }
  }

  if (current) hunks.push(freezeHunk(current));

  return {
    oldPath,
    newPath: newPath || oldPath,
    status,
    hunks,
  };
}

/**
 * Parse a GitHub PR file record's `patch` field into a typed diff.
 * Falls back to status-derived paths when no patch is present.
 */
export function parseChangedFile(file: GitHubChangedFile): ParsedFileDiff {
  const status = file.status === 'removed' ? 'removed' : file.status;
  if (!file.patch) {
    return {
      oldPath: file.previousFilename ?? file.filename,
      newPath: file.filename,
      status,
      hunks: [],
    };
  }
  const parsed = parseDiff(file.patch, status);
  return {
    ...parsed,
    oldPath: file.previousFilename ?? (parsed.oldPath || file.filename),
    newPath: file.filename,
  };
}

/** Parse every changed file in a PR into typed diffs. */
export function parseChangedFiles(files: readonly GitHubChangedFile[]): readonly ParsedFileDiff[] {
  return files.map(parseChangedFile);
}

/** Compute deterministic addition/deletion statistics. */
export function diffStats(files: readonly GitHubChangedFile[]): DiffStats {
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    additions += file.additions;
    deletions += file.deletions;
  }
  return { additions, deletions, changedFiles: files.length };
}

/**
 * Flatten every changed line across all files, in deterministic order
 * (file path ascending, then hunk order).
 */
export function changedLines(files: readonly GitHubChangedFile[]): readonly ChangedLine[] {
  const result: ChangedLine[] = [];
  const sorted = [...files].sort((a, b) => a.filename.localeCompare(b.filename));
  for (const file of sorted) {
    const parsed = parseChangedFile(file);
    for (const hunk of parsed.hunks) {
      for (const line of hunk.lines) {
        result.push({ path: parsed.newPath, hunk, line });
      }
    }
  }
  return result;
}

/** All addition lines across a file's diff. */
export function addedLines(diff: ParsedFileDiff): readonly DiffLine[] {
  const result: DiffLine[] = [];
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === 'addition') result.push(line);
    }
  }
  return result;
}

/** Whether a parsed diff contains any change. */
export function isEmptyDiff(diff: ParsedFileDiff): boolean {
  return diff.hunks.every((hunk) => hunk.lines.every((line) => line.kind === 'context'));
}
