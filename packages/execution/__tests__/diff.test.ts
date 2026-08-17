import { describe, it, expect } from 'vitest';
import { generateTextDiff, renderDiff, MAX_DIFF_CELLS } from '../src/workspace/diff.js';

describe('generateTextDiff', () => {
  it('produces no hunks for identical texts', () => {
    const diff = generateTextDiff('a\nb\nc', 'a\nb\nc');
    expect(diff.hunks).toHaveLength(0);
    expect(diff.additions).toBe(0);
    expect(diff.deletions).toBe(0);
    expect(diff.unchanged).toBe(3);
  });

  it('detects an insertion', () => {
    const diff = generateTextDiff('a\nc', 'a\nb\nc');
    expect(diff.additions).toBe(1);
    expect(diff.deletions).toBe(0);
    const addLines = diff.hunks.flatMap((h) => h.lines).filter((l) => l.kind === 'add');
    expect(addLines.map((l) => l.text)).toEqual(['b']);
  });

  it('detects a deletion', () => {
    const diff = generateTextDiff('a\nb\nc', 'a\nc');
    expect(diff.deletions).toBe(1);
    expect(diff.additions).toBe(0);
    const removeLines = diff.hunks.flatMap((h) => h.lines).filter((l) => l.kind === 'remove');
    expect(removeLines.map((l) => l.text)).toEqual(['b']);
  });

  it('detects a replacement', () => {
    const diff = generateTextDiff('a\nold\nc', 'a\nnew\nc');
    expect(diff.additions).toBe(1);
    expect(diff.deletions).toBe(1);
    expect(diff.unchanged).toBe(2);
  });

  it('treats an empty old text as all additions', () => {
    const diff = generateTextDiff('', 'x\ny');
    expect(diff.additions).toBe(2);
    expect(diff.deletions).toBe(0);
  });

  it('treats an empty new text as all removals', () => {
    const diff = generateTextDiff('x\ny', '');
    expect(diff.deletions).toBe(2);
    expect(diff.additions).toBe(0);
  });

  it('counts lines accurately for mixed changes', () => {
    const oldText = ['a', 'b', 'c', 'd', 'e'].join('\n');
    const newText = ['a', 'B', 'c', 'e'].join('\n');
    const diff = generateTextDiff(oldText, newText);
    expect(diff.unchanged).toBe(3);
    expect(diff.deletions).toBe(2);
    expect(diff.additions).toBe(1);
  });

  it('keeps widely separated changes in separate hunks', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i}`);
    const oldText = lines.join('\n');
    const changed = [...lines];
    changed[2] = 'CHANGED_A';
    changed[17] = 'CHANGED_B';
    const diff = generateTextDiff(oldText, changed.join('\n'));
    expect(diff.hunks.length).toBeGreaterThan(1);
    expect(diff.additions).toBe(2);
    expect(diff.deletions).toBe(2);
  });

  it('is deterministic for identical inputs', () => {
    const oldText = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm\nn\no\np\nq\nr\ns\nt';
    const newText = 'a\nB\nc\nd\ne\nf\ng\nh\ni\nj\nK\nl\nm\nn\no\np\nq\nr\ns\nT';
    expect(generateTextDiff(oldText, newText)).toEqual(generateTextDiff(oldText, newText));
  });

  it('does not mutate when texts are large enough to hit the LCS cap', () => {
    const cap = MAX_DIFF_CELLS;
    const n = Math.floor(Math.sqrt(cap)) + 2;
    const oldText = Array.from({ length: n }, (_, i) => `o${i}`).join('\n');
    const newText = Array.from({ length: n }, (_, i) => `n${i}`).join('\n');
    const diff = generateTextDiff(oldText, newText);
    expect(diff.deletions).toBe(n);
    expect(diff.additions).toBe(n);
  });
});

describe('renderDiff', () => {
  it('returns an empty string for identical texts', () => {
    expect(renderDiff(generateTextDiff('a\nb', 'a\nb'))).toBe('');
  });

  it('renders add and remove markers', () => {
    const text = renderDiff(generateTextDiff('a\nc', 'a\nb\nc'));
    expect(text).toContain('+b');
  });

  it('renders remove markers for deletions', () => {
    const text = renderDiff(generateTextDiff('a\nb\nc', 'a\nc'));
    expect(text).toContain('-b');
  });
});
