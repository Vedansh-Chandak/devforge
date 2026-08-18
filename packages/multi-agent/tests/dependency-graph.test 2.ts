import { describe, expect, it } from 'vitest';
import {
  edges,
  detectCycles,
  detectDuplicates,
  detectMissingDependencies,
  topologicalOrder,
  validateGraph,
} from '../src/selection/dependency-graph.js';
import { makeTask } from './helpers/mock.js';
import {
  MultiAgentCycleError,
  MultiAgentDuplicateError,
  MultiAgentMissingDependencyError,
  MultiAgentValidationError,
} from '../src/errors.js';

describe('edges', () => {
  it('lists dependency edges in task order', () => {
    const tasks = [
      makeTask({ id: 'a', dependsOn: [] }),
      makeTask({ id: 'b', dependsOn: ['a'] }),
      makeTask({ id: 'c', dependsOn: ['a', 'b'] }),
    ];
    expect(edges(tasks)).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
    ]);
  });
});

describe('detectDuplicates', () => {
  it('reports duplicate ids', () => {
    const tasks = [
      makeTask({ id: 'a' }),
      makeTask({ id: 'a' }),
      makeTask({ id: 'b' }),
    ];
    expect(detectDuplicates(tasks)).toEqual(['a']);
  });

  it('returns empty for unique ids', () => {
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' })];
    expect(detectDuplicates(tasks)).toEqual([]);
  });

  it('sorts the duplicate list', () => {
    const tasks = [
      makeTask({ id: 'b' }),
      makeTask({ id: 'a' }),
      makeTask({ id: 'b' }),
    ];
    expect(detectDuplicates(tasks)).toEqual(['b']);
  });
});

describe('detectMissingDependencies', () => {
  it('finds dependencies on nonexistent tasks', () => {
    const tasks = [
      makeTask({ id: 'a', dependsOn: ['ghost'] }),
      makeTask({ id: 'b', dependsOn: ['a', 'also-ghost'] }),
    ];
    expect(detectMissingDependencies(tasks)).toEqual(['also-ghost', 'ghost']);
  });

  it('returns empty when all dependencies exist', () => {
    const tasks = [
      makeTask({ id: 'a', dependsOn: [] }),
      makeTask({ id: 'b', dependsOn: ['a'] }),
    ];
    expect(detectMissingDependencies(tasks)).toEqual([]);
  });
});

describe('detectCycles', () => {
  it('detects a two-node cycle', () => {
    const tasks = [
      makeTask({ id: 'a', dependsOn: ['b'] }),
      makeTask({ id: 'b', dependsOn: ['a'] }),
    ];
    const cycles = detectCycles(tasks);
    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles[0]).toEqual(['a', 'b', 'a']);
  });

  it('detects a self-loop', () => {
    const tasks = [makeTask({ id: 'a', dependsOn: ['a'] })];
    const cycles = detectCycles(tasks);
    expect(cycles.length).toBe(1);
    expect(cycles[0]).toEqual(['a', 'a']);
  });

  it('detects a longer cycle', () => {
    const tasks = [
      makeTask({ id: 'a', dependsOn: ['c'] }),
      makeTask({ id: 'b', dependsOn: ['a'] }),
      makeTask({ id: 'c', dependsOn: ['b'] }),
    ];
    const cycles = detectCycles(tasks);
    expect(cycles.length).toBeGreaterThan(0);
  });

  it('returns empty for a DAG', () => {
    const tasks = [
      makeTask({ id: 'a', dependsOn: [] }),
      makeTask({ id: 'b', dependsOn: ['a'] }),
      makeTask({ id: 'c', dependsOn: ['a', 'b'] }),
    ];
    expect(detectCycles(tasks)).toEqual([]);
  });

  it('ignores missing dependencies while scanning', () => {
    const tasks = [
      makeTask({ id: 'a', dependsOn: ['x'] }),
      makeTask({ id: 'b', dependsOn: ['a'] }),
    ];
    expect(detectCycles(tasks)).toEqual([]);
  });

  it('is deterministic across calls', () => {
    const tasks = [
      makeTask({ id: 'b', dependsOn: ['a'] }),
      makeTask({ id: 'a', dependsOn: ['b'] }),
    ];
    expect(detectCycles(tasks)).toEqual(detectCycles(tasks));
  });
});

