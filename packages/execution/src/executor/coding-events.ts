/**
 * @devforge/execution — Autonomous coding event types (DF-016B).
 *
 * Events emitted by the autonomous coding engine. These are separate from
 * the executor's core event stream to maintain backward compatibility.
 */

import type { DiagnosticCategory } from './patch-model.js';

export type { DiagnosticCategory } from './patch-model.js';

export const CODING_EVENT_TYPES = {
  PATCH_GENERATION_STARTED: 'PatchGenerationStarted',
  PATCH_GENERATED: 'PatchGenerated',
  PATCH_VALIDATION_FAILED: 'PatchValidationFailed',
  WORKSPACE_TRANSACTION_STARTED: 'WorkspaceTransactionStarted',
  WORKSPACE_TRANSACTION_COMMITTED: 'WorkspaceTransactionCommitted',
  WORKSPACE_TRANSACTION_ROLLED_BACK: 'WorkspaceTransactionRolledBack',
  REPAIR_STARTED: 'RepairStarted',
  REPAIR_ATTEMPT: 'RepairAttempt',
  REPAIR_SUCCEEDED: 'RepairSucceeded',
  REPAIR_FAILED: 'RepairFailed',
  DIAGNOSTICS_CAPTURED: 'DiagnosticsCaptured',
  VERIFICATION_STARTED: 'CodingVerificationStarted',
  VERIFICATION_PASSED: 'CodingVerificationPassed',
  VERIFICATION_FAILED: 'CodingVerificationFailed',
  CODING_CANCELLED: 'CodingCancelled',
} as const;

export type CodingEventType = (typeof CODING_EVENT_TYPES)[keyof typeof CODING_EVENT_TYPES];

export const CODING_EVENT_TYPE_VALUES: readonly CodingEventType[] = [
  'PatchGenerationStarted',
  'PatchGenerated',
  'PatchValidationFailed',
  'WorkspaceTransactionStarted',
  'WorkspaceTransactionCommitted',
  'WorkspaceTransactionRolledBack',
  'RepairStarted',
  'RepairAttempt',
  'RepairSucceeded',
  'RepairFailed',
  'DiagnosticsCaptured',
  'CodingVerificationStarted',
  'CodingVerificationPassed',
  'CodingVerificationFailed',
  'CodingCancelled',
] as const;

interface CodingEventBase {
  readonly type: CodingEventType;
  readonly sequence: number;
  readonly timestamp: number;
  readonly runId: string;
}

export interface PatchGenerationStartedEvent extends CodingEventBase {
  readonly type: 'PatchGenerationStarted';
  readonly goal: string;
  readonly generatedCount: number;
}

export interface PatchGeneratedEvent extends CodingEventBase {
  readonly type: 'PatchGenerated';
  readonly patchesCount: number;
  readonly patchIds: readonly string[];
  readonly modelCalls: number;
}

export interface PatchValidationFailedEvent extends CodingEventBase {
  readonly type: 'PatchValidationFailed';
  readonly violationCount: number;
  readonly violations: readonly {
    readonly code: string;
    readonly message: string;
    readonly patchId?: string;
    readonly file?: string;
  }[];
}

export interface WorkspaceTransactionStartedEvent extends CodingEventBase {
  readonly type: 'WorkspaceTransactionStarted';
  readonly attempt: number;
  readonly patchesCount: number;
}

export interface WorkspaceTransactionCommittedEvent extends CodingEventBase {
  readonly type: 'WorkspaceTransactionCommitted';
  readonly attempt: number;
  readonly operationsApplied: number;
}

export interface WorkspaceTransactionRolledBackEvent extends CodingEventBase {
  readonly type: 'WorkspaceTransactionRolledBack';
  readonly attempt: number;
  readonly reason: string;
}

export interface RepairStartedEvent extends CodingEventBase {
  readonly type: 'RepairStarted';
  readonly maxAttempts: number;
}

export interface RepairAttemptEvent extends CodingEventBase {
  readonly type: 'RepairAttempt';
  readonly attempt: number;
  readonly strategy: string;
  readonly targetFiles: readonly string[];
  readonly modelCalls: number;
}

export interface RepairSucceededEvent extends CodingEventBase {
  readonly type: 'RepairSucceeded';
  readonly attempt: number;
  readonly totalAttempts: number;
}

