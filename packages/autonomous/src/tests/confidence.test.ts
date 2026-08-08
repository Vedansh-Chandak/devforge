import { describe, expect, it } from 'vitest';
import type { CodePatch } from '@devforge/execution';
import {
  DefaultConfidenceGate,
  DeterministicConfidenceEvaluator,
  clamp01,
  clearsThreshold,
  compareRisk,
  confidenceGate,
  deterministicConfidence,
  fixedConfidence,
  maxConfidence,
  riskOf,
} from '../confidence.js';
import type { ConfidenceContext, ConfidenceEvaluator } from '../confidence.js';
import type { RiskLevel } from '../types.js';
import { createPatch, deletePatch, modifyPatch } from './helpers.js';

const baseContext: ConfidenceContext = { goal: 'g', attempt: 0, failures: 0 };

function score(patches: readonly CodePatch[], context: ConfidenceContext = baseContext) {
  return new DeterministicConfidenceEvaluator().evaluate(patches, context);
}

describe('clamp01', () => {
  it('returns the value unchanged inside [0,1]', () => {
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(1)).toBe(1);
  });
  it('clamps values above 1', () => {
    expect(clamp01(1.7)).toBe(1);
    expect(clamp01(2)).toBe(1);
  });
  it('clamps values below 0', () => {
    expect(clamp01(-0.3)).toBe(0);
    expect(clamp01(-1)).toBe(0);
  });
  it('rounds to the given decimals by default', () => {
    expect(clamp01(0.517)).toBe(0.52);
  });
  it('honours a custom decimals argument', () => {
    expect(clamp01(0.517, 1)).toBe(0.5);
    expect(clamp01(0.517, 0)).toBe(1);
  });
});

describe('compareRisk', () => {
  it('orders from lowest to highest risk', () => {
    expect(compareRisk('LOW', 'LOW')).toBe(0);
    expect(compareRisk('LOW', 'MEDIUM')).toBeLessThan(0);
    expect(compareRisk('MEDIUM', 'LOW')).toBeGreaterThan(0);
    expect(compareRisk('HIGH', 'CRITICAL')).toBeLessThan(0);
  });
  it('ranks CRITICAL above everything', () => {
    expect(compareRisk('CRITICAL', 'HIGH')).toBeGreaterThan(0);
  });
});

describe('riskOf', () => {
  it('returns LOW for an empty set', () => {
    expect(riskOf([])).toBe('LOW');
  });
  it('returns CRITICAL when any op deletes', () => {
    expect(riskOf([deletePatch('a.ts')])).toBe('CRITICAL');
  });
  it('returns HIGH when more than three files are touched', () => {
    const many = [1, 2, 3, 4].map((n) => createPatch(`f${n}.ts`));
    expect(riskOf(many)).toBe('HIGH');
  });
  it('returns HIGH when a modify op is present', () => {
    expect(riskOf([modifyPatch('a.ts', 'x')])).toBe('HIGH');
  });
  it('defaults to MEDIUM for a single create', () => {
    expect(riskOf([createPatch('a.ts')])).toBe('MEDIUM');
  });
});

describe('DeterministicConfidenceEvaluator', () => {
  it('awards a base score to a well-formed single create', () => {
    const patch = createPatch('a.ts');
    const entry = score([patch], baseContext);
    expect(entry.confidence).toBeGreaterThan(0);
    expect(entry.confidence).toBeLessThanOrEqual(1);
  });
  it('scores an empty patch set very low and distrusts it', () => {
    const entry = score([], baseContext);
    expect(entry.confidence).toBe(0.1);
    expect(entry.reasons.join(' ')).toContain('empty');
  });
  it('scores a single-file change higher than a multi-file change', () => {
    const single = score([createPatch('a.ts')], baseContext);
    const multi = score(
      [createPatch('a.ts'), createPatch('b.ts'), createPatch('c.ts'), createPatch('d.ts')],
      baseContext,
    );
    expect(single.confidence).toBeGreaterThan(multi.confidence);
  });
  it('penalises delete operations', () => {
    const low = score([deletePatch('a.ts')], baseContext);
    const high = score([createPatch('a.ts')], baseContext);
    expect(low.confidence).toBeLessThan(high.confidence);
  });
  it('penalises broad changes touching many files', () => {
    const broad = score(
      [1, 2, 3, 4].map((n) => createPatch(`f${n}.ts`)),
      baseContext,
    );
    const single = score([createPatch('f1.ts')], baseContext);
    expect(broad.confidence).toBeLessThan(single.confidence);
  });
  it('penalises mixed operations', () => {
    const mixed = score([createPatch('a.ts'), modifyPatch('b.ts', 'y')], baseContext);
    const pure = score([createPatch('a.ts'), createPatch('b.ts')], baseContext);
    expect(mixed.confidence).toBeLessThan(pure.confidence);
  });
  it('lowers confidence with the failure count', () => {
    const first = score([createPatch('a.ts')], { ...baseContext, failures: 0 });
    const fourth = score([createPatch('a.ts')], { ...baseContext, failures: 3 });
    expect(fourth.confidence).toBeLessThan(first.confidence);
  });
  it('caps the failure penalty at three attempts', () => {
    const three = score([createPatch('a.ts')], { ...baseContext, failures: 3 });
    const ten = score([createPatch('a.ts')], { ...baseContext, failures: 10 });
    expect(three.confidence).toBe(ten.confidence);
  });
  it('is deterministic: same input, same output', () => {
    const patches = [createPatch('a.ts'), modifyPatch('b.ts', 'z')];
    const first = score(patches);
    const second = score(patches);
    expect(first).toEqual(second);
  });
  it('flags a patch with an empty file as malformed', () => {
    const patch = createPatch('a.ts');
    const malformed = score([{ ...patch, file: '' }]);
    expect(malformed.confidence).toBeLessThan(score([patch]).confidence);
  });
  it('flags a create without content as malformed', () => {
    const patch = createPatch('a.ts');
    const malformed = score([{ ...patch, newContent: '' }]);
    expect(malformed.confidence).toBeLessThan(score([patch]).confidence);
  });
  it('reports the risk level on the score', () => {
    expect(score([deletePatch('a.ts')]).risk).toBe('CRITICAL');
  });
  it('returns expectedSuccess in [0,1]', () => {
    const entry = score([createPatch('a.ts')]);
    expect(entry.expectedSuccess).toBeGreaterThanOrEqual(0);
    expect(entry.expectedSuccess).toBeLessThanOrEqual(1);
  });
  it('estimates impact from file count and content size', () => {
    const large = score([
      createPatch('a.ts', 'x'.repeat(4000)),
      createPatch('b.ts', 'y'.repeat(4000)),
    ]);
    expect(large.estimatedImpact).toBeGreaterThan(0);
  });
  it('returns reasons that describe the outcome', () => {
    const entry = score([createPatch('a.ts')]);
    expect(entry.reasons.length).toBeGreaterThan(0);
  });
  it('reports a 0.1 score for an empty set with a reason', () => {
    const entry = score([]);
    expect(entry.confidence).toBe(0.1);
    expect(entry.risk).toBe('LOW');
  });
});

