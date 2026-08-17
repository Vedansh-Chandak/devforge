/**
 * @devforge/execution — Deterministic plan scheduler (DF-016A).
 *
 * Converts a validated ExecutionPlan into a deterministic execution order
 * via a stable topological sort (Kahn's algorithm with an ordered queue).
 * Rejects empty plans, duplicate step ids, missing dependencies, and
 * dependency cycles with typed scheduling errors.
 */

import type { ExecutionPlan, PlanStep } from '@devforge/planner';
import { ExecutorSchedulingError } from './errors.js';

/** The computed execution schedule for a plan. */
export interface Schedule {
  /** Step ids in deterministic topological execution order. */
  readonly order: readonly string[];
  /** Step lookup by id. */
  readonly steps: ReadonlyMap<string, PlanStep>;
  /** Parallel batches: each batch depends only on earlier batches. */
  readonly levels: readonly (readonly string[])[];
  readonly count: number;
}

/** Validate id uniqueness and dependency references, then topologically sort. */
export function buildSchedule(plan: ExecutionPlan): Schedule {
  if (plan.steps.length === 0) {
    throw new ExecutorSchedulingError('Plan contains no steps', {
      code: 'EMPTY_PLAN',
    });
  }

  const steps = new Map<string, PlanStep>();
  for (const step of plan.steps) {
    if (steps.has(step.id)) {
      throw new ExecutorSchedulingError(`Duplicate step id "${step.id}"`, {
        code: 'DUPLICATE_STEP_ID',
        stepId: step.id,
      });
    }
    steps.set(step.id, step);
  }

  for (const step of plan.steps) {
    for (const dep of step.dependsOn) {
      if (!steps.has(dep)) {
        throw new ExecutorSchedulingError(
          `Step "${step.id}" depends on unknown step "${dep}"`,
          { code: 'MISSING_DEPENDENCY', stepId: step.id },
        );
      }
    }
  }

  const order = topoSort(steps);
  return {
    order,
    steps,
    levels: computeLevels(steps, order),
    count: order.length,
  };
}

/** Stable topological sort. Queue is always re-sorted for determinism. */
function topoSort(steps: ReadonlyMap<string, PlanStep>): string[] {
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const step of steps.values()) {
    indegree.set(step.id, step.dependsOn.length);
    dependents.set(step.id, []);
  }
  for (const step of steps.values()) {
    for (const dep of step.dependsOn) {
      dependents.get(dep)?.push(step.id);
    }
  }

  const ready: string[] = [...steps.values()]
    .filter((step) => step.dependsOn.length === 0)
    .map((step) => step.id)
    .sort();

  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const dependent of dependents.get(id) ?? []) {
      const degree = (indegree.get(dependent) ?? 1) - 1;
      indegree.set(dependent, degree);
      if (degree === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
  }

  if (order.length !== steps.size) {
    const cyclic = [...steps.values()]
      .filter((step) => (indegree.get(step.id) ?? 0) > 0)
      .map((step) => step.id)
      .sort();
    throw new ExecutorSchedulingError(
      `Dependency cycle detected among steps: ${cyclic.join(', ')}`,
      { code: 'DEPENDENCY_CYCLE', stepId: cyclic[0] },
    );
  }

  return order;
}

/**
 * Split the ordered execution into parallel batches. Batch `k` contains the
 * steps whose dependencies are all in batches `< k`. Within a batch, ids are
 * sorted for determinism.
 */
function computeLevels(
  steps: ReadonlyMap<string, PlanStep>,
  order: readonly string[],
): readonly (readonly string[])[] {
  const batchOf = new Map<string, number>();
  for (const id of order) {
    const step = steps.get(id)!;
    let batch = 0;
    for (const dep of step.dependsOn) {
      batch = Math.max(batch, (batchOf.get(dep) ?? 0) + 1);
    }
    batchOf.set(id, batch);
  }
  const batchCount =
    order.reduce((max, id) => Math.max(max, batchOf.get(id) ?? 0), -1) + 1;
  const levels: string[][] = Array.from({ length: batchCount }, () => []);
  for (const id of order) {
    levels[batchOf.get(id) ?? 0]!.push(id);
  }
  return levels;
}

/** True when `order` is a valid topological order of the plan's steps. */
export function isTopologicalOrder(
  plan: ExecutionPlan,
  order: readonly string[],
): boolean {
  const position = new Map<string, number>();
  order.forEach((id, index) => position.set(id, index));
  if (position.size !== plan.steps.length) {
    return false;
  }
  for (const step of plan.steps) {
    if (!position.has(step.id)) {
      return false;
    }
    for (const dep of step.dependsOn) {
      const depPos = position.get(dep);
      if (depPos === undefined || depPos >= position.get(step.id)!) {
        return false;
      }
    }
  }
  return true;
}
