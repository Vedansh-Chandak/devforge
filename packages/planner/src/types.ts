/**
 * Planning Engine types (DF-012).
 *
 * The planner converts a natural-language developer request into a
 * validated ExecutionPlan. It never executes anything — this module
 * defines the shape of the plan and the result of planning only.
 */

/** Complexity classification of an execution plan. */
export type PlanComplexity = 'LOW' | 'MEDIUM' | 'HIGH';

/** Risk classification of an execution plan. */
export type PlanRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Type of a single plan step. */
export type PlanStepType =
  | 'SEARCH'
  | 'READ'
  | 'ANALYZE'
  | 'PLAN'
  | 'EDIT'
  | 'CREATE'
  | 'DELETE'
  | 'VERIFY'
  | 'COMMAND';

/** All valid complexity values (used for validation). */
export const PLAN_COMPLEXITIES: readonly PlanComplexity[] = ['LOW', 'MEDIUM', 'HIGH'];

/** All valid risk values (used for validation). */
export const PLAN_RISKS: readonly PlanRisk[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

/** All valid step types (used for validation). */
export const PLAN_STEP_TYPES: readonly PlanStepType[] = [
  'SEARCH',
  'READ',
  'ANALYZE',
  'PLAN',
  'EDIT',
  'CREATE',
  'DELETE',
  'VERIFY',
  'COMMAND',
];

/** A single step in an execution plan. */
export interface PlanStep {
  /** Unique step identifier within the plan (e.g. "step-1"). */
  readonly id: string;
  /** Short human-readable title. */
  readonly title: string;
  /** Longer description of what this step does. */
  readonly description: string;
  /** Step category. */
  readonly type: PlanStepType;
  /** IDs of steps that must complete before this one. */
  readonly dependsOn: readonly string[];
  /** Relative effort estimate (deterministic, unitless). */
  readonly estimatedCost: number;
  /** Whether executing this step requires explicit user confirmation. */
  readonly requiresConfirmation: boolean;
}

/** A validated execution plan. */
export interface ExecutionPlan {
  /** Restated developer goal. */
  readonly goal: string;
  /** One-paragraph summary of the plan. */
  readonly summary: string;
  readonly complexity: PlanComplexity;
  readonly risk: PlanRisk;
  /** Whether the whole plan requires user confirmation before execution. */
  readonly requiresConfirmation: boolean;
  /** Ordered steps. `dependsOn` enforces ordering between steps. */
  readonly steps: readonly PlanStep[];
  /** Assumptions the plan makes. */
  readonly assumptions: readonly string[];
  /** Deterministic expectations produced by executing the plan. */
  readonly expectedOutputs: readonly string[];
}

/** A structured planning failure. */
export interface PlanningError {
  readonly code: string;
  readonly message: string;
  /** Whether a retry could reasonably succeed. */
  readonly retryable: boolean;
}

/** Outcome of a planning request. */
export type PlanResult =
  | {
      readonly ok: true;
      readonly plan: ExecutionPlan;
      /** Model that produced the plan, when a model was used. */
      readonly model?: string;
    }
  | {
      readonly ok: false;
      readonly error: PlanningError;
    };