describe('deterministicConfidence', () => {
  it('returns an evaluator with a name', () => {
    expect(deterministicConfidence().name).toBe('deterministic');
  });
  it('is an instanceof DeterministicConfidenceEvaluator', () => {
    expect(deterministicConfidence()).toBeInstanceOf(DeterministicConfidenceEvaluator);
  });
});

describe('fixedConfidence', () => {
  it('returns a fixed score for any patch input', () => {
    const evaluator: ConfidenceEvaluator = fixedConfidence({ confidence: 0.9 });
    const a = evaluator.evaluate([createPatch('a.ts')], baseContext);
    const b = evaluator.evaluate([deletePatch('b.ts')], baseContext);
    expect(a.confidence).toBe(0.9);
    expect(b.confidence).toBe(0.9);
  });
  it('defaults to a confidence of 0.8', () => {
    const evaluator = fixedConfidence();
    expect(evaluator.evaluate([createPatch('a.ts')], baseContext).confidence).toBe(0.8);
  });
  it('maps expectedSuccess to the confidence unless overridden', () => {
    const evaluator = fixedConfidence({ confidence: 0.4 });
    expect(evaluator.evaluate([], baseContext).expectedSuccess).toBe(0.4);
  });
  it('honours every provided field', () => {
    const evaluator = fixedConfidence({
      confidence: 0.3,
      risk: 'HIGH' as RiskLevel,
      expectedSuccess: 0.2,
      estimatedImpact: 0.9,
      reasons: ['custom'],
    });
    const entry = evaluator.evaluate([], baseContext);
    expect(entry).toMatchObject({ confidence: 0.3, risk: 'HIGH', expectedSuccess: 0.2, estimatedImpact: 0.9, reasons: ['custom'] });
  });
});

describe('clearsThreshold', () => {
  it('is true when confidence meets the threshold', () => {
    expect(clearsThreshold(scoreFrom(0.7), 0.7)).toBe(true);
  });
  it('is true when confidence exceeds the threshold', () => {
    expect(clearsThreshold(scoreFrom(0.8), 0.7)).toBe(true);
  });
  it('is false when confidence is below the threshold', () => {
    expect(clearsThreshold(scoreFrom(0.6), 0.7)).toBe(false);
  });
});

describe('confid.ConfidenceGate', () => {
  it('passes a score at or above the threshold', () => {
    const gate = confidenceGate(0.7);
    expect(gate.check(scoreFrom(0.7)).pass).toBe(true);
  });
  it('rejects a score below the threshold', () => {
    const gate = confidenceGate(0.7);
    const decision = gate.check(scoreFrom(0.5));
    expect(decision.pass).toBe(false);
    expect(decision.message).toContain('below');
  });
  it('defaults the threshold to 0.7', () => {
    expect(confidenceGate().threshold).toBe(0.7);
  });
  it('reports score and threshold in the decision', () => {
    const gate = confidenceGate(0.6);
    const decision = gate.check(scoreFrom(0.65));
    expect(decision.threshold).toBe(0.6);
    expect(decision.score).toBe(0.65);
  });
  it('DefaultConfidenceGate honours a custom threshold', () => {
    const gate = new DefaultConfidenceGate(0.9);
    expect(gate.check(scoreFrom(0.85)).pass).toBe(false);
  });
});

describe('maxConfidence', () => {
  it('returns null for an empty batch', () => {
    expect(maxConfidence([])).toBeNull();
  });
  it('returns the highest-confidence score', () => {
    const best = maxConfidence([scoreFrom(0.4), scoreFrom(0.9), scoreFrom(0.2)]);
    expect(best?.confidence).toBe(0.9);
  });
  it('returns the sole score for a single-entry batch', () => {
    expect(maxConfidence([scoreFrom(0.55)])?.confidence).toBe(0.55);
  });
});

function scoreFrom(confidence: number) {
  return fixedConfidence({ confidence }).evaluate([], baseContext);
}