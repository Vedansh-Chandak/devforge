import { describe, it, expect } from 'vitest';
import { parseFailureAnalysis, parseRepairDecision } from '../reasoning-parser.js';
import { OUTPUT_TAGS } from '../prompt-builder.js';

function wrap(json: string): string {
  return `${OUTPUT_TAGS.REASONING_START}\n${json}\n${OUTPUT_TAGS.REASONING_END}`;
}

const ANALYSIS = {
  diagnosis: 'TypeScript error TS2304: Cannot find name foo',
  category: 'TYPE_ERROR',
  confidence: 0.95,
  suggestedPaths: ['src/main.ts'],
  estimatedComplexity: 2,
};

const DECISION = {
  strategy: 'PATCH',
  reason: 'Targeted patch on the affected file',
  targetFiles: ['src/main.ts'],
  scope: 'MINIMAL',
};

describe('parseFailureAnalysis', () => {
  it('parses a valid tagged analysis', () => {
    const result = parseFailureAnalysis(wrap(JSON.stringify(ANALYSIS)));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(ANALYSIS);
    }
  });

  it('parses raw JSON without tags', () => {
    const result = parseFailureAnalysis(JSON.stringify(ANALYSIS));
    expect(result.ok).toBe(true);
  });

  it('parses JSON with surrounding prose', () => {
    const result = parseFailureAnalysis(`Analysis: ${JSON.stringify(ANALYSIS)}`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.diagnosis).toBe(ANALYSIS.diagnosis);
    }
  });

  it('returns NO_TAGS_FOUND for empty input', () => {
    const result = parseFailureAnalysis('');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NO_TAGS_FOUND');
    }
  });

  it('returns INVALID_SCHEMA for missing diagnosis', () => {
    const result = parseFailureAnalysis(wrap(JSON.stringify({ category: 'OTHER', confidence: 0.5 })));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_SCHEMA');
    }
  });

  it('returns INVALID_SCHEMA for bad category', () => {
    const result = parseFailureAnalysis(wrap(JSON.stringify({ ...ANALYSIS, category: 'WEIRD' })));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_SCHEMA');
    }
  });

  it('returns INVALID_SCHEMA for confidence out of range', () => {
    const result = parseFailureAnalysis(wrap(JSON.stringify({ ...ANALYSIS, confidence: 1.5 })));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_SCHEMA');
    }
  });

  it('returns INVALID_SCHEMA for complexity out of range', () => {
    const result = parseFailureAnalysis(wrap(JSON.stringify({ ...ANALYSIS, estimatedComplexity: 11 })));
    expect(result.ok).toBe(false);
  });

  it('returns MALFORMED_JSON for invalid JSON', () => {
    const result = parseFailureAnalysis(wrap('{invalid json'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MALFORMED_JSON');
    }
  });

  it('defaults suggestedPaths to empty array when absent', () => {
    const result = parseFailureAnalysis(wrap(JSON.stringify({
      diagnosis: 'd',
      category: 'OTHER',
      confidence: 0.5,
      estimatedComplexity: 1,
    })));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.suggestedPaths).toEqual([]);
    }
  });
});

describe('parseRepairDecision', () => {
  it('parses a valid tagged decision', () => {
    const result = parseRepairDecision(wrap(JSON.stringify(DECISION)));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(DECISION);
    }
  });

  it('parses raw JSON without tags', () => {
    const result = parseRepairDecision(JSON.stringify(DECISION));
    expect(result.ok).toBe(true);
  });

  it('returns NO_TAGS_FOUND for empty input', () => {
    const result = parseRepairDecision('');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NO_TAGS_FOUND');
    }
  });

  it('returns INVALID_SCHEMA for invalid strategy', () => {
    const result = parseRepairDecision(wrap(JSON.stringify({ ...DECISION, strategy: 'SHRED' })));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_SCHEMA');
    }
  });

  it('returns INVALID_SCHEMA for missing reason', () => {
    const result = parseRepairDecision(wrap(JSON.stringify({ strategy: 'PATCH', targetFiles: [], scope: 'MINIMAL' })));
    expect(result.ok).toBe(false);
  });

  it('returns INVALID_SCHEMA for invalid scope', () => {
    const result = parseRepairDecision(wrap(JSON.stringify({ ...DECISION, scope: 'HUGE' })));
    expect(result.ok).toBe(false);
  });

  it('returns MALFORMED_JSON for invalid JSON', () => {
    const result = parseRepairDecision(wrap('[not json'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MALFORMED_JSON');
    }
  });

  it('filters non-string entries from targetFiles', () => {
    const result = parseRepairDecision(wrap(JSON.stringify({ ...DECISION, targetFiles: ['a.ts', 5, 'b.ts'] })));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.targetFiles).toEqual(['a.ts', 'b.ts']);
    }
  });
});