export interface RepairFailedEvent extends CodingEventBase {
  readonly type: 'RepairFailed';
  readonly attemptsExhausted: number;
  readonly budgetExceeded: string | null;
}

export interface DiagnosticsCapturedEvent extends CodingEventBase {
  readonly type: 'DiagnosticsCaptured';
  readonly diagnosticsCount: number;
  readonly categories: readonly DiagnosticCategory[];
  readonly verificationDurationMs: number;
}

export interface CodingVerificationStartedEvent extends CodingEventBase {
  readonly type: 'CodingVerificationStarted';
  readonly attempt: number;
  readonly targetIds: readonly string[];
}

export interface CodingVerificationPassedEvent extends CodingEventBase {
  readonly type: 'CodingVerificationPassed';
  readonly attempt: number;
  readonly durationMs: number;
}

export interface CodingVerificationFailedEvent extends CodingEventBase {
  readonly type: 'CodingVerificationFailed';
  readonly attempt: number;
  readonly targetId: string;
  readonly exitCode: number | null;
}

export interface CodingCancelledEvent extends CodingEventBase {
  readonly type: 'CodingCancelled';
  readonly reason: string;
}

export type CodingEvent =
  | PatchGenerationStartedEvent
  | PatchGeneratedEvent
  | PatchValidationFailedEvent
  | WorkspaceTransactionStartedEvent
  | WorkspaceTransactionCommittedEvent
  | WorkspaceTransactionRolledBackEvent
  | RepairStartedEvent
  | RepairAttemptEvent
  | RepairSucceededEvent
  | RepairFailedEvent
  | DiagnosticsCapturedEvent
  | CodingVerificationStartedEvent
  | CodingVerificationPassedEvent
  | CodingVerificationFailedEvent
  | CodingCancelledEvent;

export type CodingEventInput =
  | Omit<PatchGenerationStartedEvent, 'sequence' | 'timestamp' | 'runId'>
  | Omit<PatchGeneratedEvent, 'sequence' | 'timestamp' | 'runId'>
  | Omit<PatchValidationFailedEvent, 'sequence' | 'timestamp' | 'runId'>
  | Omit<WorkspaceTransactionStartedEvent, 'sequence' | 'timestamp' | 'runId'>
  | Omit<WorkspaceTransactionCommittedEvent, 'sequence' | 'timestamp' | 'runId'>
  | Omit<WorkspaceTransactionRolledBackEvent, 'sequence' | 'timestamp' | 'runId'>
  | Omit<RepairStartedEvent, 'sequence' | 'timestamp' | 'runId'>
  | Omit<RepairAttemptEvent, 'sequence' | 'timestamp' | 'runId'>
  | Omit<RepairSucceededEvent, 'sequence' | 'timestamp' | 'runId'>
  | Omit<RepairFailedEvent, 'sequence' | 'timestamp' | 'runId'>
  | Omit<DiagnosticsCapturedEvent, 'sequence' | 'timestamp' | 'runId'>
  | Omit<CodingVerificationStartedEvent, 'sequence' | 'timestamp' | 'runId'>
  | Omit<CodingVerificationPassedEvent, 'sequence' | 'timestamp' | 'runId'>
  | Omit<CodingVerificationFailedEvent, 'sequence' | 'timestamp' | 'runId'>
  | Omit<CodingCancelledEvent, 'sequence' | 'timestamp' | 'runId'>;

/** Simple event bus for deterministic event emission and collection. */
export class CodingEventBus {
  private readonly _events: CodingEvent[] = [];
  private _sequence = 0;
  private readonly _runId: string;
  private readonly _now: () => number;
  private readonly _listeners: Set<(event: CodingEvent) => void> = new Set();

  constructor(runId: string, now?: () => number) {
    this._runId = runId;
    this._now = now ?? (() => Date.now());
  }

  get runId(): string {
    return this._runId;
  }

  get events(): readonly CodingEvent[] {
    return [...this._events];
  }

  onEvent(listener: (event: CodingEvent) => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  emit(input: CodingEventInput): void {
    const event = {
      ...input,
      sequence: this._sequence,
      timestamp: this._now(),
      runId: this._runId,
    } as CodingEvent;
    this._sequence += 1;
    this._events.push(event);
    for (const listener of this._listeners) {
      listener(event);
    }
  }

  reset(): void {
    this._events.length = 0;
    this._sequence = 0;
  }
}