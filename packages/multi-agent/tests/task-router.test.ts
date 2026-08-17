import { describe, expect, it } from 'vitest';
import { roleForKind, kindForRole, dependentRoles, routeTask, routeTasks } from '../src/selection/task-router.js';
import { makeTask } from './helpers/mock.js';
import type { Task } from '../src/types.js';

describe('roleForKind', () => {
  it('maps every kind to its canonical role', () => {
    expect(roleForKind('PLAN')).toBe('PLANNER');
    expect(roleForKind('IMPLEMENT')).toBe('CODER');
    expect(roleForKind('TEST')).toBe('TESTER');
    expect(roleForKind('REVIEW')).toBe('REVIEWER');
    expect(roleForKind('REPAIR')).toBe('REPAIR');
    expect(roleForKind('DOCUMENT')).toBe('DOCUMENTATION');
  });
});

describe('kindForRole', () => {
  it('round-trips through roleForKind', () => {
    const kinds = ['PLAN', 'IMPLEMENT', 'TEST', 'REVIEW', 'REPAIR', 'DOCUMENT'] as const;
    for (const kind of kinds) {
      expect(kindForRole(roleForKind(kind))).toBe(kind);
    }
  });

  it('maps every role to its canonical kind', () => {
    expect(kindForRole('PLANNER')).toBe('PLAN');
    expect(kindForRole('CODER')).toBe('IMPLEMENT');
    expect(kindForRole('TESTER')).toBe('TEST');
    expect(kindForRole('REVIEWER')).toBe('REVIEW');
    expect(kindForRole('REPAIR')).toBe('REPAIR');
    expect(kindForRole('DOCUMENTATION')).toBe('DOCUMENT');
  });
});

describe('dependentRoles', () => {
  it('says reviewers observe coder and tester output', () => {
    expect(dependentRoles('CODER')).toEqual(['TESTER', 'REVIEWER']);
    expect(dependentRoles('TESTER')).toEqual(['REVIEWER']);
  });

  it('says coders follow planners', () => {
    expect(dependentRoles('PLANNER')).toEqual(['CODER']);
  });

  it('says repairs feed testers and reviewers', () => {
    expect(dependentRoles('REPAIR')).toEqual(['TESTER', 'REVIEWER']);
  });

  it('says documentation depends on nothing further', () => {
    expect(dependentRoles('DOCUMENTATION')).toEqual([]);
  });

  it('says reviewers feed repairs', () => {
    expect(dependentRoles('REVIEWER')).toEqual(['REPAIR']);
  });

  it('is deterministic across evaluation', () => {
    expect(dependentRoles('CODER')).toEqual(dependentRoles('CODER'));
  });
});

describe('routeTask', () => {
  it('assigns the role matching the kind', () => {
    const task = routeTask(makeTask({ id: 'a', kind: 'TEST' }));
    expect(task.role).toBe('TESTER');
  });

  it('preserves all other fields', () => {
    const source = makeTask({ id: 'a', kind: 'IMPLEMENT', target: 'src/x.ts', maxRetries: 5 });
    const routed = routeTask(source);
    expect(routed.id).toBe(source.id);
    expect(routed.target).toBe('src/x.ts');
    expect(routed.maxRetries).toBe(5);
    expect(routed.dependsOn).toEqual([]);
  });
});

describe('routeTasks', () => {
  it('routes a batch preserving order', () => {
    const tasks: readonly Task[] = [
      makeTask({ id: 't1', kind: 'PLAN' }),
      makeTask({ id: 't2', kind: 'IMPLEMENT' }),
      makeTask({ id: 't3', kind: 'REVIEW' }),
    ];
    const routed = routeTasks(tasks);
    expect(routed.map((t) => t.role)).toEqual(['PLANNER', 'CODER', 'REVIEWER']);
    expect(routed.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  });

  it('is deterministic across calls', () => {
    const a = routeTasks([makeTask({ id: 'x', kind: 'IMPLEMENT' })]);
    const b = routeTasks([makeTask({ id: 'x', kind: 'IMPLEMENT' })]);
    expect(a).toEqual(b);
  });

  it('does not mutate the input tasks', () => {
    const source = makeTask({ id: 'x', kind: 'PLAN' });
    const originalRole = source.role;
    const routed = routeTasks([source]);
    expect(source.role).toBe(originalRole);
    expect(routed[0].role).toBe('PLANNER');
    expect(routed[0]).not.toBe(source);
  });

  it('handles an empty input', () => {
    expect(routeTasks([])).toEqual([]);
  });
});