describe('topologicalOrder', () => {
  it('preserves dependency ordering', () => {
    const tasks = [
      makeTask({ id: 'c', dependsOn: ['a'] }),
      makeTask({ id: 'a', dependsOn: [] }),
      makeTask({ id: 'b', dependsOn: ['a'] }),
    ];
    const order = topologicalOrder(tasks);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
  });

  it('breaks ties by task id deterministically', () => {
    const tasks = [
      makeTask({ id: 'b', dependsOn: [] }),
      makeTask({ id: 'a', dependsOn: [] }),
      makeTask({ id: 'c', dependsOn: [] }),
    ];
    expect(topologicalOrder(tasks)).toEqual(['a', 'b', 'c']);
  });

  it('reproduces identical output across calls', () => {
    const tasks = [
      makeTask({ id: 'd', dependsOn: ['a'] }),
      makeTask({ id: 'b', dependsOn: [] }),
      makeTask({ id: 'a', dependsOn: [] }),
      makeTask({ id: 'c', dependsOn: ['b'] }),
    ];
    expect(topologicalOrder(tasks)).toEqual(topologicalOrder(tasks));
  });

  it('covers every task id', () => {
    const tasks = [
      makeTask({ id: 'x', dependsOn: ['y'] }),
      makeTask({ id: 'y', dependsOn: [] }),
      makeTask({ id: 'z', dependsOn: ['x'] }),
    ];
    const order = topologicalOrder(tasks);
    expect(order.sort()).toEqual(['x', 'y', 'z'].sort());
  });

  it('handles diamond dependencies', () => {
    const tasks = [
      makeTask({ id: 'top', dependsOn: [] }),
      makeTask({ id: 'left', dependsOn: ['top'] }),
      makeTask({ id: 'right', dependsOn: ['top'] }),
      makeTask({ id: 'bottom', dependsOn: ['left', 'right'] }),
    ];
    const order = topologicalOrder(tasks);
    expect(order.indexOf('top')).toBeLessThan(order.indexOf('left'));
    expect(order.indexOf('top')).toBeLessThan(order.indexOf('right'));
    expect(order.indexOf('left')).toBeLessThan(order.indexOf('bottom'));
    expect(order.indexOf('right')).toBeLessThan(order.indexOf('bottom'));
  });
});

describe('validateGraph', () => {
  it('accepts a valid DAG', () => {
    const tasks = [
      makeTask({ id: 'a', dependsOn: [] }),
      makeTask({ id: 'b', dependsOn: ['a'] }),
    ];
    const result = validateGraph(tasks);
    expect(result.ok).toBe(true);
    expect(result.cycles).toEqual([]);
    expect(result.order).toEqual(['a', 'b']);
  });

  it('throws MultiAgentCycleError on cycles', () => {
    const tasks = [
      makeTask({ id: 'a', dependsOn: ['b'] }),
      makeTask({ id: 'b', dependsOn: ['a'] }),
    ];
    expect(() => validateGraph(tasks)).toThrow(MultiAgentCycleError);
  });

  it('throws MultiAgentDuplicateError on duplicate ids', () => {
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'a' })];
    expect(() => validateGraph(tasks)).toThrow(MultiAgentDuplicateError);
  });

  it('throws MultiAgentMissingDependencyError on missing deps', () => {
    const tasks = [makeTask({ id: 'a', dependsOn: ['nope'] })];
    expect(() => validateGraph(tasks)).toThrow(MultiAgentMissingDependencyError);
  });

  it('throws MultiAgentValidationError on an empty set', () => {
    expect(() => validateGraph([])).toThrow(MultiAgentValidationError);
  });
});