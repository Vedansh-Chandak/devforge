import { describe, expect, it } from 'vitest';
import {
  AGENT_ROLES,
  ARTIFACT_KINDS,
  MESSAGE_TYPES,
  TASK_KINDS,
  TASK_STATUSES,
  rolePriority,
} from '../src/types.js';

describe('AGENT_ROLES / rolePriority', () => {
  it('lists every role exactly once', () => {
    expect(AGENT_ROLES).toHaveLength(6);
    expect(new Set(AGENT_ROLES).size).toBe(6);
    expect(AGENT_ROLES).toContain('PLANNER');
    expect(AGENT_ROLES).toContain('CODER');
    expect(AGENT_ROLES).toContain('REVIEWER');
    expect(AGENT_ROLES).toContain('TESTER');
    expect(AGENT_ROLES).toContain('REPAIR');
    expect(AGENT_ROLES).toContain('DOCUMENTATION');
  });

  it('assigns a deterministic priority to every role', () => {
    expect(rolePriority('PLANNER')).toBe(0);
    expect(rolePriority('CODER')).toBe(1);
    expect(rolePriority('TESTER')).toBe(2);
    expect(rolePriority('REVIEWER')).toBe(3);
    expect(rolePriority('REPAIR')).toBe(4);
    expect(rolePriority('DOCUMENTATION')).toBe(5);
  });

  it('produces unique priorities', () => {
    const priorities = AGENT_ROLES.map(rolePriority);
    expect(new Set(priorities).size).toBe(6);
  });

  it('priorities match canonical ordering', () => {
    const sorted = [...AGENT_ROLES].sort((a, b) => rolePriority(a) - rolePriority(b));
    expect(sorted).toEqual(AGENT_ROLES);
  });
});

describe('TASK_KINDS', () => {
  it('contains each task kind', () => {
    expect(TASK_KINDS).toContain('PLAN');
    expect(TASK_KINDS).toContain('IMPLEMENT');
    expect(TASK_KINDS).toContain('REVIEW');
    expect(TASK_KINDS).toContain('TEST');
    expect(TASK_KINDS).toContain('REPAIR');
    expect(TASK_KINDS).toContain('DOCUMENT');
    expect(TASK_KINDS).toHaveLength(6);
  });

  it('has no duplicates', () => {
    expect(new Set(TASK_KINDS).size).toBe(TASK_KINDS.length);
  });
});

describe('TASK_STATUSES', () => {
  it('covers the full lifecycle', () => {
    expect(TASK_STATUSES).toEqual([
      'PENDING',
      'ASSIGNED',
      'RUNNING',
      'SUCCEEDED',
      'FAILED',
      'SKIPPED',
      'CANCELLED',
    ]);
  });

  it('has no duplicates', () => {
    expect(new Set(TASK_STATUSES).size).toBe(TASK_STATUSES.length);
  });
});

describe('ARTIFACT_KINDS', () => {
  it('contains each artifact kind', () => {
    for (const kind of ['FILE', 'PATCH', 'NOTE', 'DOC', 'REPORT', 'TEST', 'PLAN']) {
      expect(ARTIFACT_KINDS).toContain(kind);
    }
    expect(ARTIFACT_KINDS).toHaveLength(7);
  });

  it('has no duplicates', () => {
    expect(new Set(ARTIFACT_KINDS).size).toBe(ARTIFACT_KINDS.length);
  });
});

describe('MESSAGE_TYPES', () => {
  it('contains the run lifecycle messages', () => {
    for (const type of [
      'RUN_STARTED',
      'TASK_ASSIGNED',
      'TASK_SUCCEEDED',
      'TASK_FAILED',
      'VERIFICATION_STARTED',
      'VERIFICATION_PASSED',
      'VERIFICATION_FAILED',
      'MERGED',
      'CONFLICT',
      'RUN_COMPLETED',
      'RUN_CANCELLED',
      'RUN_TIMED_OUT',
    ]) {
      expect(MESSAGE_TYPES).toContain(type);
    }
  });

  it('contains the review/repair/confirmation messages', () => {
    for (const type of [
      'REVIEW_COMMENT',
      'REPAIR_REQUESTED',
      'CONFIRMATION_PENDING',
      'CONFIRMATION_APPROVED',
      'CONFIRMATION_REJECTED',
      'TASK_SKIPPED',
      'TASK_CANCELLED',
      'TASK_PROGRESS',
    ]) {
      expect(MESSAGE_TYPES).toContain(type);
    }
  });

  it('has no duplicates', () => {
    expect(new Set(MESSAGE_TYPES).size).toBe(MESSAGE_TYPES.length);
  });
});