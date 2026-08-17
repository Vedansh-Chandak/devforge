/**
 * Plan validator (DF-012).
 *
 * Validates candidate planner output against the ExecutionPlan schema.
 * The planner returns ONLY validated plans: if the model output fails
 * validation, the planner retries once and then returns a PlanningError.
 * Malformed plans are never returned.
 *
 * Deterministic: errors are collected in a fixed order.
 */

import type { ExecutionPlan, PlanStep } from './types.js';
import { PLAN_COMPLEXITIES, PLAN_RISKS, PLAN_STEP_TYPES } from './types.js';

/** Result of validating a candidate plan. */
export interface PlanValidationResult {
  readonly valid: boolean;
  /** Deterministic, human-readable error messages. */
  readonly errors: readonly string[];
  /** The typed plan, present only when valid. */
  readonly plan?: ExecutionPlan;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** True when the dependency graph contains a cycle (Kahn's algorithm). */
function hasCycle(steps: readonly PlanStep[]): boolean {
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const step of steps) {
    indegree.set(step.id, 0);
    adjacency.set(step.id, []);
  }
  for (const step of steps) {
    for (const dep of step.dependsOn) {
      if (!indegree.has(dep)) {
        continue;
      }
      indegree.set(step.id, (indegree.get(step.id) ?? 0) + 1);
      adjacency.get(dep)?.push(step.id);
    }
  }

  const queue: string[] = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id)
    .sort();
  let visited = 0;

  while (queue.length > 0) {
    const id = queue.shift()!;
    visited++;
    for (const target of adjacency.get(id) ?? []) {
      const degree = (indegree.get(target) ?? 1) - 1;
      indegree.set(target, degree);
      if (degree === 0) {
        queue.push(target);
      }
    }
    queue.sort();
  }

  return visited !== steps.length;
}

/**
 * Validate a candidate plan produced by the planner/model.
 * Returns the typed plan when valid; otherwise a fixed list of errors.
 */
export function validatePlan(value: unknown): PlanValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { valid: false, errors: ['Plan must be an object.'] };
  }

  if (!isNonEmptyString(value.goal)) {
    errors.push('goal must be a non-empty string.');
  }

  if (!isNonEmptyString(value.summary)) {
    errors.push('summary must be a non-empty string.');
  }

  if (typeof value.complexity !== 'string' || !PLAN_COMPLEXITIES.includes(value.complexity as never)) {
    errors.push(`complexity must be one of: ${PLAN_COMPLEXITIES.join(', ')}.`);
  }

  if (typeof value.risk !== 'string' || !PLAN_RISKS.includes(value.risk as never)) {
    errors.push(`risk must be one of: ${PLAN_RISKS.join(', ')}.`);
  }

  if (typeof value.requiresConfirmation !== 'boolean') {
    errors.push('requiresConfirmation must be a boolean.');
  }

  // ── Steps ──
  if (!Array.isArray(value.steps) || value.steps.length === 0) {
    errors.push('steps must be a non-empty array.');
  } else {
    const seenIds = new Set<string>();
    value.steps.forEach((step, index) => {
      const label = `steps[${index}]`;
      if (!isRecord(step)) {
        errors.push(`${label} must be an object.`);
        return;
      }

      if (!isNonEmptyString(step.id)) {
        errors.push(`${label}.id must be a non-empty string.`);
      } else {
        if (seenIds.has(step.id)) {
          errors.push(`${label}.id "${step.id}" is duplicated.`);
        }
        seenIds.add(step.id);
      }

      if (!isNonEmptyString(step.title)) {
        errors.push(`${label}.title must be a non-empty string.`);
      }

      if (typeof step.description !== 'string') {
        errors.push(`${label}.description must be a string.`);
      }

      if (typeof step.type !== 'string' || !PLAN_STEP_TYPES.includes(step.type as never)) {
        errors.push(`${label}.type must be one of: ${PLAN_STEP_TYPES.join(', ')}.`);
      }

      if (!Array.isArray(step.dependsOn) || !isStringArray(step.dependsOn)) {
        errors.push(`${label}.dependsOn must be an array of strings.`);
      }

      if (typeof step.estimatedCost !== 'number' || !Number.isFinite(step.estimatedCost) || step.estimatedCost < 0) {
        errors.push(`${label}.estimatedCost must be a finite non-negative number.`);
      }

      if (typeof step.requiresConfirmation !== 'boolean') {
        errors.push(`${label}.requiresConfirmation must be a boolean.`);
      }
    });

    // ── Dependency references + cycles (only when steps are well-formed) ──
    if (errors.length === 0) {
      const steps = value.steps as PlanStep[];
      for (const step of steps) {
        for (const dep of step.dependsOn) {
          if (!seenIds.has(dep)) {
            errors.push(`step "${step.id}" depends on unknown step "${dep}".`);
          }
        }
      }
      if (errors.length === 0 && hasCycle(steps)) {
        errors.push('steps contain a dependency cycle.');
      }
    }
  }

  if (!isStringArray(value.assumptions)) {
    errors.push('assumptions must be an array of strings.');
  }

  if (!isStringArray(value.expectedOutputs)) {
    errors.push('expectedOutputs must be an array of strings.');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors, plan: value as unknown as ExecutionPlan };
}
