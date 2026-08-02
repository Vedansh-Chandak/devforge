import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REASONING_LIMITS,
  resolveReasoningLimits,
  validateReasoningLimits,
  isModelCallLimit,
  isToolRoundLimit,
  isToolExecutionLimit,
  isDeadlineExceeded,
  isCancelled,
  checkOuterGuards,
  stableStringify,
  createToolFingerprint,
  createReasoningState,
  ReasoningStateKit,
  appendEvidence,
  estimateBytes,
  buildTruncationMarker,
  isTruncatedEvidence,
  totalEvidenceBytes,
  hasNewEvidence,
  incrementStreak,
  resetStreak,
  hasReachedNoProgressLimit,
  evaluateProgress,
  type EvidenceItem,
  type ReasoningLimits,
} from '../index.js';

const limits: ReasoningLimits = DEFAULT_REASONING_LIMITS;

describe('limits', () => {
  it('uses sane defaults', () => {
    expect(limits.maxModelCalls).toBe(5);
    expect(limits.maxToolRounds).toBe(4);
    expect(limits.maxToolExecutions).toBe(10);
    expect(limits.maxRepeatedToolCalls).toBe(2);
    expect(limits.maxDurationMs).toBe(30_000);
    expect(limits.maxEvidenceBytes).toBe(500_000);
    expect(limits.maxNoProgressRounds).toBe(2);
  });

  it('merges overrides and validates', () => {
    const merged = resolveReasoningLimits({ maxModelCalls: 3, maxDurationMs: 1_000 });
    expect(merged.maxModelCalls).toBe(3);
    expect(merged.maxDurationMs).toBe(1_000);
    expect(merged.maxToolRounds).toBe(DEFAULT_REASONING_LIMITS.maxToolRounds);
  });

  it('rejects invalid limits', () => {
    expect(() => resolveReasoningLimits({ maxModelCalls: 0 })).toThrow(/positive finite/);
    expect(() => resolveReasoningLimits({ maxDurationMs: -1 })).toThrow(/positive finite/);
    expect(() =>
      validateReasoningLimits({ ...limits, maxToolRounds: Number.NaN }),
    ).toThrow(/positive finite/);
  });

  it('checks individual limits correctly', () => {
    expect(isModelCallLimit(5, limits)).toBe(true);
    expect(isModelCallLimit(4, limits)).toBe(false);
    expect(isToolRoundLimit(4, limits)).toBe(true);
    expect(isToolExecutionLimit(10, limits)).toBe(true);
    expect(isDeadlineExceeded(101, 100)).toBe(true);
    expect(isDeadlineExceeded(100, 100)).toBe(false);
    expect(isCancelled(new AbortController().signal)).toBe(false);
    const ctrl = new AbortController();
    ctrl.abort();
    expect(isCancelled(ctrl.signal)).toBe(true);
    expect(isCancelled(undefined)).toBe(false);
  });

  it('checkOuterGuards returns the first tripped reason deterministically', () => {
    const base = {
      providerCalls: 0,
      toolRoundsCompleted: 0,
      totalToolExecutions: 0,
      nowMs: 0,
      deadlineMs: 1_000,
      limits,
    };
    expect(checkOuterGuards(base)).toBeNull();
    expect(checkOuterGuards({ ...base, providerCalls: 5 })).toBe('MODEL_CALL_LIMIT');
    expect(checkOuterGuards({ ...base, toolRoundsCompleted: 4 })).toBe('TOOL_ROUND_LIMIT');
    expect(checkOuterGuards({ ...base, totalToolExecutions: 10 })).toBe('TOOL_EXECUTION_LIMIT');
    expect(checkOuterGuards({ ...base, nowMs: 2_000 })).toBe('TIME_LIMIT');
    const ctrl = new AbortController();
    ctrl.abort();
    expect(checkOuterGuards({ ...base, signal: ctrl.signal })).toBe('CANCELLED');
  });
});

describe('fingerprint', () => {
  it('produces stable output regardless of key order', () => {
    const a = stableStringify({ b: 1, a: 2 });
    const b = stableStringify({ a: 2, b: 1 });
    expect(a).toBe(b);
  });

  it('sorts nested keys recursively', () => {
    const out = stableStringify({ z: { y: 1, x: 2 }, a: 3 });
    expect(out).toBe('{"a":3,"z":{"x":2,"y":1}}');
  });

  it('preserves array order', () => {
    expect(stableStringify({ list: [3, 1, 2] })).toBe('{"list":[3,1,2]}');
  });

  it('drops undefined/functions in objects and maps to null in arrays', () => {
    expect(stableStringify({ a: undefined, b: () => {} } as unknown as object)).toBe('{}');
    expect(stableStringify([undefined, 1, () => {}] as unknown as unknown[])).toBe('[null,1,null]');
  });

  it('createToolFingerprint distinguishes toolId and args', () => {
    expect(createToolFingerprint('repo.search', { query: 'A' })).toBe(
      createToolFingerprint('repo.search', { query: 'A' }),
    );
    expect(createToolFingerprint('repo.search', { query: 'A' })).not.toBe(
      createToolFingerprint('repo.search', { query: 'B' }),
    );
    expect(createToolFingerprint('a.b', { q: 1 })).not.toBe('a.c:{"q":1}');
  });
});

