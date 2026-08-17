import { describe, it, expect } from 'vitest';
import {
  stripAnsi,
  indent,
  stringifyValue,
  shortId,
  uniqueId,
  renderUnifiedDiffFromGit,
  truncate,
  GitDiffLike,
} from '../src/utils.js';

describe('stripAnsi', () => {
  it('removes ANSI color codes', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red');
  });

  it('handles strings without ANSI codes', () => {
    expect(stripAnsi('plain')).toBe('plain');
  });

  it('removes multiple codes', () => {
    expect(stripAnsi('\x1b[1m\x1b[32mBold green\x1b[0m')).toBe('Bold green');
  });

  it('returns empty string for empty input', () => {
    expect(stripAnsi('')).toBe('');
  });
});

describe('indent', () => {
  it('indents each line by two spaces by default', () => {
    expect(indent('a\nb')).toBe('  a\n  b');
  });

  it('respects a custom indentation width', () => {
    expect(indent('a', 4)).toBe('    a');
  });

  it('leaves empty lines unindented', () => {
    expect(indent('a\n\nb')).toBe('  a\n\n  b');
  });
});

describe('stringifyValue', () => {
  it('returns empty string for nullish values', () => {
    expect(stringifyValue(undefined)).toBe('');
    expect(stringifyValue(null)).toBe('');
  });

  it('returns strings unchanged', () => {
    expect(stringifyValue('hello')).toBe('hello');
  });

  it('pretty-prints objects', () => {
    expect(stringifyValue({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});

describe('shortId', () => {
  it('produces a deterministic id for the same input', () => {
    expect(shortId('abc')).toBe(shortId('abc'));
  });

  it('produces different ids for different inputs', () => {
    expect(shortId('abc')).not.toBe(shortId('abd'));
  });

  it('has the expected prefix and length', () => {
    expect(shortId('x')).toMatch(/^fnv1a-[0-9a-f]{8}$/);
  });
});

describe('uniqueId', () => {
  it('prefixes the generated id', () => {
    expect(uniqueId('diff')).toMatch(/^diff-/);
  });

  it('generates unique values across calls', () => {
    expect(uniqueId('task')).not.toBe(uniqueId('task'));
  });
});

describe('truncate', () => {
  it('keeps short strings unchanged', () => {
    expect(truncate('short')).toBe('short');
  });

  it('truncates long strings with an ellipsis', () => {
    const result = truncate('x'.repeat(50), 10);
    expect(result).toBe('x'.repeat(7) + '...');
  });
});

describe('renderUnifiedDiffFromGit', () => {
  const diff: GitDiffLike = {
    files: [
      {
        oldPath: 'a.txt',
        newPath: 'b.txt',
        hunks: [
          {
            oldStart: 1,
            newStart: 1,
            oldLines: 2,
            newLines: 3,
            lines: [
              { kind: 'context', content: 'before' },
              { kind: 'deletion', content: 'removed' },
              { kind: 'addition', content: 'added' },
            ],
          },
        ],
      },
    ],
  };

  it('renders a diff header for each file', () => {
    const text = renderUnifiedDiffFromGit(diff);
    expect(text).toContain('diff --git a/a.txt b/b.txt');
    expect(text).toContain('--- a/a.txt');
    expect(text).toContain('+++ b/b.txt');
  });

  it('renders hunk headers with counts', () => {
    expect(renderUnifiedDiffFromGit(diff)).toContain('@@ -1,2 +1,3 @@');
  });

  it('renders addition/deletion/context line prefixes', () => {
    const text = renderUnifiedDiffFromGit(diff);
    expect(text).toContain(' before');
    expect(text).toContain('-removed');
    expect(text).toContain('+added');
  });

  it('falls back to newPath when oldPath is missing', () => {
    const text = renderUnifiedDiffFromGit({
      files: [{ newPath: 'only-new.txt', hunks: [] }],
    });
    expect(text).toContain('diff --git a/only-new.txt b/only-new.txt');
  });

  it('uses zero-count hunk headers when counts are zero', () => {
    const text = renderUnifiedDiffFromGit({
      files: [
        {
          oldPath: 'x',
          newPath: 'x',
          hunks: [{ oldStart: 0, newStart: 0, oldLines: 0, newLines: 0, lines: [] }],
        },
      ],
    });
    expect(text).toContain('@@ -0,0 +0,0 @@');
  });
});
