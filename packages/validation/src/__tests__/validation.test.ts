import { describe, it, expect } from 'vitest';
import {
  classifyFailure,
  computeSummary,
  extractFailures,
  formatReport,
  createBaseline,
  detectRegressions,
} from '../harness.js';
import { GOLDEN_QUESTIONS } from '../golden-questions.js';
import type { ValidationCaseResult, ValidationReport, ValidationBaseline } from '../types.js';

// ── Helper to build a mock case result ──
function mockCase(overrides: Partial<ValidationCaseResult> = {}): ValidationCaseResult {
  return {
    questionId: 'test',
    question: 'test question',
    intent: { expected: 'FindSymbol', actual: 'FindSymbol', matched: true },
    retrieval: { expectedSymbols: ['Foo'], foundSymbols: ['Foo'], matched: true },
    context: { expectedSymbols: ['Foo'], foundInPrompt: ['Foo'], matched: true },
    prompt: { expectedContains: ['Foo'], found: ['Foo'], matched: true },
    pipeline: { success: true, status: 'answered' },
    failureStage: null,
    duration: 100,
    diagnostics: { contextChars: 500, truncated: false, symbolCount: 3, dependencyCount: 1 },
    ...overrides,
  };
}

describe('classifyFailure', () => {
  it('returns null when all pass', () => {
    expect(classifyFailure(true, true, true, true, true)).toBeNull();
  });

  it('returns INTENT_FAILURE', () => {
    expect(classifyFailure(false, true, true, true, true)).toBe('INTENT_FAILURE');
  });

  it('returns RETRIEVAL_FAILURE', () => {
    expect(classifyFailure(true, false, true, true, true)).toBe('RETRIEVAL_FAILURE');
  });

  it('returns CONTEXT_FAILURE', () => {
    expect(classifyFailure(true, true, false, true, true)).toBe('CONTEXT_FAILURE');
  });

  it('returns PROMPT_FAILURE', () => {
    expect(classifyFailure(true, true, true, false, true)).toBe('PROMPT_FAILURE');
  });

  it('returns PROVIDER_FAILURE even if others fail', () => {
    expect(classifyFailure(false, false, false, false, false)).toBe('PROVIDER_FAILURE');
  });
});

describe('computeSummary', () => {
  it('computes correct summary', () => {
    const cases = [
      mockCase({ intent: { expected: 'A', actual: 'A', matched: true } }),
      mockCase({
        questionId: 'q2',
        intent: { expected: 'B', actual: 'C', matched: false },
        pipeline: { success: false, status: 'provider_error' },
      }),
    ];
    const summary = computeSummary(cases);
    expect(summary.totalQuestions).toBe(2);
    expect(summary.intentCorrect).toBe(1);
    expect(summary.pipelineSuccess).toBe(1);
  });
});

describe('extractFailures', () => {
  it('extracts cases with failures', () => {
    const cases = [
      mockCase({ failureStage: null }),
      mockCase({
        questionId: 'q2',
        failureStage: 'INTENT_FAILURE',
        intent: { expected: 'FindSymbol', actual: 'Search', matched: false },
      }),
    ];
    const failures = extractFailures(cases);
    expect(failures).toHaveLength(1);
    expect(failures[0].questionId).toBe('q2');
    expect(failures[0].stage).toBe('INTENT_FAILURE');
  });

  it('returns empty when no failures', () => {
    expect(extractFailures([mockCase()])).toHaveLength(0);
  });
});

describe('formatReport', () => {
  it('formats a report with no failures', () => {
    const report: ValidationReport = {
      repository: '/test',
      timestamp: '2026-01-01T00:00:00Z',
      summary: { totalQuestions: 1, intentCorrect: 1, retrievalMatched: 1, contextMatched: 1, promptMatched: 1, pipelineSuccess: 1 },
      cases: [mockCase()],
      failures: [],
    };
    const text = formatReport(report);
    expect(text).toContain('Intent:       1/1');
    expect(text).toContain('No Failures');
  });

  it('formats a report with failures', () => {
    const report: ValidationReport = {
      repository: '/test',
      timestamp: '2026-01-01T00:00:00Z',
      summary: { totalQuestions: 1, intentCorrect: 0, retrievalMatched: 0, contextMatched: 0, promptMatched: 0, pipelineSuccess: 0 },
      cases: [],
      failures: [{ questionId: 'q1', question: 'Find X', stage: 'INTENT_FAILURE', expected: 'FindSymbol', actual: 'Search' }],
    };
    const text = formatReport(report);
    expect(text).toContain('INTENT_FAILURE');
    expect(text).toContain('Find X');
  });
});

