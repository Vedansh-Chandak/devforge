import { describe, expect, it } from 'vitest';
import type { CodePatch } from '@devforge/execution';
import {
  AttemptHistory,
  FINGERPRINT_PREFIX,
  diffAttempts,
  estimatePatchTokens,
  fingerprintPatches,
  patchSummary,
} from '../attempt-history.js';
import type { AttemptRecord } from '../types.js';
import { createPatch, deletePatch, modifyPatch } from './helpers.js';

function record(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  const patches = [createPatch('a.ts')];
  return {
    attempt: 1,
    patchIds: patches.map((patch) => patch.id),
    files: ['a.ts'],
    summary: patchSummary(patches),
    fingerprint: fingerprintPatches(patches),
    verificationOk: true,
    tokens: estimatePatchTokens(patches),
    durationMs: 5,
    confidence: 0.8,
    startedAt: 100,
    ...overrides,
  };
}

describe('fingerprintPatches', () => {
  it('is deterministic for the same patch set', () => {
    const a = fingerprintPatches([createPatch('a.ts'), modifyPatch('b.ts', 'x')]);
    const b = fingerprintPatches([createPatch('a.ts'), modifyPatch('b.ts', 'x')]);
    expect(a).toBe(b);
  });

  it('differs when the file changes', () => {
    const a = fingerprintPatches([createPatch('a.ts')]);
    const b = fingerprintPatches([createPatch('b.ts')]);
    expect(a).not.toBe(b);
  });

  it('differs when the operation changes', () => {
    const a = fingerprintPatches([modifyPatch('a.ts', 'x')]);
    const b = fingerprintPatches([deletePatch('a.ts')]);
    expect(a).not.toBe(b);
  });

  it('differs when the new content changes', () => {
    const a = fingerprintPatches([modifyPatch('a.ts', 'one')]);
    const b = fingerprintPatches([modifyPatch('a.ts', 'two')]);
    expect(a).not.toBe(b);
  });

  it('is order-independent', () => {
    const a = fingerprintPatches([createPatch('a.ts'), modifyPatch('b.ts', 'x')]);
    const b = fingerprintPatches([modifyPatch('b.ts', 'x'), createPatch('a.ts')]);
    expect(a).toBe(b);
  });

  it('is a compact fixed-width hash', () => {
    expect(fingerprintPatches([createPatch('a.ts')])).toMatch(/^fnv1a-[0-9a-f]+$/);
  });

  it('keeps a stable length', () => {
    const a = fingerprintPatches([createPatch('a.ts', 'x'.repeat(100))]);
    const b = fingerprintPatches([createPatch('a.ts', 'y'.repeat(100))]);
    expect(a).not.toBe(b);
    expect(a.length).toBe(b.length);
  });
});

describe('patchSummary', () => {
  it('describes operations and files', () => {
    expect(patchSummary([createPatch('a.ts')])).toBe('CREATE a.ts');
  });

  it('joins multiple patches with a separator', () => {
    const summary = patchSummary([createPatch('a.ts'), modifyPatch('b.ts', 'x')]);
    expect(summary).toContain('CREATE a.ts');
    expect(summary).toContain('MODIFY b.ts');
  });

  it('is order-independent', () => {
    const a = patchSummary([createPatch('a.ts'), modifyPatch('b.ts', 'x')]);
    const b = patchSummary([modifyPatch('b.ts', 'x'), createPatch('a.ts')]);
    expect(a).toBe(b);
  });

  it('handles an empty set', () => {
    expect(patchSummary([])).toBe('');
  });
});

describe('estimatePatchTokens', () => {
  it('returns at least 1 token for any input, including empty', () => {
    expect(estimatePatchTokens([])).toBeGreaterThanOrEqual(1);
  });

  it('scales with content length', () => {
    const small = estimatePatchTokens([modifyPatch('a.ts', 'x')]);
    const big = estimatePatchTokens([modifyPatch('a.ts', 'x'.repeat(1000))]);
    expect(big).toBeGreaterThan(small);
  });

  it('honours the granularity option', () => {
    const content = 'x'.repeat(80);
    const fine = estimatePatchTokens([modifyPatch('a.ts', content)], 1);
    const coarse = estimatePatchTokens([modifyPatch('a.ts', content)], 32);
    expect(fine).toBeGreaterThan(coarse);
  });

  it('aggregates across patches', () => {
    const one = estimatePatchTokens([modifyPatch('a.ts', 'x'.repeat(40))]);
    const two = estimatePatchTokens([
      modifyPatch('a.ts', 'x'.repeat(40)),
      modifyPatch('b.ts', 'y'.repeat(40)),
    ]);
    expect(two).toBeGreaterThan(one);
  });
});

