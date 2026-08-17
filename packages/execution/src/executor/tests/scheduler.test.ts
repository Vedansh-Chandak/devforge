import { describe, it, expect } from 'vitest';
import { ExecutorSchedulingError } from '../errors.js';
import { buildSchedule, isTopologicalOrder } from '../scheduler.js';
import { makePlan, makeStep } from './helpers.js';

describe('buildSchedule', () => {
  it('sorts independent steps by id for determinism', () => {
    const plan = makePlan([makeStep('b'), makeStep('a'), makeStep('c')]);
    const schedule = buildSchedule(plan);
    expect(schedule.order).toEqual(['a', 'b', 'c']);
  });

  it('orders steps after their dependencies', () => {
    const plan = makePlan([
      makeStep('deploy', { dependsOn: ['build'] }),
      makeStep('build', { dependsOn: ['lint'] }),
      makeStep('lint'),
    ]);
    const schedule = buildSchedule(plan);
    const position = new Map(schedule.order.map((id, i) => [id, i]));
    expect(position.get('lint')!).toBeLessThan(position.get('build')!);
    expect(position.get('build')!).toBeLessThan(position.get('deploy')!);
  });

  it('produces the same order on repeated calls', () => {
    const plan = makePlan([
      makeStep('e', { dependsOn: ['a', 'b'] }),
      makeStep('a'),
      makeStep('d', { dependsOn: ['c'] }),
      makeStep('b'),
      makeStep('c', { dependsOn: ['a'] }),
    ]);
    expect(buildSchedule(plan).order).toEqual(buildSchedule(plan).order);
  });

  it('returns every step id exactly once', () => {
    const plan = makePlan([
      makeStep('a'),
      makeStep('b', { dependsOn: ['a'] }),
      makeStep('c', { dependsOn: ['b'] }),
    ]);
    const schedule = buildSchedule(plan);
    expect([...schedule.order].sort()).toEqual(['a', 'b', 'c']);
    expect(schedule.count).toBe(3);
  });

  it('exposes a step lookup map', () => {
    const plan = makePlan([makeStep('x'), makeStep('y', { dependsOn: ['x'] })]);
    const schedule = buildSchedule(plan);
    expect(schedule.steps.get('y')?.title).toBe('Step y');
    expect(schedule.steps.size).toBe(2);
  });

  it('rejects a plan with no steps', () => {
    expect(() => buildSchedule(makePlan([]))).toThrowError(
      expect.objectContaining({ code: 'EMPTY_PLAN' }),
    );
  });

  it('rejects duplicate step ids', () => {
    const plan = makePlan([makeStep('a'), makeStep('a')]);
    try {
      buildSchedule(plan);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ExecutorSchedulingError);
      expect(error).toMatchObject({ code: 'DUPLICATE_STEP_ID', stepId: 'a' });
    }
  });

  it('rejects a dependency on an unknown step', () => {
    const plan = makePlan([makeStep('a', { dependsOn: ['ghost'] })]);
    expect(() => buildSchedule(plan)).toThrowError(
      expect.objectContaining({ code: 'MISSING_DEPENDENCY' }),
    );
  });

  it('rejects a direct dependency cycle', () => {
    const plan = makePlan([
      makeStep('a', { dependsOn: ['b'] }),
      makeStep('b', { dependsOn: ['a'] }),
    ]);
    expect(() => buildSchedule(plan)).toThrowError(
      expect.objectContaining({ code: 'DEPENDENCY_CYCLE' }),
    );
  });

  it('rejects a longer dependency cycle', () => {
    const plan = makePlan([
      makeStep('a', { dependsOn: ['b'] }),
      makeStep('b', { dependsOn: ['c'] }),
      makeStep('c', { dependsOn: ['a'] }),
    ]);
    try {
      buildSchedule(plan);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ExecutorSchedulingError);
      expect(error).toMatchObject({ code: 'DEPENDENCY_CYCLE' });
    }
  });

  it('rejects a self-dependency', () => {
    const plan = makePlan([makeStep('a', { dependsOn: ['a'] })]);
    expect(() => buildSchedule(plan)).toThrowError(
      expect.objectContaining({ code: 'DEPENDENCY_CYCLE' }),
    );
  });

  it('reports the cyclic steps in the message', () => {
    const plan = makePlan([
      makeStep('a', { dependsOn: ['b'] }),
      makeStep('b', { dependsOn: ['a'] }),
    ]);
    expect(() => buildSchedule(plan)).toThrowError(/a, b/);
  });
});

