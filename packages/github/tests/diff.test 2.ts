/**
 * Diff parsing tests (DF-021).
 *
 * Pure, deterministic coverage of unified diff parsing: hunks, line kinds,
 * line numbering, added/deleted files, binary markers, statistics, and
 * changed-line flattening.
 */

import { describe, expect, it } from 'vitest';
import {
  parseDiff,
  parseChangedFile,
  parseChangedFiles,
  diffStats,
  changedLines,
  addedLines,
  isEmptyDiff,
} from '../src/diff.js';
import type { GitHubChangedFile } from '../src/types.js';

const SIMPLE_DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 111..222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,4 @@',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
  '+const c = 4;',
  ' const d = a;',
].join('\n');

const FILE: GitHubChangedFile = {
  filename: 'src/a.ts',
  status: 'modified',
  additions: 2,
  deletions: 1,
  changes: 3,
  patch: SIMPLE_DIFF,
};

describe('parseDiff', () => {
  it('parses paths and hunks from a standard diff', () => {
    const parsed = parseDiff(SIMPLE_DIFF);
    expect(parsed.oldPath).toBe('src/a.ts');
    expect(parsed.newPath).toBe('src/a.ts');
    expect(parsed.hunks).toHaveLength(1);
  });

  it('decodes hunk headers with counts', () => {
    const parsed = parseDiff(SIMPLE_DIFF);
    const hunk = parsed.hunks[0];
    expect(hunk?.oldStart).toBe(1);
    expect(hunk?.oldLines).toBe(3);
    expect(hunk?.newStart).toBe(1);
    expect(hunk?.newLines).toBe(4);
  });

  it('classifies lines by kind with correct numbering', () => {
    const hunk = parseDiff(SIMPLE_DIFF).hunks[0];
    const kinds = hunk?.lines.map((l) => l.kind);
    expect(kinds).toEqual(['context', 'deletion', 'addition', 'addition', 'context']);
    expect(hunk?.lines[0]?.newLineNumber).toBe(1);
    expect(hunk?.lines[0]?.oldLineNumber).toBe(1);
    expect(hunk?.lines[2]?.newLineNumber).toBe(2);
    expect(hunk?.lines[3]?.newLineNumber).toBe(3);
    expect(hunk?.lines[1]?.oldLineNumber).toBe(2);
    expect(hunk?.lines[2]?.oldLineNumber).toBeNull();
  });

  it('parses multiple hunks in one diff', () => {
    const multi = [
      'diff --git a/f b/f',
      '--- a/f',
      '+++ b/f',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      '@@ -10,2 +11,2 @@',
      ' ctx',
      '+add',
      '-del',
    ].join('\n');
    const parsed = parseDiff(multi);
    expect(parsed.hunks).toHaveLength(2);
  });

  it('marks added files with /dev/null old paths', () => {
    const added = [
      'diff --git a/src/new.ts b/src/new.ts',
      'new file mode 100644',
      'index 000..abc 100644',
      '--- /dev/null',
      '+++ b/src/new.ts',
      '@@ -0,0 +1,2 @@',
      '+export const a = 1;',
      '+export const b = 2;',
    ].join('\n');
    const parsed = parseDiff(added, 'added');
    expect(parsed.newPath).toBe('src/new.ts');
    expect(parsed.hunks[0]?.lines).toHaveLength(2);
    expect(parsed.hunks[0]?.lines[0]?.kind).toBe('addition');
  });

  it('handles deleted files and no-newline markers', () => {
    const removed = [
      'diff --git a/gone.ts b/gone.ts',
      'deleted file mode 100644',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-a',
      '-b',
      '\\ No newline at end of file',
    ].join('\n');
    const parsed = parseDiff(removed, 'removed');
    const hunk = parsed.hunks[0];
    expect(hunk?.lines[hunk.lines.length - 1]?.kind).toBe('no-newline');
  });

  it('skips binary file sections', () => {
    const binary = [
      'diff --git a/img.png b/img.png',
      'Binary files a/img.png and b/img.png differ',
    ].join('\n');
    const parsed = parseDiff(binary);
    expect(parsed.hunks).toHaveLength(0);
  });

  it('defaults to oldPath when newPath is absent', () => {
    const minimal = ['diff --git a/src/x.ts b/src/x.ts', '@@ -1 +1 @@', ' ctx'].join('\n');
    const parsed = parseDiff(minimal);
    expect(parsed.newPath).toBe('src/x.ts');
  });

  it('ignores non-hunk metadata and treats plain text as context', () => {
    const parsed = parseDiff(['@@ -1,2 +5,2 @@', ' zero', ' one'].join('\n'));
    expect(parsed.hunks.length).toBeGreaterThan(0);
  });
});

describe('parseChangedFile', () => {
  it('falls back to filename-derived paths when no patch is present', () => {
    const file: GitHubChangedFile = {
      filename: 'src/b.ts',
      status: 'modified',
      additions: 0,
      deletions: 0,
      changes: 0,
    };
    const parsed = parseChangedFile(file);
    expect(parsed.newPath).toBe('src/b.ts');
    expect(parsed.hunks).toHaveLength(0);
  });

  it('uses previousFilename as the old path for renames', () => {
    const file: GitHubChangedFile = {
      filename: 'src/b.ts',
      status: 'renamed',
      previousFilename: 'src/a.ts',
      additions: 0,
      deletions: 0,
      changes: 0,
    };
    const parsed = parseChangedFile(file);
    expect(parsed.oldPath).toBe('src/a.ts');
    expect(parsed.newPath).toBe('src/b.ts');
  });

  it('parses patches from PR file records', () => {
    const parsed = parseChangedFile(FILE);
    expect(parsed.newPath).toBe('src/a.ts');
    expect(parsed.status).toBe('modified');
    expect(parsed.hunks).toHaveLength(1);
  });
});

describe('parseChangedFiles / diffStats / changedLines', () => {
  it('parses all files in a PR', () => {
    const results = parseChangedFiles([FILE, { ...FILE, filename: 'other.ts', patch: undefined }]);
    expect(results).toHaveLength(2);
  });

  it('computes additions/deletions statistics', () => {
    const stats = diffStats([
      { ...FILE, additions: 5, deletions: 2 },
      { ...FILE, filename: 'z.ts', additions: 1, deletions: 3 },
    ]);
    expect(stats).toEqual({ additions: 6, deletions: 5, changedFiles: 2 });
  });

  it('flattens changed lines in file-path order', () => {
    const lines = changedLines([FILE, { ...FILE, filename: 'zz/a.ts' }]);
    const paths = lines.map((l) => l.path);
    expect(paths[0]).toBe('src/a.ts');
    expect(paths[paths.length - 1]).toBe('zz/a.ts');
  });

  it('addedLines returns only addition lines', () => {
    const additions = addedLines(parseChangedFile(FILE));
    expect(additions).toHaveLength(2);
    expect(additions.every((l) => l.kind === 'addition')).toBe(true);
  });

  it('isEmptyDiff detects context-only diffs', () => {
    const contextOnly = parseDiff('@@ -1 +1 @@\n ctx', 'modified');
    expect(isEmptyDiff(contextOnly)).toBe(true);
    expect(isEmptyDiff(parseChangedFile(FILE))).toBe(false);
  });
});