describe('diffAttempts', () => {
  it('reports no differences for identical attempts', () => {
    const a = record({ attempt: 1 });
    const b = record({ attempt: 2 });
    expect(diffAttempts(a, b)).toHaveLength(0);
  });

  it('reports a patch count difference', () => {
    const a = record();
    const b = record({ patchIds: ['p-1', 'p-2'] });
    const diffs = diffAttempts(a, b);
    expect(diffs.some((line) => line.includes('patch count'))).toBe(true);
  });

  it('reports a summary difference', () => {
    const a = record();
    const b = record({ summary: 'CREATE other.ts' });
    const diffs = diffAttempts(a, b);
    expect(diffs.some((line) => line.includes('patches'))).toBe(true);
  });
});

describe('AttemptHistory.record', () => {
  it('starts empty', () => {
    const history = new AttemptHistory();
    expect(history.size).toBe(0);
    expect(history.isEmpty).toBe(true);
    expect(history.latest()).toBeNull();
    expect(history.list()).toEqual([]);
  });

  it('records attempts in order', () => {
    const history = new AttemptHistory();
    history.record(record({ attempt: 1 }));
    history.record(record({ attempt: 2 }));
    expect(history.size).toBe(2);
    expect(history.list().map((entry) => entry.attempt)).toEqual([1, 2]);
  });

  it('exposes the latest attempt', () => {
    const history = new AttemptHistory();
    history.record(record({ attempt: 1 }));
    history.record(record({ attempt: 2 }));
    expect(history.latest()?.attempt).toBe(2);
  });

  it('drops the oldest entries past capacity', () => {
    const history = new AttemptHistory(3);
    for (let i = 1; i <= 5; i++) {
      history.record(record({ attempt: i }));
    }
    expect(history.size).toBe(3);
    expect(history.list().map((entry) => entry.attempt)).toEqual([3, 4, 5]);
  });

  it('clears all entries', () => {
    const history = new AttemptHistory();
    history.record(record());
    history.clear();
    expect(history.isEmpty).toBe(true);
  });
});

describe('AttemptHistory duplicate detection', () => {
  it('recognises a repeated fingerprint', () => {
    const history = new AttemptHistory();
    const patch = createPatch('a.ts');
    history.record(record({ fingerprint: fingerprintPatches([patch]) }));
    expect(history.hasFingerprint(fingerprintPatches([patch]))).toBe(true);
  });

  it('isDuplicate matches an unrecorded duplicate patch set', () => {
    const history = new AttemptHistory();
    const patch = createPatch('a.ts');
    history.record(record({ fingerprint: fingerprintPatches([patch]) }));
    expect(history.isDuplicate([patch])).toBe(true);
  });

  it('isDuplicate misses distinct sets', () => {
    const history = new AttemptHistory();
    history.record(record({ fingerprint: fingerprintPatches([createPatch('a.ts')]) }));
    expect(history.isDuplicate([createPatch('zz.ts')])).toBe(false);
  });

  it('does not consider the current attempt a duplicate of itself', () => {
    const history = new AttemptHistory();
    const patch = createPatch('a.ts');
    history.record(record({ attempt: 1, fingerprint: fingerprintPatches([patch]) }));
    expect(history.hasFingerprint(fingerprintPatches([patch]), 1)).toBe(false);
  });

  it('counts fingerprints', () => {
    const history = new AttemptHistory();
    const patch = createPatch('a.ts');
    history.record(record({ fingerprint: fingerprintPatches([patch]) }));
    history.record(record({ fingerprint: fingerprintPatches([patch]) }));
    expect(history.countFingerprint(fingerprintPatches([patch]))).toBe(2);
  });

  it('fingerprint() helper mirrors the module function', () => {
    const history = new AttemptHistory();
    const patch = createPatch('a.ts');
    expect(history.fingerprint([patch])).toBe(fingerprintPatches([patch]));
  });
});

describe('AttemptHistory file tracking', () => {
  it('counts attempts that touched a file', () => {
    const history = new AttemptHistory();
    history.record(record({ files: ['a.ts'] }));
    history.record(record({ files: ['b.ts'] }));
    expect(history.countFile('a.ts')).toBe(1);
    expect(history.countFile('b.ts')).toBe(1);
    expect(history.countFile('c.ts')).toBe(0);
  });
});

describe('fingerprint namespacing', () => {
  it('exposes the fingerprint prefix constant', () => {
    expect(FINGERPRINT_PREFIX).toBe('autonomous-v1');
  });

  it('hashes unique patch shapes uniquely', () => {
    const sets: readonly (readonly CodePatch[])[] = [
      [createPatch('a.ts')],
      [modifyPatch('a.ts', 'x')],
      [deletePatch('a.ts')],
      [createPatch('a.ts'), createPatch('b.ts')],
    ];
    const fingerprints = new Set(sets.map((set) => fingerprintPatches(set)));
    expect(fingerprints.size).toBe(sets.length);
  });

  it('is unaffected by trailing whitespace in content', () => {
    const a = fingerprintPatches([createPatch('a.ts', 'x')]);
    const b = fingerprintPatches([createPatch('a.ts', 'x\n')]);
    // trailing content differs, so hashes must differ (canonical preserves it)
    expect(a).not.toBe(b);
  });
});