describe('state', () => {
  it('creates a fresh state with all counters at zero', () => {
    const s = createReasoningState(1_000, 31_000);
    expect(s.providerCalls).toBe(0);
    expect(s.toolRoundsCompleted).toBe(0);
    expect(s.totalToolExecutions).toBe(0);
    expect(s.duplicateSuppressions).toBe(0);
    expect(s.totalEvidenceBytes).toBe(0);
    expect(s.consecutiveNoProgressRounds).toBe(0);
    expect(s.terminationReason).toBeNull();
    expect(s.startTimeMs).toBe(1_000);
    expect(s.deadlineMs).toBe(31_000);
  });

  it('kit clamps negatives and floors inputs', () => {
    const kit = new ReasoningStateKit(createReasoningState(0, 1_000));
    kit.addProviderCalls(1.9);
    expect(kit.state.providerCalls).toBe(1);
    kit.addProviderCalls(-5);
    expect(kit.state.providerCalls).toBe(0);
  });

  it('termination reason is set-once', () => {
    const kit = new ReasoningStateKit(createReasoningState(0, 1_000));
    kit.setTerminationReason('MODEL_CALL_LIMIT');
    kit.setTerminationReason('TIME_LIMIT');
    expect(kit.state.terminationReason).toBe('MODEL_CALL_LIMIT');
  });

  it('progress counters track streaks', () => {
    const kit = new ReasoningStateKit(createReasoningState(0, 1_000));
    expect(kit.incrementNoProgress()).toBe(1);
    expect(kit.incrementNoProgress()).toBe(2);
    kit.resetNoProgress();
    expect(kit.state.consecutiveNoProgressRounds).toBe(0);
  });
});

describe('evidence', () => {
  const budget = { maxBytes: 50 };

  it('appends without mutating inputs', () => {
    const prev: EvidenceItem[] = [{ callId: 'c1', toolId: 't1', result: 'ok' }];
    const after = appendEvidence(prev, { callId: 'c2', toolId: 't2', result: 'ab' }, budget);
    expect(after).toHaveLength(2);
    expect(prev).toHaveLength(1);
  });

  it('truncates when exceeding the budget', () => {
    const big = 'x'.repeat(100); // JSON-len 102 with quotes
    const items = appendEvidence([], { callId: 'c1', toolId: 't1', result: big }, budget);
    const r = items[0]!.result;
    expect(isTruncatedEvidence(r)).toBe(true);
    expect((r as ReturnType<typeof buildTruncationMarker>).originalBytes).toBeGreaterThan(50);
  });

  it('estimateBytes uses JSON length and returns 0 on circular', () => {
    expect(estimateBytes({ a: 1 })).toBe(JSON.stringify({ a: 1 }).length);
    const circ: { self?: unknown } = {};
    circ.self = circ;
    expect(estimateBytes(circ)).toBe(0);
  });

  it('totalEvidenceBytes sums JSON lengths deterministically', () => {
    const items: EvidenceItem[] = [
      { callId: 'a', toolId: 't', result: { x: 1 } },
      { callId: 'b', toolId: 't', result: 'ab' },
    ];
    expect(totalEvidenceBytes(items)).toBe(
      JSON.stringify({ x: 1 }).length + JSON.stringify('ab').length,
    );
  });
});

describe('progress', () => {
  it('hasNewEvidence detects new and duplicates deterministically', () => {
    const prior: EvidenceItem[] = [{ callId: 'a', toolId: 't1', result: { x: 1 } }];
    const dup: EvidenceItem[] = [{ callId: 'b', toolId: 't1', result: { x: 1 } }];
    const novel: EvidenceItem[] = [{ callId: 'c', toolId: 't1', result: { x: 2 } }];
    expect(hasNewEvidence(prior, dup)).toBe(false);
    expect(hasNewEvidence(prior, novel)).toBe(true);
    expect(hasNewEvidence(prior, [])).toBe(false);
  });

  it('streak helpers are pure and bounded', () => {
    expect(incrementStreak(0)).toBe(1);
    expect(incrementStreak(5)).toBe(6);
    expect(resetStreak()).toBe(0);
    expect(hasReachedNoProgressLimit(2, 2)).toBe(true);
    expect(hasReachedNoProgressLimit(1, 2)).toBe(false);
  });

  it('evaluateProgress integrates streak math and detection', () => {
    const prior: EvidenceItem[] = [{ callId: 'a', toolId: 't', result: 1 }];
    const dup: EvidenceItem[] = [{ callId: 'b', toolId: 't', result: 1 }];
    const novel: EvidenceItem[] = [{ callId: 'c', toolId: 't', result: 2 }];

    expect(evaluateProgress({ priorItems: prior, newItems: novel, currentStreak: 1, maxNoProgressRounds: 2 }))
      .toEqual({ nextStreak: 0, reached: false, progressed: true });

    expect(evaluateProgress({ priorItems: prior, newItems: dup, currentStreak: 1, maxNoProgressRounds: 2 }))
      .toEqual({ nextStreak: 2, reached: true, progressed: false });
  });
});
