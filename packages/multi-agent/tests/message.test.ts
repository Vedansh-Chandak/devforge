import { describe, expect, it } from 'vitest';
import {
  buildMessage,
  runStarted,
  runCompleted,
  runCancelled,
  runTimedOut,
  taskAssigned,
  taskProgress,
  taskFailed,
  taskSucceeded,
  taskSkipped,
  taskCancelled,
  confirmationPending,
  confirmationApproved,
  confirmationRejected,
  verificationPassed,
  verificationFailed,
  repairRequested,
  reviewComment,
  merged,
  conflict,
  statusMessageType,
  canonicalKind,
} from '../src/message.js';

describe('buildMessage', () => {
  it('stamps deterministic id from runId and index', () => {
    const m = buildMessage('run-1', 3, {
      type: 'TASK_ASSIGNED',
      at: 50,
      taskId: 't1',
      role: 'CODER',
      summary: 'assigned',
    });
    expect(m.id).toBe('run-1:3');
    expect(m.index).toBe(3);
    expect(m.runId).toBe('run-1');
    expect(m.at).toBe(50);
    expect(m.taskId).toBe('t1');
    expect(m.role).toBe('CODER');
  });

  it('defaults payload to an empty object', () => {
    const m = buildMessage('r', 0, { type: 'MERGED', at: 0, summary: 's' });
    expect(m.payload).toEqual({});
  });
});

describe('message factories', () => {
  it('runStarted carries the goal', () => {
    const m = runStarted({ at: 1, goal: 'build auth' });
    expect(m.type).toBe('RUN_STARTED');
    expect(m.payload).toEqual({ goal: 'build auth' });
    expect(m.summary).toContain('build auth');
  });

  it('taskAssigned carries role and task', () => {
    const m = taskAssigned({ at: 2, taskId: 't1', role: 'CODER', title: 'Do it' });
    expect(m.type).toBe('TASK_ASSIGNED');
    expect(m.taskId).toBe('t1');
    expect(m.role).toBe('CODER');
  });

  it('taskSucceeded counts artifacts', () => {
    const m = taskSucceeded({ at: 3, taskId: 't1', role: 'CODER', artifacts: 2 });
    expect(m.payload.artifacts).toBe(2);
  });

  it('taskFailed carries the error code', () => {
    const m = taskFailed({ at: 4, taskId: 't1', role: 'CODER', code: 'MA_X', message: 'nope' });
    expect(m.type).toBe('TASK_FAILED');
    expect(m.payload.code).toBe('MA_X');
    expect(m.payload.message).toBe('nope');
  });

  it('confirmation messages tag the task', () => {
    expect(confirmationPending({ at: 5, taskId: 't1', role: 'CODER', title: 'T' }).type).toBe(
      'CONFIRMATION_PENDING',
    );
    expect(confirmationApproved({ at: 6, taskId: 't1' }).type).toBe('CONFIRMATION_APPROVED');
    expect(confirmationRejected({ at: 7, taskId: 't1' }).type).toBe('CONFIRMATION_REJECTED');
  });

  it('verification messages carry duration and target', () => {
    expect(verificationPassed({ at: 8, durationMs: 12 }).type).toBe('VERIFICATION_PASSED');
    const failed = verificationFailed({ at: 9, failedTargetId: 'build', durationMs: 3 });
    expect(failed.type).toBe('VERIFICATION_FAILED');
    expect(failed.payload.failedTargetId).toBe('build');
  });

  it('repairRequested records the attempt', () => {
    const m = repairRequested({ at: 10, target: 'build', failure: 'x', attempt: 2 });
    expect(m.payload.attempt).toBe(2);
    expect(m.payload.target).toBe('build');
  });

  it('reviewComment is attributed to the reviewer', () => {
    const m = reviewComment({
      at: 11,
      taskId: 't1',
      path: 'src/a.ts',
      blocking: true,
      comment: 'fix me',
    });
    expect(m.role).toBe('REVIEWER');
    expect(m.payload.blocking).toBe(true);
    expect(m.payload.path).toBe('src/a.ts');
  });

  it('merge and conflict messages carry counts and paths', () => {
    expect(merged({ at: 12, files: 4, conflicts: 1 }).type).toBe('MERGED');
    const c = conflict({ at: 13, path: 'a.ts', taskIds: ['t1', 't2'] });
    expect(c.type).toBe('CONFLICT');
    expect(c.payload.taskIds).toEqual(['t1', 't2']);
  });

  it('taskProgress carries the note', () => {
    const m = taskProgress({ at: 14, taskId: 't1', role: 'CODER', note: 'working' });
    expect(m.type).toBe('TASK_PROGRESS');
    expect(m.payload.note).toBe('working');
  });

  it('taskSkipped records the reason', () => {
    const m = taskSkipped({ at: 15, taskId: 't1', role: 'TESTER', reason: 'dependency failed' });
    expect(m.type).toBe('TASK_SKIPPED');
    expect(m.payload.reason).toBe('dependency failed');
  });

  it('taskCancelled tags the cancelled task', () => {
    const m = taskCancelled({ at: 16, taskId: 't1', role: 'CODER' });
    expect(m.type).toBe('TASK_CANCELLED');
    expect(m.taskId).toBe('t1');
  });

  it('runCompleted carries outcome and ok', () => {
    const m = runCompleted({ at: 17, outcome: 'SUCCESS', ok: true });
    expect(m.type).toBe('RUN_COMPLETED');
    expect(m.payload.outcome).toBe('SUCCESS');
    expect(m.payload.ok).toBe(true);
  });

  it('runCancelled and runTimedOut post terminal messages', () => {
    expect(runCancelled({ at: 18 }).type).toBe('RUN_CANCELLED');
    expect(runTimedOut({ at: 19 }).type).toBe('RUN_TIMED_OUT');
  });

  it('buildMessage deep-copies the payload', () => {
    const draft = { type: 'MERGED' as const, at: 0, summary: 's', payload: { a: 1 } };
    const m = buildMessage('r', 0, draft);
    expect(m.payload).toEqual({ a: 1 });
  });
});

describe('statusMessageType', () => {
  it('maps succeeded/failed/skipped/cancelled', () => {
    expect(statusMessageType('SUCCEEDED')).toBe('TASK_SUCCEEDED');
    expect(statusMessageType('FAILED')).toBe('TASK_FAILED');
    expect(statusMessageType('SKIPPED')).toBe('TASK_SKIPPED');
    expect(statusMessageType('CANCELLED')).toBe('TASK_CANCELLED');
  });

  it('returns null for non-terminal states', () => {
    expect(statusMessageType('PENDING')).toBeNull();
    expect(statusMessageType('RUNNING')).toBeNull();
  });
});

describe('canonicalKind', () => {
  it('maps task kinds to artifact kinds', () => {
    expect(canonicalKind('IMPLEMENT')).toBe('FILE');
    expect(canonicalKind('REPAIR')).toBe('PATCH');
    expect(canonicalKind('DOCUMENT')).toBe('DOC');
    expect(canonicalKind('TEST')).toBe('TEST');
    expect(canonicalKind('PLAN')).toBe('PLAN');
    expect(canonicalKind('REVIEW')).toBe('NOTE');
  });
});