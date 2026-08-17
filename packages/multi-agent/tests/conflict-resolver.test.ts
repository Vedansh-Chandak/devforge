import { describe, expect, it } from 'vitest';
import {
  ConflictResolver,
  CONFLICT_STRATEGIES,
  patchesOverlap,
  rangesOverlap,
  resolvePath,
  type Contribution,
} from '../src/execution/conflict-resolver.js';

function c(id: string, artifactId: string, content: string, order = 0): Contribution {
  return { taskId: id, artifactId, content, order };
}

const tasks = (contents: string[]): Contribution[] =>
  contents.map((content, i) => c(`t${i}`, `t${i}:impl`, content, i));

describe('rangesOverlap', () => {
  it('detects overlapping ranges', () => {
    expect(rangesOverlap({ startLine: 1, lineCount: 5 }, { startLine: 4, lineCount: 2 })).toBe(true);
  });

  it('treats adjacent ranges as non-overlapping', () => {
    expect(rangesOverlap({ startLine: 1, lineCount: 3 }, { startLine: 4, lineCount: 2 })).toBe(false);
  });

  it('treats equal ranges as overlapping', () => {
    expect(rangesOverlap({ startLine: 2, lineCount: 4 }, { startLine: 2, lineCount: 4 })).toBe(true);
  });

  it('treats zero-width ranges as non-overlapping', () => {
    expect(rangesOverlap({ startLine: 2, lineCount: 0 }, { startLine: 2, lineCount: 0 })).toBe(false);
  });
});

describe('patchesOverlap', () => {
  it('detects overlap across hunks', () => {
    const a = [{ startLine: 1, lineCount: 2 }];
    const b = [{ startLine: 5, lineCount: 2 }, { startLine: 2, lineCount: 1 }];
    expect(patchesOverlap(a, b)).toBe(true);
  });

  it('returns false for disjoint hunks', () => {
    const a = [{ startLine: 1, lineCount: 2 }];
    const b = [{ startLine: 10, lineCount: 2 }];
    expect(patchesOverlap(a, b)).toBe(false);
  });

  it('returns false for empty hunk lists', () => {
    expect(patchesOverlap([], [])).toBe(false);
  });
});

describe('resolvePath', () => {
  it('deduplicates identical contributions, keeping the earliest', () => {
    const r = resolvePath('a.ts', tasks(['same', 'same']));
    expect(r.content).toBe('same');
    expect(r.conflict).toBe(false);
    expect(r.strategy).toBe('KEEP_FIRST');
  });

  it('returns empty content for no contributions', () => {
    const r = resolvePath('a.ts', []);
    expect(r.content).toBe('');
    expect(r.conflict).toBe(false);
  });

  it('returns the single contribution without conflict', () => {
    const r = resolvePath('a.ts', tasks(['only']));
    expect(r.content).toBe('only');
    expect(r.conflict).toBe(false);
  });

  it('defaults to KEEP_FIRST for distinct code contributions', () => {
    const r = resolvePath('a.ts', tasks(['one', 'two']));
    expect(r.strategy).toBe('KEEP_FIRST');
    expect(r.content).toBe('one');
    expect(r.conflict).toBe(true);
    expect(r.contributors).toEqual(['t0', 't1']);
  });

  it('applies KEEP_LAST when configured', () => {
    const r = resolvePath('a.ts', tasks(['one', 'two']), { fallback: 'KEEP_LAST' });
    expect(r.strategy).toBe('KEEP_LAST');
    expect(r.content).toBe('two');
  });

  it('concatenates distinct contents for CONCATENATE', () => {
    const r = resolvePath('a.ts', tasks(['one', 'two']), { fallback: 'CONCATENATE' });
    expect(r.strategy).toBe('CONCATENATE');
    expect(r.content).toBe('one\n\ntwo');
    expect(r.conflict).toBe(true);
  });

  it('returns null content for MANUAL conflicts', () => {
    const r = resolvePath('a.ts', tasks(['one', 'two']), { fallback: 'MANUAL' });
    expect(r.strategy).toBe('MANUAL');
    expect(r.content).toBeNull();
    expect(r.conflict).toBe(true);
  });

  it('default strategy concatenates doc/test contributions', () => {
    const r = resolvePath('a.ts', [
      c('t0', 't0:test', 'test one', 0),
      c('t1', 't1:test', 'test two', 1),
    ]);
    expect(r.strategy).toBe('CONCATENATE');
    expect(r.content).toContain('test one');
    expect(r.content).toContain('test two');
  });

  it('keeps contributors in input order', () => {
    const r = resolvePath('a.ts', [c('x', 'x:impl', '1', 0), c('y', 'y:impl', '2', 1)]);
    expect(r.contributors).toEqual(['x', 'y']);
  });
});

describe('ConflictResolver', () => {
  it('defaults to a code KEEP_FIRST strategy via defaultStrategy', () => {
    const resolver = new ConflictResolver();
    const r = resolver.resolve('a.ts', tasks(['one', 'two']));
    expect(r.strategy).toBe('KEEP_FIRST');
  });

  it('concatenates doc contributions by default', () => {
    const resolver = new ConflictResolver();
    const r = resolver.resolve('a.ts', [
      c('t0', 't0:test', 'test one', 0),
      c('t1', 't1:test', 'test two', 1),
    ]);
    expect(r.strategy).toBe('CONCATENATE');
  });

  it('honours a configured fallback', () => {
    const resolver = new ConflictResolver({ fallback: 'CONCATENATE' });
    const r = resolver.resolve('a.ts', tasks(['one', 'two']));
    expect(r.strategy).toBe('CONCATENATE');
  });

  it('exposes an undefined fallback when unset and the configured one otherwise', () => {
    expect(new ConflictResolver().fallback).toBeUndefined();
    expect(new ConflictResolver({ fallback: 'MANUAL' }).fallback).toBe('MANUAL');
  });
});

describe('CONFLICT_STRATEGIES', () => {
  it('lists every supported strategy', () => {
    expect(CONFLICT_STRATEGIES).toEqual(['KEEP_FIRST', 'KEEP_LAST', 'CONCATENATE', 'MANUAL']);
  });
});
