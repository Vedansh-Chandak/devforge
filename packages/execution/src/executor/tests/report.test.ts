import { describe, it, expect } from 'vitest';
import {
  buildExecutionReport,
  collateRollbackRecords,
  makeRollbackToken,
  tokenizeRollback,
} from '../report.js';

const ISO = '2026-01-01T00:00:00.000Z';
const START_MS = Date.UTC(2026, 0, 1);
const FINISH_MS = START_MS + 1000;

describe('buildExecutionReport', () => {
  it('formats epoch timestamps as ISO strings', () => {
    const report = buildExecutionReport({
      planId: 'p1',
      goal: 'goal',
      summary: 'summary',
      status: 'COMPLETED',
      startedAtMs: START_MS,
      finishedAtMs: FINISH_MS,
      steps: [],
      rollback: [],
      eventCount: 3,
      now: () => FINISH_MS,
    });
    expect(report.startedAt).toBe(ISO);
    expect(report.finishedAt).toBe('2026-01-01T00:00:01.000Z');
  });

  it('computes duration from start and finish', () => {
    const report = buildExecutionReport({
      planId: 'p1',
      goal: 'goal',
      summary: 'summary',
      status: 'COMPLETED',
      startedAtMs: START_MS,
      finishedAtMs: START_MS + 150,
      steps: [],
      rollback: [],
      eventCount: 3,
      now: () => START_MS + 150,
    });
    expect(report.durationMs).toBe(150);
  });

  it('uses now() for a still-running report and leaves finishedAt null', () => {
    const report = buildExecutionReport({
      planId: 'p1',
      goal: 'goal',
      summary: 'summary',
      status: 'RUNNING',
      startedAtMs: 100,
      finishedAtMs: null,
      steps: [],
      rollback: [],
      eventCount: 3,
      now: () => 500,
    });
    expect(report.finishedAt).toBeNull();
    expect(report.durationMs).toBe(400);
  });

  it('clamps a negative duration to zero', () => {
    const report = buildExecutionReport({
      planId: 'p1',
      goal: 'goal',
      summary: 'summary',
      status: 'COMPLETED',
      startedAtMs: 500,
      finishedAtMs: 100,
      steps: [],
      rollback: [],
      eventCount: 3,
      now: () => 100,
    });
    expect(report.durationMs).toBe(0);
  });

  it('preserves status, error, and event count', () => {
    const report = buildExecutionReport({
      planId: 'p1',
      goal: 'goal',
      summary: 'summary',
      status: 'FAILED',
      startedAtMs: 0,
      finishedAtMs: 10,
      steps: [],
      rollback: [],
      error: { code: 'STEP_EXECUTION_FAILED', message: 'boom', stepId: 's' },
      eventCount: 7,
      now: () => 10,
    });
    expect(report.status).toBe('FAILED');
    expect(report.error).toEqual({
      code: 'STEP_EXECUTION_FAILED',
      message: 'boom',
      stepId: 's',
    });
    expect(report.eventCount).toBe(7);
  });

  it('passes goal, summary, and step records through untouched', () => {
    const steps = [
      {
        stepId: 'a',
        title: 'A',
        type: 'SEARCH' as const,
        status: 'COMPLETED' as const,
        startedAt: ISO,
        finishedAt: ISO,
        durationMs: 0,
      },
    ];
    const report = buildExecutionReport({
      planId: 'p1',
      goal: 'Build it',
      summary: 'Plan summary',
      status: 'COMPLETED',
      startedAtMs: 0,
      finishedAtMs: 10,
      steps,
      rollback: [],
      eventCount: 5,
      now: () => 10,
    });
    expect(report.goal).toBe('Build it');
    expect(report.summary).toBe('Plan summary');
    expect(report.steps).toBe(steps);
  });

  it('keeps planId stable across builds for the same input', () => {
    const input = {
      planId: 'plan-x',
      goal: 'g',
      summary: 's',
      status: 'COMPLETED' as const,
      startedAtMs: 0,
      finishedAtMs: 5,
      steps: [],
      rollback: [],
      eventCount: 2,
      now: () => 5,
    };
    expect(buildExecutionReport(input).planId).toBe('plan-x');
  });
});

describe('makeRollbackToken', () => {
  it('is deterministic for the same step and index', () => {
    expect(makeRollbackToken('s1', 0)).toBe('rollback:s1:0');
    expect(makeRollbackToken('s1', 0)).toBe(makeRollbackToken('s1', 0));
  });

  it('differs across steps and indexes', () => {
    expect(makeRollbackToken('s1', 0)).not.toBe(makeRollbackToken('s2', 0));
    expect(makeRollbackToken('s1', 0)).not.toBe(makeRollbackToken('s1', 1));
  });
});

describe('tokenizeRollback', () => {
  it('assigns sequential deterministic tokens', () => {
    const operations = [
      {
        stepId: 's',
        kind: 'WORKSPACE_WRITE' as const,
        token: '',
        description: 'a',
      },
      {
        stepId: 's',
        kind: 'WORKSPACE_CREATE' as const,
        token: '',
        description: 'b',
      },
    ];
    const tokenized = tokenizeRollback('s', operations);
    expect(tokenized.map((op) => op.token)).toEqual([
      'rollback:s:0',
      'rollback:s:1',
    ]);
    expect(tokenized[0]!.description).toBe('a');
  });
});

describe('collateRollbackRecords', () => {
  it('builds one record per step that has operations', () => {
    const steps = [
      {
        stepId: 's1',
        title: 'one',
        type: 'EDIT' as const,
        status: 'COMPLETED' as const,
        startedAt: ISO,
        finishedAt: ISO,
        durationMs: 0,
        rollback: [
          {
            stepId: 's1',
            kind: 'WORKSPACE_WRITE' as const,
            token: 'rollback:s1:0',
            description: 'w',
          },
        ],
      },
      {
        stepId: 's2',
        title: 'two',
        type: 'COMMAND' as const,
        status: 'COMPLETED' as const,
        startedAt: ISO,
        finishedAt: ISO,
        durationMs: 0,
        rollback: [],
      },
    ];
    const records = collateRollbackRecords(steps);
    expect(records).toHaveLength(1);
    expect(records[0]!.stepId).toBe('s1');
    expect(records[0]!.token).toBe('rollback:s1:0');
    expect(records[0]!.operations).toHaveLength(1);
  });

  it('returns an empty list when no step has operations', () => {
    const steps = [
      {
        stepId: 's1',
        title: 'one',
        type: 'SEARCH' as const,
        status: 'COMPLETED' as const,
        startedAt: ISO,
        finishedAt: ISO,
        durationMs: 0,
      },
    ];
    expect(collateRollbackRecords(steps)).toEqual([]);
  });
});
