import { describe, expect, it } from 'vitest';
import type { CodePatch } from '@devforge/execution';
import {
  DeterministicPatchSelector,
  selectBestPatch,
  selectedFiles,
  selectionConfidence,
} from '../patch-selector.js';
import { fixedConfidence, type ConfidenceEvaluator } from '../confidence.js';
import { createPatch, deletePatch, modifyPatch } from './helpers.js';

const evaluator = fixedConfidence({ confidence: 0.5 });

const ctx = { goal: '', attempt: 1, failures: 0 };

function score(confidence: number) {
  return fixedConfidence({ confidence }).evaluate([], ctx);
}

describe('DeterministicPatchSelector', () => {
  it('selects an patch when files are distinct', () => {
    const selector = new DeterministicPatchSelector(evaluator);
    const result = selector.select([createPatch('a.ts'), createPatch('b.ts')]);
    expect(result.selected).toHaveLength(2);
    expect(result.rejected).toHaveLength(0);
    expect(result.conflicts).toEqual([]);
  });

  it('drops same-file patches by default', () => {
    const selector = new DeterministicPatchSelector(evaluator);
    const result = selector.select([createPatch('a.ts'), modifyPatch('a.ts', 'x')]);
    expect(result.selected).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.conflicts).toEqual(['a.ts']);
  });

  it('keeps same-file patches when configured to allow them', () => {
    const selector = new DeterministicPatchSelector(evaluator, true);
    const result = selector.select([createPatch('a.ts'), modifyPatch('a.ts', 'x')]);
    expect(result.selected).toHaveLength(2);
  });

  it('ranks by descending confidence', () => {
    const patches = [createPatch('a.ts'), createPatch('c.ts'), createPatch('b.ts')];
    const scores = [0.3, 0.9, 0.4].map(score);
    const selector = new DeterministicPatchSelector(evaluator);
    const result = selector.select(patches, { scores });
    expect(result.selected.map((entry) => entry.patch.file)).toEqual(['c.ts', 'b.ts', 'a.ts']);
  });

  it('orders deterministic ties by estimated impact', () => {
    const patches = [createPatch('a.ts'), createPatch('b.ts')];
    const scores = [
      fixedConfidence({ confidence: 0.8, estimatedImpact: 0.2 }).evaluate([], ctx),
      fixedConfidence({ confidence: 0.8, estimatedImpact: 0.9 }).evaluate([], ctx),
    ];
    const selector = new DeterministicPatchSelector(evaluator);
    const result = selector.select(patches, { scores });
    expect(result.selected[0]?.patch.file).toBe('b.ts');
  });

  it('breaks fully-tied patches deterministically by file name', () => {
    const patches = [createPatch('z.ts'), createPatch('a.ts')];
    const selector = new DeterministicPatchSelector(evaluator);
    const result = selector.select(patches, { scores: [score(0.8), score(0.8)] });
    expect(result.selected.map((entry) => entry.patch.file)).toEqual(['a.ts', 'z.ts']);
  });

  it('returns an empty result for no patches', () => {
    const selector = new DeterministicPatchSelector(evaluator);
    const result = selector.select([]);
    expect(result.selected).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
  });

  it('is deterministic for repeated calls', () => {
    const selector = new DeterministicPatchSelector(evaluator);
    const patches = [createPatch('b.ts'), createPatch('a.ts'), deletePatch('c.ts')];
    expect(selector.select(patches)).toEqual(selector.select(patches));
  });

  it('scores each patch through the injected evaluator', () => {
    let calls = 0;
    const counting: ConfidenceEvaluator = {
      name: 'counting',
      evaluate(patches_: readonly CodePatch[]) {
        calls += 1;
        return evaluator.evaluate(patches_, ctx);
      },
    };
    const selector = new DeterministicPatchSelector(counting);
    selector.select([createPatch('a.ts'), createPatch('b.ts')]);
    expect(calls).toBe(2);
  });

  it('uses default context when none is supplied', () => {
    const selector = new DeterministicPatchSelector(evaluator);
    const result = selector.select([createPatch('a.ts')]);
    expect(result.selected[0]?.score.confidence).toBe(0.5);
  });

  it('passes the provided context to the evaluator', () => {
    let seen: unknown = null;
    const recorder: ConfidenceEvaluator = {
      name: 'recorder',
      evaluate(_patches, context) {
        seen = context;
        return evaluator.evaluate(_patches, ctx);
      },
    };
    const selector = new DeterministicPatchSelector(recorder);
    selector.select([createPatch('a.ts')], {
      context: { goal: 'g', attempt: 4, failures: 2 },
    });
    expect(seen).toMatchObject({ goal: 'g', attempt: 4, failures: 2 });
  });

  it('assigns sequential selection order starting at one', () => {
    const selector = new DeterministicPatchSelector(evaluator);
    const result = selector.select([createPatch('a.ts'), createPatch('b.ts')]);
    expect(result.selected.map((entry) => entry.order)).toEqual([1, 2]);
  });
});

describe('selectBestPatch', () => {
  it('returns null for an empty batch', () => {
    expect(selectBestPatch([], evaluator, ctx)).toBeNull();
  });

  it('returns the only patch for a single-element batch', () => {
    const patch = createPatch('a.ts');
    expect(selectBestPatch([patch], evaluator, ctx)?.patch.id).toBe(patch.id);
  });

  it('returns the highest-confidence patch', () => {
    const low = createPatch('low.ts');
    const high = createPatch('high.ts');
    const best = selectBestPatch([low, high], evaluator, ctx);
    expect(best?.patch.file).toBe('high.ts');
  });
});

describe('selectionConfidence', () => {
  it('returns the best selected score', () => {
    const selector = new DeterministicPatchSelector(evaluator);
    const result = selector.select([createPatch('a.ts')], { scores: [score(0.9)] });
    expect(selectionConfidence(result)?.confidence).toBe(0.9);
  });

  it('returns null for an empty selection', () => {
    const selector = new DeterministicPatchSelector(evaluator);
    expect(selectionConfidence(selector.select([]))).toBeNull();
  });
});

describe('selectedFiles', () => {
  it('lists unique files across selected patches', () => {
    const selector = new DeterministicPatchSelector(evaluator, true);
    const result = selector.select([
      createPatch('a.ts'),
      modifyPatch('a.ts', 'x'),
      createPatch('b.ts'),
    ]);
    expect(selectedFiles(result)).toEqual(['a.ts', 'b.ts']);
  });
});