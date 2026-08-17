/**
 * @devforge/multi-agent — Task dependency graph (DF-022).
 *
 * Represents step dependencies, agent dependencies and execution ordering as
 * a directed acyclic graph over tasks. Provides deterministic cycle,
 * duplicate-id and missing-dependency detection, plus a topological order.
 */

import type { Task } from '../types.js';
import {
  MultiAgentCycleError,
  MultiAgentDuplicateError,
  MultiAgentMissingDependencyError,
  MultiAgentValidationError,
} from '../errors.js';

/** Result of graph validation. */
export interface GraphValidation {
  readonly ok: boolean;
  readonly cycles: readonly string[][];
  readonly duplicates: readonly string[];
  readonly missingDependencies: readonly string[];
  /** Deterministic topological order of task ids (cycle-free). */
  readonly order: readonly string[];
}

/** List all dependsOn edges for the given tasks. */
export function edges(tasks: readonly Task[]): ReadonlyArray<readonly [string, string]> {
  const edgeList: Array<readonly [string, string]> = [];
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      edgeList.push([dep, task.id]);
    }
  }
  return edgeList;
}

/** Detect task ids that appear more than once. */
export function detectDuplicates(tasks: readonly Task[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id)) {
      duplicates.add(task.id);
    }
    seen.add(task.id);
  }
  return [...duplicates].sort();
}

/** Detect ids referenced by dependsOn but missing from the task set. */
export function detectMissingDependencies(tasks: readonly Task[]): readonly string[] {
  const present = new Set(tasks.map((task) => task.id));
  const missing = new Set<string>();
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (!present.has(dep)) {
        missing.add(dep);
      }
    }
  }
  return [...missing].sort();
}

/**
 * Detect dependency cycles. Returns every cycle found as an ordered path of
 * task ids, scanned in deterministic order.
 */
export function detectCycles(tasks: readonly Task[]): readonly string[][] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const sortedIds = tasks.map((task) => task.id).sort();
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];
  const cycles: string[][] = [];

  for (const id of sortedIds) {
    void byId;
    if (color.get(id) === BLACK) continue;
    const localSeen = new Set<string>();
    const dfs = (node: string, path: string[], pathSet: Set<string>): boolean => {
      const c = color.get(node) ?? WHITE;
      if (c === GRAY) {
        const cut = path.indexOf(node);
        const cycle = [...path.slice(cut), node];
        cycles.push(cycle);
        return false;
      }
      if (c === BLACK) return true;
      color.set(node, GRAY);
      path.push(node);
      pathSet.add(node);
      const task = byId.get(node);
      if (task) {
        // Follow dependency edges in deterministic (sorted) order.
        const deps = [...task.dependsOn].sort();
        for (const dep of deps) {
          if (!byId.has(dep)) continue;
          const ok = dfs(dep, path, pathSet);
          if (!ok) return false;
        }
      }
      path.pop();
      pathSet.delete(node);
      color.set(node, BLACK);
      void localSeen;
      return true;
    };
    dfs(id, [], localSeen);
    void stack;
  }

  return cycles;
}

/**
 * Produce a deterministic topological order. Uses Kahn's algorithm with a
 * min-heap-style priority (task id ascending) for stable tie-breaking.
 * Returns ids; if a cycle exists the reachable cycle members are excluded.
 */
export function topologicalOrder(tasks: readonly Task[]): readonly string[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const task of tasks) {
    indegree.set(task.id, task.dependsOn.length);
    for (const dep of task.dependsOn) {
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep)!.push(task.id);
    }
  }
  const ready: string[] = tasks
    .filter((task) => (indegree.get(task.id) ?? 0) === 0)
    .map((task) => task.id)
    .sort();
  const order: string[] = [];
  const visited = new Set<string>();

  while (ready.length > 0) {
    ready.sort();
    const id = ready.shift()!;
    order.push(id);
    visited.add(id);
    const next = (dependents.get(id) ?? []).sort();
    for (const dep of next) {
      if (visited.has(dep)) continue;
      const current = (indegree.get(dep) ?? 0) - 1;
      indegree.set(dep, current);
      if (current === 0) {
        ready.push(dep);
      }
    }
  }
  void byId;
  return order;
}

/** Validate the graph, throwing typed errors on structural problems. */
export function validateGraph(tasks: readonly Task[]): GraphValidation {
  if (tasks.length === 0) {
    throw new MultiAgentValidationError('cannot validate an empty task set');
  }
  const duplicates = detectDuplicates(tasks);
  if (duplicates.length > 0) {
    throw new MultiAgentDuplicateError(`duplicate task ids: ${duplicates.join(', ')}`);
  }
  const missing = detectMissingDependencies(tasks);
  if (missing.length > 0) {
    throw new MultiAgentMissingDependencyError(
      `missing dependencies: ${missing.join(', ')}`,
    );
  }
  const cycles = detectCycles(tasks);
  if (cycles.length > 0) {
    throw new MultiAgentCycleError(
      `dependency cycles detected: ${cycles.map((c) => c.join(' -> ')).join('; ')}`,
    );
  }
  return {
    ok: true,
    cycles: [],
    duplicates: [],
    missingDependencies: [],
    order: topologicalOrder(tasks),
  };
}
