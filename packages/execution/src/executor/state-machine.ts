/**
 * @devforge/execution — Deterministic Executor state machine (DF-016A).
 *
 * The state machine is a pure, fully deterministic component: it owns the
 * single source of truth for the executor's state, permits only the
 * transitions declared below, and records every state it visits.
 */

import { ExecutorError } from './errors.js';
import type { ExecutorStateName } from './types.js';

/** All valid states, in a fixed declaration order. */
export const EXECUTOR_STATES = [
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
] as const satisfies readonly ExecutorStateName[];

/** Canonical, ordered list of state names (stable for callers). */
export const EXECUTOR_STATE_NAMES: readonly ExecutorStateName[] = [
  ...EXECUTOR_STATES,
];

/** States in which a run may still be interrupted. */
export const CANCELLABLE_STATES: readonly ExecutorStateName[] = [
  'INITIAL',
  'PLAN_VALIDATED',
  'READY',
  'STEP_STARTED',
  'STEP_EXECUTING',
  'WAIT_CONFIRMATION',
  'STEP_COMPLETED',
  'NEXT_STEP',
];

/** Terminal states. No transitions leave these. */
export const TERMINAL_STATES: readonly ExecutorStateName[] = [
  'DONE',
  'EXECUTION_FAILED',
  'CANCELLED',
];

/** States in which the executor is paused awaiting user confirmation. */
export const CONFIRMATION_STATES: readonly ExecutorStateName[] = [
  'WAIT_CONFIRMATION',
];

/** Declared transition table. Keys are the source state. */
const TRANSITIONS: Readonly<
  Record<ExecutorStateName, readonly ExecutorStateName[]>
> = {
  INITIAL: ['PLAN_VALIDATED', 'EXECUTION_FAILED', 'CANCELLED'],
  PLAN_VALIDATED: ['READY', 'EXECUTION_FAILED', 'CANCELLED'],
  READY: ['STEP_STARTED', 'EXECUTION_FAILED', 'CANCELLED'],
  STEP_STARTED: ['STEP_EXECUTING', 'WAIT_CONFIRMATION', 'CANCELLED'],
  STEP_EXECUTING: [
    'STEP_COMPLETED',
    'STEP_FAILED',
    'WAIT_CONFIRMATION',
    'CANCELLED',
  ],
  WAIT_CONFIRMATION: ['STEP_EXECUTING', 'CANCELLED'],
  STEP_COMPLETED: ['NEXT_STEP', 'DONE', 'CANCELLED'],
  STEP_FAILED: ['EXECUTION_FAILED'],
  NEXT_STEP: ['STEP_STARTED', 'DONE', 'CANCELLED'],
  EXECUTION_FAILED: [],
  DONE: [],
  CANCELLED: [],
};

/** The deterministic Executor state machine. */
export class StateMachine {
  private current: ExecutorStateName = 'INITIAL';
  private readonly history: ExecutorStateName[] = ['INITIAL'];

  /** The state the machine is currently in. */
  get state(): ExecutorStateName {
    return this.current;
  }

  /** Every state visited so far, in order (starts at INITIAL). */
  get path(): readonly ExecutorStateName[] {
    return [...this.history];
  }

  /** True when the machine has reached a terminal state. */
  get done(): boolean {
    return TERMINAL_STATES.includes(this.current);
  }

  /** True when the machine is paused waiting for confirmation. */
  get awaitingConfirmation(): boolean {
    return CONFIRMATION_STATES.includes(this.current);
  }

  /** Transition to `next`, throwing when the transition is not declared. */
  transition(next: ExecutorStateName): void {
    const allowed = TRANSITIONS[this.current];
    if (!allowed.includes(next)) {
      throw new ExecutorError(`Invalid transition ${this.current} -> ${next}`, {
        code: 'INVALID_TRANSITION',
      });
    }
    this.current = next;
    this.history.push(next);
  }

  /** Reset the machine to its initial state (reuse of a single executor). */
  reset(): void {
    this.current = 'INITIAL';
    this.history.length = 0;
    this.history.push('INITIAL');
  }
}

/** Validate that a name is a real executor state. */
export function isExecutorState(value: string): value is ExecutorStateName {
  return (EXECUTOR_STATES as readonly string[]).includes(value);
}