describe('buildSchedule levels', () => {
  it('places dependency-free steps in the first batch', () => {
    const plan = makePlan([makeStep('a'), makeStep('b', { dependsOn: ['a'] })]);
    const schedule = buildSchedule(plan);
    expect(schedule.levels[0]).toEqual(['a']);
    expect(schedule.levels[1]).toEqual(['b']);
  });

  it('keeps sibling dependencies in the same batch', () => {
    const plan = makePlan([
      makeStep('c', { dependsOn: ['a', 'b'] }),
      makeStep('a'),
      makeStep('b'),
    ]);
    const schedule = buildSchedule(plan);
    expect(schedule.levels[0]).toEqual(['a', 'b']);
    expect(schedule.levels[1]).toEqual(['c']);
  });

  it('is deterministic across calls', () => {
    const plan = makePlan([
      makeStep('x', { dependsOn: ['root'] }),
      makeStep('root'),
      makeStep('y', { dependsOn: ['root'] }),
    ]);
    const first = buildSchedule(plan).levels;
    const second = buildSchedule(plan).levels;
    expect(first).toEqual(second);
  });
});

describe('isTopologicalOrder', () => {
  it('accepts a correct topological order', () => {
    const plan = makePlan([makeStep('a'), makeStep('b', { dependsOn: ['a'] })]);
    expect(isTopologicalOrder(plan, ['a', 'b'])).toBe(true);
  });

  it('rejects a reversed order', () => {
    const plan = makePlan([makeStep('a'), makeStep('b', { dependsOn: ['a'] })]);
    expect(isTopologicalOrder(plan, ['b', 'a'])).toBe(false);
  });

  it('rejects an order with extra ids', () => {
    const plan = makePlan([makeStep('a')]);
    expect(isTopologicalOrder(plan, ['a', 'ghost'])).toBe(false);
  });

  it('rejects an order missing ids', () => {
    const plan = makePlan([makeStep('a'), makeStep('b')]);
    expect(isTopologicalOrder(plan, ['a'])).toBe(false);
  });
});

describe('buildSchedule advanced graphs', () => {
  it('resolves a diamond dependency', () => {
    const plan = makePlan([
      makeStep('d', { dependsOn: ['b', 'c'] }),
      makeStep('a'),
      makeStep('b', { dependsOn: ['a'] }),
      makeStep('c', { dependsOn: ['a'] }),
    ]);
    const schedule = buildSchedule(plan);
    const position = new Map(schedule.order.map((id, i) => [id, i]));
    expect(position.get('a')!).toBeLessThan(position.get('b')!);
    expect(position.get('a')!).toBeLessThan(position.get('c')!);
    expect(position.get('b')!).toBeLessThan(position.get('d')!);
    expect(position.get('c')!).toBeLessThan(position.get('d')!);
    expect(isTopologicalOrder(plan, schedule.order)).toBe(true);
  });

  it('assigns a distinct level per depth in a chain', () => {
    const plan = makePlan([
      makeStep('a'),
      makeStep('b', { dependsOn: ['a'] }),
      makeStep('c', { dependsOn: ['b'] }),
      makeStep('d', { dependsOn: ['c'] }),
    ]);
    const schedule = buildSchedule(plan);
    expect(schedule.levels.map((level) => [...level])).toEqual([
      ['a'],
      ['b'],
      ['c'],
      ['d'],
    ]);
  });

  it('produces a deterministic diamond order across calls', () => {
    const plan = makePlan([
      makeStep('d', { dependsOn: ['b', 'c'] }),
      makeStep('a'),
      makeStep('b', { dependsOn: ['a'] }),
      makeStep('c', { dependsOn: ['a'] }),
    ]);
    expect(buildSchedule(plan).order).toEqual(buildSchedule(plan).order);
  });
});
