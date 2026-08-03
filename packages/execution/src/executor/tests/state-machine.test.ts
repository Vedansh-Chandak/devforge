import { describe, it, expect } from 'vitest';
import { ExecutorError } from '../errors.js';
import {
  CANCELLABLE_STATES,
  CONFIRMATION_STATES,
  EXECUTOR_STATES,
  EXECUTOR_STATE_NAMES,
  StateMachine,
  TERMINAL_STATES,
  isExecutorState,
} from '../state-machine.js';

describe('StateMachine', () => {
  it('starts in INITIAL with a path containing only INITIAL', () => {
    const machine = new StateMachine();
    expect(machine.state).toBe('INITIAL');
    expect(machine.path).toEqual(['INITIAL']);
    expect(machine.done).toBe(false);
  });

  it('follows the canonical happy path to DONE', () => {
    const machine = new StateMachine();
    machine.transition('PLAN_VALIDATED');
    machine.transition('READY');
    machine.transition('STEP_STARTED');
    machine.transition('STEP_EXECUTING');
    machine.transition('STEP_COMPLETED');
    machine.transition('NEXT_STEP');
    machine.transition('STEP_STARTED');
    machine.transition('STEP_EXECUTING');
    machine.transition('STEP_COMPLETED');
    machine.transition('DONE');
    expect(machine.state).toBe('DONE');
    expect(machine.done).toBe(true);
    expect(machine.path).toEqual([
      'INITIAL',
      'PLAN_VALIDATED',
      'READY',
      'STEP_STARTED',
      'STEP_EXECUTING',
      'STEP_COMPLETED',
      'NEXT_STEP',
      'STEP_STARTED',
      'STEP_EXECUTING',
      'STEP_COMPLETED',
      'DONE',
    ]);
  });

  it('follows the confirmation path through WAIT_CONFIRMATION', () => {
    const machine = new StateMachine();
    machine.transition('PLAN_VALIDATED');
    machine.transition('READY');
    machine.transition('STEP_STARTED');
    machine.transition('WAIT_CONFIRMATION');
    expect(machine.awaitingConfirmation).toBe(true);
    machine.transition('STEP_EXECUTING');
    machine.transition('STEP_COMPLETED');
    machine.transition('DONE');
    expect(machine.state).toBe('DONE');
  });

  it('follows the failure path through STEP_FAILED to EXECUTION_FAILED', () => {
    const machine = new StateMachine();
    machine.transition('PLAN_VALIDATED');
    machine.transition('READY');
    machine.transition('STEP_STARTED');
    machine.transition('STEP_EXECUTING');
    machine.transition('STEP_FAILED');
    machine.transition('EXECUTION_FAILED');
    expect(machine.state).toBe('EXECUTION_FAILED');
    expect(machine.done).toBe(true);
  });

  it('follows the cancellation path to CANCELLED', () => {
    const machine = new StateMachine();
    machine.transition('PLAN_VALIDATED');
    machine.transition('READY');
    machine.transition('CANCELLED');
    expect(machine.state).toBe('CANCELLED');
    expect(machine.done).toBe(true);
  });

  it('rejects an undeclared transition', () => {
    const machine = new StateMachine();
    expect(() => machine.transition('DONE')).toThrowError(
      expect.objectContaining({ code: 'INVALID_TRANSITION' }),
    );
  });

  it('rejects a STEP_STARTED -> DONE shortcut', () => {
    const machine = new StateMachine();
    machine.transition('PLAN_VALIDATED');
    machine.transition('READY');
    machine.transition('STEP_STARTED');
    expect(() => machine.transition('DONE')).toThrowError(
      expect.objectContaining({ code: 'INVALID_TRANSITION' }),
    );
  });

  it('rejects leaving a terminal state', () => {
    const machine = new StateMachine();
    machine.transition('PLAN_VALIDATED');
    machine.transition('READY');
    machine.transition('STEP_STARTED');
    machine.transition('STEP_EXECUTING');
    machine.transition('STEP_COMPLETED');
    machine.transition('DONE');
    expect(() => machine.transition('STEP_STARTED')).toThrowError(
      expect.objectContaining({ code: 'INVALID_TRANSITION' }),
    );
  });

  it('includes the offending states in the error message', () => {
    const machine = new StateMachine();
    try {
      machine.transition('STEP_COMPLETED');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ExecutorError);
      expect((error as Error).message).toContain('INITIAL');
      expect((error as Error).message).toContain('STEP_COMPLETED');
    }
  });

  it('reset returns to INITIAL and clears history', () => {
    const machine = new StateMachine();
    machine.transition('PLAN_VALIDATED');
    machine.transition('READY');
    machine.reset();
    expect(machine.state).toBe('INITIAL');
    expect(machine.path).toEqual(['INITIAL']);
    expect(machine.done).toBe(false);
  });

  it('reset allows a previously completed machine to be reused', () => {
    const machine = new StateMachine();
    machine.transition('PLAN_VALIDATED');
    machine.transition('READY');
    machine.transition('STEP_STARTED');
    machine.transition('STEP_EXECUTING');
    machine.transition('STEP_COMPLETED');
    machine.transition('DONE');
    expect(machine.done).toBe(true);
    machine.reset();
    expect(machine.done).toBe(false);
    machine.transition('PLAN_VALIDATED');
    expect(machine.state).toBe('PLAN_VALIDATED');
  });
});

describe('state constants', () => {
  it('EXECUTOR_STATES lists every state in declaration order', () => {
    expect(EXECUTOR_STATES).toEqual([
      'INITIAL',
      'PLAN_VALIDATED',
      'READY',
      'STEP_STARTED',
      'STEP_EXECUTING',
      'WAIT_CONFIRMATION',
      'STEP_COMPLETED',
      'STEP_FAILED',
      'NEXT_STEP',
      'EXECUTION_FAILED',
      'DONE',
      'CANCELLED',
    ]);
  });

  it('EXECUTOR_STATE_NAMES mirrors EXECUTOR_STATES', () => {
    expect(EXECUTOR_STATE_NAMES).toEqual(EXECUTOR_STATES);
  });

  it('terminal states do not overlap with cancellable states', () => {
    for (const terminal of TERMINAL_STATES) {
      expect(CANCELLABLE_STATES).not.toContain(terminal);
    }
  });

  it('confirmation states are cancellable', () => {
    for (const state of CONFIRMATION_STATES) {
      expect(CANCELLABLE_STATES).toContain(state);
    }
  });

  it('isExecutorState recognises valid states', () => {
    expect(isExecutorState('INITIAL')).toBe(true);
    expect(isExecutorState('DONE')).toBe(true);
    expect(isExecutorState('BOGUS')).toBe(false);
  });
});