describe('createBaseline and detectRegressions', () => {
  it('creates baseline from report', () => {
    const report: ValidationReport = {
      repository: '/test',
      timestamp: '2026-01-01T00:00:00Z',
      summary: { totalQuestions: 1, intentCorrect: 1, retrievalMatched: 1, contextMatched: 1, promptMatched: 1, pipelineSuccess: 1 },
      cases: [mockCase({ questionId: 'q1' })],
      failures: [],
    };
    const baseline = createBaseline(report);
    expect(baseline.caseIntents['q1']).toBe('FindSymbol');
  });

  it('detects intent regression', () => {
    const baseline: ValidationBaseline = {
      timestamp: '2026-01-01T00:00:00Z',
      repository: '/test',
      summary: { totalQuestions: 1, intentCorrect: 1, retrievalMatched: 1, contextMatched: 1, promptMatched: 1, pipelineSuccess: 1 },
      caseIntents: { q1: 'FindSymbol' },
      caseRetrievalSymbols: { q1: [] },
      caseContextSymbols: { q1: [] },
    };
    const current: ValidationReport = {
      repository: '/test',
      timestamp: '2026-01-02T00:00:00Z',
      summary: { totalQuestions: 1, intentCorrect: 1, retrievalMatched: 1, contextMatched: 1, promptMatched: 1, pipelineSuccess: 1 },
      cases: [mockCase({ questionId: 'q1', intent: { expected: 'FindSymbol', actual: 'Search', matched: true } })],
      failures: [],
    };
    const regressions = detectRegressions(current, baseline);
    expect(regressions).toHaveLength(1);
    expect(regressions[0].regression).toContain('Intent changed');
  });

  it('detects lost context symbols', () => {
    const baseline: ValidationBaseline = {
      timestamp: '2026-01-01T00:00:00Z',
      repository: '/test',
      summary: { totalQuestions: 1, intentCorrect: 1, retrievalMatched: 1, contextMatched: 1, promptMatched: 1, pipelineSuccess: 1 },
      caseIntents: { q1: 'FindSymbol' },
      caseRetrievalSymbols: { q1: [] },
      caseContextSymbols: { q1: ['DevForgeRuntime', 'DevForgeBrain'] },
    };
    const current: ValidationReport = {
      repository: '/test',
      timestamp: '2026-01-02T00:00:00Z',
      summary: { totalQuestions: 1, intentCorrect: 1, retrievalMatched: 1, contextMatched: 1, promptMatched: 1, pipelineSuccess: 1 },
      cases: [mockCase({ questionId: 'q1', context: { expectedSymbols: ['DevForgeRuntime'], foundInPrompt: ['DevForgeRuntime'], matched: true } })],
      failures: [],
    };
    const regressions = detectRegressions(current, baseline);
    expect(regressions).toHaveLength(1);
    expect(regressions[0].regression).toContain('Lost context symbols');
    expect(regressions[0].regression).toContain('DevForgeBrain');
  });
});

describe('golden questions', () => {
  it('has 15 questions', () => {
    expect(GOLDEN_QUESTIONS).toHaveLength(15);
  });

  it('covers all intents', () => {
    const intents = new Set(GOLDEN_QUESTIONS.map((q) => q.expectation.intent));
    expect(intents.has('ExplainCode')).toBe(true);
    expect(intents.has('FindSymbol')).toBe(true);
    expect(intents.has('FindDependencies')).toBe(true);
    expect(intents.has('Architecture')).toBe(true);
    expect(intents.has('Search')).toBe(true);
  });

  it('each question has a unique id', () => {
    const ids = GOLDEN_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each question has non-empty expectation', () => {
    for (const q of GOLDEN_QUESTIONS) {
      expect(q.expectation.intent).toBeTruthy();
    }
  });
});