/**
 * @devforge/execution — Executor events (DF-016A).
 *
 * The executor emits a strict, deterministic sequence of immutable events.
 * Every event carries a monotonically increasing `sequence` and a timestamp;
 * `sequence` is the authoritative ordering key so consumers never rely on
 * wall-clock ties.
 */

/** The twelve event types emitted by the executor. */
export const EXECUTION_EVENT_TYPES = {
  EXECUTION_STARTED: 'ExecutionStarted',
  PLAN_VALIDATED: 'PlanValidated',
  STEP_STARTED: 'StepStarted',
  STEP_COMPLETED: 'StepCompleted',
  STEP_FAILED: 'StepFailed',
  VERIFICATION_STARTED: 'VerificationStarted',
  VERIFICATION_PASSED: 'VerificationPassed',
  VERIFICATION_FAILED: 'VerificationFailed',
  EXECUTION_PAUSED: 'ExecutionPaused',
  EXECUTION_CANCELLED: 'ExecutionCancelled',
  EXECUTION_COMPLETED: 'ExecutionCompleted',
  EXECUTION_FAILED: 'ExecutionFailed',
} as const;

/** Discriminated union key. */
export type ExecutionEventType =
  (typeof EXECUTION_EVENT_TYPES)[keyof typeof EXECUTION_EVENT_TYPES];

/** Fields shared by every event. */
interface ExecutionEventBase {
  readonly type: ExecutionEventType;
  /** Monotonically increasing, gap-free ordinal (authoritative ordering). */
  readonly sequence: number;
  /** Milliseconds since epoch (injectable clock). */
  readonly timestamp: number;
  readonly planId: string;
}

export interface ExecutionStartedEvent extends ExecutionEventBase {
  readonly type: 'ExecutionStarted';
  readonly goal: string;
}

export interface PlanValidatedEvent extends ExecutionEventBase {
  readonly type: 'PlanValidated';
  readonly stepCount: number;
}

export interface StepStartedEvent extends ExecutionEventBase {
  readonly type: 'StepStarted';
  readonly stepId: string;
  readonly title: string;
}

export interface StepCompletedEvent extends ExecutionEventBase {
  readonly type: 'StepCompleted';
  readonly stepId: string;
  readonly durationMs: number;
}

export interface StepFailedEvent extends ExecutionEventBase {
  readonly type: 'StepFailed';
  readonly stepId: string;
  readonly errorCode: string;
  readonly message: string;
}

export interface VerificationStartedEvent extends ExecutionEventBase {
  readonly type: 'VerificationStarted';
  readonly stepId: string;
  readonly targetIds: readonly string[];
}

export interface VerificationPassedEvent extends ExecutionEventBase {
  readonly type: 'VerificationPassed';
  readonly stepId: string;
  readonly durationMs: number;
}

export interface VerificationFailedEvent extends ExecutionEventBase {
  readonly type: 'VerificationFailed';
  readonly stepId: string;
  readonly targetId: string;
  readonly exitCode: number | null;
}

export interface ExecutionPausedEvent extends ExecutionEventBase {
  readonly type: 'ExecutionPaused';
  readonly stepId: string;
  readonly reason: string;
}

export interface ExecutionCancelledEvent extends ExecutionEventBase {
  readonly type: 'ExecutionCancelled';
  readonly reason: string;
}

export interface ExecutionCompletedEvent extends ExecutionEventBase {
  readonly type: 'ExecutionCompleted';
  readonly durationMs: number;
  readonly stepCount: number;
}

export interface ExecutionFailedEvent extends ExecutionEventBase {
  readonly type: 'ExecutionFailed';
  readonly errorCode: string;
  readonly message: string;
  readonly stepId?: string;
}

/** The full event union, discriminated on `type`. */
export type ExecutionEvent =
  | ExecutionStartedEvent
  | PlanValidatedEvent
  | StepStartedEvent
  | StepCompletedEvent
  | StepFailedEvent
  | VerificationStartedEvent
  | VerificationPassedEvent
  | VerificationFailedEvent
  | ExecutionPausedEvent
  | ExecutionCancelledEvent
  | ExecutionCompletedEvent
  | ExecutionFailedEvent;

/** An event without the fields the executor injects (sequence/timestamp/planId). */
export type ExecutionEventInput =
  | Omit<ExecutionStartedEvent, 'sequence' | 'timestamp' | 'planId'>
  | Omit<PlanValidatedEvent, 'sequence' | 'timestamp' | 'planId'>
  | Omit<StepStartedEvent, 'sequence' | 'timestamp' | 'planId'>
  | Omit<StepCompletedEvent, 'sequence' | 'timestamp' | 'planId'>
  | Omit<StepFailedEvent, 'sequence' | 'timestamp' | 'planId'>
  | Omit<VerificationStartedEvent, 'sequence' | 'timestamp' | 'planId'>
  | Omit<VerificationPassedEvent, 'sequence' | 'timestamp' | 'planId'>
  | Omit<VerificationFailedEvent, 'sequence' | 'timestamp' | 'planId'>
  | Omit<ExecutionPausedEvent, 'sequence' | 'timestamp' | 'planId'>
  | Omit<ExecutionCancelledEvent, 'sequence' | 'timestamp' | 'planId'>
  | Omit<ExecutionCompletedEvent, 'sequence' | 'timestamp' | 'planId'>
  | Omit<ExecutionFailedEvent, 'sequence' | 'timestamp' | 'planId'>;

/** All event type values, as a readonly array (for validation/tests). */
export const EXECUTION_EVENT_TYPE_VALUES: readonly ExecutionEventType[] = [
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
];

/** Types that belong to step-level lifecycle (used by the report builder). */
export const STEP_EVENT_TYPES: readonly ExecutionEventType[] = [
  'StepStarted',
  'StepCompleted',
  'StepFailed',
];
