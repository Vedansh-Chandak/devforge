/**
 * Patch generation tests (DF-021).
 *
 * Covers suggested-patch application, insertions, replacements, changed-line
 * anchoring, and fingerprint determinism.
 */

import { describe, expect, it } from 'vitest';
import {
  applyPatches,
  applyToText,
  insertion,
  replacement,
  fromChangedLine,
  patchFingerprint,
} from '../src/patch.js';
import { changedLines } from '../src/diff.js';
import type { GitHubChangedFile } from '../src/types.js';

const SAMPLE = 'line one\nline two\nline three\n';

describe('applyToText', () => {
  it('replaces an exact line', () => {
    const result = applyToText('a\nb\nc', [replacement('x', 2, 'b', 'B')]);
    expect(result.applied).toBe(true);
    expect(result.content).toBe('a\nB\nc');
  });

  it('inserts a snippet before an anchor line', () => {
    const result = applyToText(SAMPLE, [insertion('x', 2, 'inserted')]);
    expect(result.content).toBe('line one\ninsertedline two\nline three\n');
  });

  it('replaces a partial match inside a longer line', () => {
    const result = applyToText('const x = 1;', [replacement('f', 1, '1', '2')]);
    expect(result.content).toBe('const x = 2;');
  });

  it('applies multiple patches bottom-up to keep offsets valid', () => {
    const text = 'a\nb\nc\nd';
    const patches = [
      replacement('f', 2, 'b', 'B2'),
      replacement('f', 4, 'd', 'D4'),
      replacement('f', 1, 'a', 'A1'),
    ];
    const result = applyToText(text, patches);
    expect(result.applied).toBe(true);
    expect(result.content).toBe('A1\nB2\nc\nD4');
  });

  it('reports out-of-range lines as failures', () => {
    const result = applyToText(SAMPLE, [replacement('f', 99, 'nope', 'x')]);
    expect(result.applied).toBe(false);
    expect(result.reason).toContain('out of range');
  });

  it('reports mismatched originals as failures', () => {
    const result = applyToText(SAMPLE, [replacement('f', 2, 'not present', 'x')]);
    expect(result.applied).toBe(false);
    expect(result.reason).toContain('not found');
  });

  it('leaves the text unchanged when a patch fails', () => {
    const result = applyToText(SAMPLE, [replacement('f', 2, 'missing', 'x')]);
    expect(result.content).toBe(SAMPLE);
  });
});

describe('applyPatches', () => {
  it('applies patches across multiple files', () => {
    const files = new Map([
      ['a.ts', 'one\ntwo\n'],
      ['b.ts', 'uno\ndos\n'],
    ]);
    const patches = [
      replacement('a.ts', 2, 'two', 'TWO'),
      replacement('b.ts', 2, 'dos', 'DOS'),
    ];
    const results = applyPatches(files, patches);
    expect(results.get('a.ts')?.content).toBe('one\nTWO\n');
    expect(results.get('b.ts')?.content).toBe('uno\nDOS\n');
  });

  it('reports files not present in the workspace', () => {
    const results = applyPatches(new Map(), [replacement('ghost.ts', 1, 'x', 'y')]);
    expect(results.get('ghost.ts')?.applied).toBe(false);
    expect(results.get('ghost.ts')?.reason).toBe('file not present in workspace');
  });
});

describe('fromChangedLine', () => {
  it('builds a patch anchored on an added line', () => {
    const file: GitHubChangedFile = {
      filename: 'src/a.ts',
      status: 'modified',
      additions: 1,
      deletions: 0,
      changes: 1,
      patch: '@@ -1 +1 @@\n-const x = 1;\n+const x = 2;',
    };
    const line = changedLines([file])[0];
    expect(line).toBeDefined();
    const patch = fromChangedLine(line as never, 'const x = 2;', 'Fix');
    expect(patch.file).toBe('src/a.ts');
    expect(patch.line).toBe(1);
    expect(patch.title).toBe('Fix');
  });
});

describe('patchFingerprint', () => {
  it('is deterministic for an identical patch set', () => {
    const a = [replacement('f', 2, 'x', 'y'), insertion('g', 1, 'i')];
    const b = [insertion('g', 1, 'i'), replacement('f', 2, 'x', 'y')];
    expect(patchFingerprint(a)).toBe(patchFingerprint(b));
  });

  it('differs when patch content differs', () => {
    const a = [replacement('f', 2, 'x', 'y')];
    const b = [replacement('f', 2, 'x', 'z')];
    expect(patchFingerprint(a)).not.toBe(patchFingerprint(b));
  });

  it('is a stable hex string', () => {
    const fingerprint = patchFingerprint([insertion('f', 1, 'i')]);
    expect(fingerprint).toMatch(/^[0-9a-f]+$/);
  });
});