/**
 * @devforge/errors — lifecycle event model (DF-025 Phase 8).
 *
 * A consistent, deterministic lifecycle event model. Events can represent:
 * task started/completed, planning started/completed, model call
 * started/completed, tool execution started/completed, agent
 * started/completed, verification started/completed, repair started/
 * completed, memory retrieval, confirmation requested/accepted/rejected,
 * cancellation, timeout, failure.
 *
 * Events carry: event id, sequence, timestamp, component, operation, status,
 * and safe metadata. Never put secrets or raw credentials into events.
 *
 * This package is dependency-free so any subsystem can emit and any consumer
 * (CLI, reports, tests) can assert deterministic ordering.
 */

/** Component that produced a lifecycle event. */
export type LifecycleComponent =
  | "cli"
  | "brain"
  | "planner"
  | "execution"
  | "autonomous"
  | "multi-agent"
  | "verification"
  | "repair"
  | "memory"
  | "model-provider"
  | "tools"
  | "workspace"
  | "git";

/** Canonical lifecycle operations. */
export type LifecycleOperation =
  | "task"
  | "planning"
  | "model_call"
  | "tool_execution"
  | "agent"
  | "verification"
  | "repair"
  | "memory_retrieval"
  | "confirmation";

/** Terminal/observation status of an operation. */
export type LifecycleStatus =
  | "started"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out";

/** A single ordered lifecycle event. Immutable. */
export interface LifecycleEvent {
  /** Deterministic event id (`component:sequence`). */
  readonly id: string;
  /** Monotonic sequence number scoped to the emitter. */
  readonly sequence: number;
  /** ISO-8601 timestamp (injectable for determinism). */
  readonly timestamp: string;
  readonly component: LifecycleComponent;
  readonly operation: LifecycleOperation;
  readonly status: LifecycleStatus;
  /** Human-readable detail. MUST already be secret-free. */
  readonly message?: string;
  /** Optional cross-reference (e.g. step id, plan id, call id). */
  readonly itemId?: string;
  /** Safe metadata — never secrets. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Input for emitting an event; id/sequence/timestamp are derived. */
export interface LifecycleEventInput {
  readonly component: LifecycleComponent;
  readonly operation: LifecycleOperation;
  readonly status: LifecycleStatus;
  readonly message?: string;
  readonly itemId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Options controlling the emitter's deterministic clocks. */
export interface LifecycleEmitterOptions {
  readonly now?: () => string;
}

/**
 * Deterministic lifecycle event emitter. Produces a strictly increasing
 * sequence so consumers can assert ordering. Stateless aside from its counter.
 */
export class LifecycleEmitter {
  private readonly now: () => string;
  private sequence = 0;
  private readonly store: LifecycleEvent[] = [];

  constructor(options: LifecycleEmitterOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  emit(input: LifecycleEventInput): LifecycleEvent {
    const sequence = this.sequence;
    this.sequence += 1;
    const event: LifecycleEvent = {
      id: `${input.component}:${sequence}`,
      sequence,
      timestamp: this.now(),
      component: input.component,
      operation: input.operation,
      status: input.status,
      ...(input.message ? { message: input.message } : {}),
      ...(input.itemId ? { itemId: input.itemId } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };
    this.store.push(event);
    return event;
  }

  /** All events emitted so far, in order. */
  get events(): readonly LifecycleEvent[] {
    return [...this.store];
  }

  /** Snapshot of events, optionally filtered to one operation. */
  eventsFor(operation: LifecycleOperation): readonly LifecycleEvent[] {
    return this.store.filter((event) => event.operation === operation);
  }

  get count(): number {
    return this.store.length;
  }
}

/** Convenience builders mirroring the Phase 8 event catalogue. */
export const lifecycle = {
  taskStarted(): LifecycleEventInput {
    return { component: "cli", operation: "task", status: "started" };
  },
  taskCompleted(): LifecycleEventInput {
    return { component: "cli", operation: "task", status: "completed" };
  },
  planningStarted(): LifecycleEventInput {
    return { component: "planner", operation: "planning", status: "started" };
  },
  planningCompleted(): LifecycleEventInput {
    return { component: "planner", operation: "planning", status: "completed" };
  },
  planningFailed(message: string): LifecycleEventInput {
    return { component: "planner", operation: "planning", status: "failed", message };
  },
  modelCallStarted(meta?: Readonly<Record<string, unknown>>): LifecycleEventInput {
    return { component: "model-provider", operation: "model_call", status: "started", metadata: meta };
  },
  modelCallCompleted(meta?: Readonly<Record<string, unknown>>): LifecycleEventInput {
    return { component: "model-provider", operation: "model_call", status: "completed", metadata: meta };
  },
  modelCallFailed(message: string): LifecycleEventInput {
    return { component: "model-provider", operation: "model_call", status: "failed", message };
  },
  toolExecuted(toolId: string, meta?: Readonly<Record<string, unknown>>): LifecycleEventInput {
    return { component: "tools", operation: "tool_execution", status: "completed", itemId: toolId, metadata: meta };
  },
  toolRejected(toolId: string, reason: string): LifecycleEventInput {
    return { component: "tools", operation: "tool_execution", status: "failed", itemId: toolId, message: reason };
  },
  verificationStarted(): LifecycleEventInput {
    return { component: "verification", operation: "verification", status: "started" };
  },
  verificationCompleted(meta?: Readonly<Record<string, unknown>>): LifecycleEventInput {
    return { component: "verification", operation: "verification", status: "completed", metadata: meta };
  },
  verificationFailed(message: string): LifecycleEventInput {
    return { component: "verification", operation: "verification", status: "failed", message };
  },
  repairStarted(attempt: number): LifecycleEventInput {
    return { component: "repair", operation: "repair", status: "started", metadata: { attempt } };
  },
  repairCompleted(): LifecycleEventInput {
    return { component: "repair", operation: "repair", status: "completed" };
  },
  repairExhausted(message: string): LifecycleEventInput {
    return { component: "repair", operation: "repair", status: "failed", message };
  },
  cancellation(message: string): LifecycleEventInput {
    return { component: "cli", operation: "task", status: "cancelled", message };
  },
  timeout(message: string): LifecycleEventInput {
    return { component: "cli", operation: "task", status: "timed_out", message };
  },
  failure(message: string): LifecycleEventInput {
    return { component: "cli", operation: "task", status: "failed", message };
  },
  memoryRetrieved(meta?: Readonly<Record<string, unknown>>): LifecycleEventInput {
    return { component: "memory", operation: "memory_retrieval", status: "completed", metadata: meta };
  },
  confirmationRequested(message: string): LifecycleEventInput {
    return { component: "execution", operation: "confirmation", status: "started", message };
  },
  confirmationAccepted(): LifecycleEventInput {
    return { component: "execution", operation: "confirmation", status: "completed", message: "confirmed" };
  },
  confirmationRejected(): LifecycleEventInput {
    return { component: "execution", operation: "confirmation", status: "cancelled", message: "rejected" };
  },
};