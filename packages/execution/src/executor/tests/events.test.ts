import { describe, it, expect } from 'vitest';
import {
  EXECUTION_EVENT_TYPES,
  EXECUTION_EVENT_TYPE_VALUES,
  STEP_EVENT_TYPES,
} from '../events.js';

describe('EXECUTION_EVENT_TYPES', () => {
  it('defines all twelve event types', () => {
    expect(Object.keys(EXECUTION_EVENT_TYPES)).toHaveLength(12);
  });

  it('maps stable keys to stable values', () => {
    expect(EXECUTION_EVENT_TYPES.EXECUTION_STARTED).toBe('ExecutionStarted');
    expect(EXECUTION_EVENT_TYPES.PLAN_VALIDATED).toBe('PlanValidated');
    expect(EXECUTION_EVENT_TYPES.STEP_STARTED).toBe('StepStarted');
    expect(EXECUTION_EVENT_TYPES.STEP_COMPLETED).toBe('StepCompleted');
    expect(EXECUTION_EVENT_TYPES.STEP_FAILED).toBe('StepFailed');
    expect(EXECUTION_EVENT_TYPES.VERIFICATION_STARTED).toBe(
      'VerificationStarted',
    );
    expect(EXECUTION_EVENT_TYPES.VERIFICATION_PASSED).toBe(
      'VerificationPassed',
    );
    expect(EXECUTION_EVENT_TYPES.VERIFICATION_FAILED).toBe(
      'VerificationFailed',
    );
    expect(EXECUTION_EVENT_TYPES.EXECUTION_PAUSED).toBe('ExecutionPaused');
    expect(EXECUTION_EVENT_TYPES.EXECUTION_CANCELLED).toBe(
      'ExecutionCancelled',
    );
    expect(EXECUTION_EVENT_TYPES.EXECUTION_COMPLETED).toBe(
      'ExecutionCompleted',
    );
    expect(EXECUTION_EVENT_TYPES.EXECUTION_FAILED).toBe('ExecutionFailed');
  });
});

describe('EXECUTION_EVENT_TYPE_VALUES', () => {
  it('contains every value exactly once', () => {
    expect(new Set(EXECUTION_EVENT_TYPE_VALUES).size).toBe(
      EXECUTION_EVENT_TYPE_VALUES.length,
    );
  });

  it('is in the canonical declaration order', () => {
    expect(EXECUTION_EVENT_TYPE_VALUES).toEqual([
      'ExecutionStarted',
      'PlanValidated',
      'StepStarted',
      'StepCompleted',
      'StepFailed',
      'VerificationStarted',
      'VerificationPassed',
      'VerificationFailed',
      'ExecutionPaused',
      'ExecutionCancelled',
      'ExecutionCompleted',
      'ExecutionFailed',
    ]);
  });
});

describe('STEP_EVENT_TYPES', () => {
  it('contains only step lifecycle events', () => {
    expect(STEP_EVENT_TYPES).toEqual([
      'StepStarted',
      'StepCompleted',
      'StepFailed',
    ]);
  });

  it('is a subset of the full event set', () => {
    for (const type of STEP_EVENT_TYPES) {
      expect(EXECUTION_EVENT_TYPE_VALUES).toContain(type);
    }
  });
});
