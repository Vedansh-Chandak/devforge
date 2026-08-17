/**
 * @devforge/multi-agent — Task router (DF-022).
 *
 * Deterministically assigns a role agent to each task kind. Routing is a
 * pure mapping: PLAN → PLANNER, IMPLEMENT → CODER, TEST → TESTER, REVIEW →
 * REVIEWER, REPAIR → REPAIR, DOCUMENT → DOCUMENTATION.
 */

import type { AgentRole, Task, TaskKind } from '../types.js';

/** Map a task kind to the role responsible for it. */
export function roleForKind(kind: TaskKind): AgentRole {
  switch (kind) {
    case 'PLAN':
      return 'PLANNER';
    case 'IMPLEMENT':
      return 'CODER';
    case 'TEST':
      return 'TESTER';
    case 'REVIEW':
      return 'REVIEWER';
    case 'REPAIR':
      return 'REPAIR';
    case 'DOCUMENT':
      return 'DOCUMENTATION';
  }
}

/** Inverse map: the kinds a role handles. */
export function kindForRole(role: AgentRole): TaskKind {
  switch (role) {
    case 'PLANNER':
      return 'PLAN';
    case 'CODER':
      return 'IMPLEMENT';
    case 'TESTER':
      return 'TEST';
    case 'REVIEWER':
      return 'REVIEW';
    case 'REPAIR':
      return 'REPAIR';
    case 'DOCUMENTATION':
      return 'DOCUMENT';
  }
}

/** The other roles that observe output of a given role (reviewer sees all). */
export function dependentRoles(role: AgentRole): readonly AgentRole[] {
  switch (role) {
    case 'PLANNER':
      return ['CODER'];
    case 'CODER':
      return ['TESTER', 'REVIEWER'];
    case 'TESTER':
      return ['REVIEWER'];
    case 'REVIEWER':
      return ['REPAIR'];
    case 'REPAIR':
      return ['TESTER', 'REVIEWER'];
    case 'DOCUMENTATION':
      return [];
  }
}

/** Assign a role to a task in place of its kind. */
export function routeTask(task: Task): Task {
  return { ...task, role: roleForKind(task.kind) };
}

/** Route a batch of tasks, preserving order. */
export function routeTasks(tasks: readonly Task[]): readonly Task[] {
  return tasks.map(routeTask);
}
