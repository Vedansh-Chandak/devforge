import type { ParsedFile } from "@devforge/symbol-graph";
import type { DependencyEdge, DependencyGraphView, Cycle } from "./types.js";

function extensionOf(path: string): string {
  const idx = path.lastIndexOf(".");
  if (idx < 0 || idx === path.length - 1) return "";
  return path.slice(idx + 1).toLowerCase();
}

/**
 * Resolve a relative module specifier to a known file path. Non-relative
 * (package) specifiers and unresolvable relative specifiers return null.
 */
export function resolveModuleSpecifier(
  specifier: string,
  fromFilePath: string,
  knownPaths: ReadonlySet<string>
): string | null {
  if (!specifier.startsWith(".")) return null;

  const dir = fromFilePath.includes("/")
    ? fromFilePath.slice(0, fromFilePath.lastIndexOf("/") + 1)
    : "";

  let combined = dir + specifier;
  const parts = combined.split("/");
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (normalized.length > 0) normalized.pop();
      else return null;
    } else {
      normalized.push(part);
    }
  }
  combined = normalized.join("/");

  const ext = extensionOf(combined);
  const candidates: string[] = [];
  if (ext === "js" || ext === "ts" || ext === "tsx") {
    candidates.push(combined);
  } else {
    candidates.push(
      `${combined}.ts`,
      `${combined}.tsx`,
      `${combined}/index.ts`,
      `${combined}/index.tsx`
    );
  }
  for (const candidate of candidates) {
    if (knownPaths.has(candidate)) return candidate;
  }
  return null;
}

function dependenciesOf(
  parsed: ParsedFile,
  knownPaths: ReadonlySet<string>
): Array<string> {
  const deps: string[] = [];
  for (const imp of parsed.imports) {
    const resolved = resolveModuleSpecifier(imp.moduleSpecifier, parsed.filePath, knownPaths);
    if (resolved && !deps.includes(resolved)) deps.push(resolved);
  }
  return deps.sort();
}

function reexportsOf(
  parsed: ParsedFile,
  knownPaths: ReadonlySet<string>
): Array<string> {
  const reexports: string[] = [];
  for (const exp of parsed.exports) {
    if (!exp.moduleSpecifier) continue;
    const resolved = resolveModuleSpecifier(exp.moduleSpecifier, parsed.filePath, knownPaths);
    if (resolved && !reexports.includes(resolved)) reexports.push(resolved);
  }
  return reexports.sort();
}

function buildImportGraph(
  parsedFiles: ReadonlyArray<ParsedFile>,
  knownPaths: ReadonlySet<string>
): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const parsed of parsedFiles) {
    graph.set(parsed.filePath, dependenciesOf(parsed, knownPaths));
  }
  return graph;
}

function buildExportGraph(
  parsedFiles: ReadonlyArray<ParsedFile>,
  knownPaths: ReadonlySet<string>
): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const file of parsedFiles) {
    const reexports = reexportsOf(file, knownPaths);
    if (reexports.length > 0) graph.set(file.filePath, reexports);
  }
  return graph;
}

function reverseAdjacency(
  importGraph: ReadonlyMap<string, ReadonlyArray<string>>
): Map<string, string[]> {
  const reverse = new Map<string, string[]>();
  for (const from of importGraph.keys()) {
    if (!reverse.has(from)) reverse.set(from, []);
  }
  for (const [from, tos] of importGraph) {
    for (const to of tos) {
      const current = new Set(reverse.get(to) ?? []);
      current.add(from);
      reverse.set(to, Array.from(current).sort());
    }
  }
  return reverse;
}

/**
 * Detect cycles deterministically using Tarjan's SCC algorithm. A cycle is any
 * strongly connected component of size > 1, or a node importing itself.
 */
export function detectCircular(
  importGraph: ReadonlyMap<string, ReadonlyArray<string>>
): ReadonlyArray<Cycle> {
  let counter = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: Cycle[] = [];

  const strongconnect = (v: string): void => {
    indices.set(v, counter);
    lowlink.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);

    const neighbors = (importGraph.get(v) ?? []).slice().sort();
    for (const w of neighbors) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v) ?? 0, lowlink.get(w) ?? 0));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v) ?? 0, indices.get(w) ?? 0));
      }
    }

    if ((lowlink.get(v) ?? 0) === (indices.get(v) ?? 0)) {
      const component: string[] = [];
      let w: string | undefined;
      do {
        w = stack.pop();
        if (w !== undefined) {
          onStack.delete(w);
          component.push(w);
        }
      } while (w !== v);
      const isSelfLoop =
        component.length === 1 && neighbors.some((n) => n === component[0]);
      if (component.length > 1 || isSelfLoop) {
        cycles.push({ path: component.sort() });
      }
    }
  };

  const nodes = Array.from(importGraph.keys()).sort();
  for (const node of nodes) {
    if (!indices.has(node)) strongconnect(node);
  }

  cycles.sort((a, b) => (a.path.join("/") < b.path.join("/") ? -1 : 1));
  return cycles;
}

/**
 * Build the full dependency view: import graph, export graph, and detected
 * circular dependencies.
 */
export function buildDependencyView(
  parsedFiles: ReadonlyArray<ParsedFile>,
  knownPaths: ReadonlySet<string>
): DependencyGraphView {
  const importGraph = buildImportGraph(parsedFiles, knownPaths);
  const exportGraph = buildExportGraph(parsedFiles, knownPaths);
  return {
    importGraph,
    exportGraph,
    circular: detectCircular(importGraph).map((cycle) => cycle.path),
  };
}

/**
 * Collect a file's imports up to `maxDepth` (zero = direct only). The returned
 * edges are depth-ordered and deduplicated by (from, to) pair.
 */
export function findDependencies(
  importGraph: ReadonlyMap<string, ReadonlyArray<string>>,
  filePath: string,
  maxDepth = Infinity
): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  const seen = new Set<string>();
  const queue: Array<{ node: string; depth: number }> = [{ node: filePath, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    if (current.depth >= maxDepth) continue;
    for (const neighbor of importGraph.get(current.node) ?? []) {
      const key = `${current.node}->${neighbor}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({ from: current.node, to: neighbor, depth: current.depth + 1 });
        queue.push({ node: neighbor, depth: current.depth + 1 });
      }
    }
  }
  return edges;
}

/** Collect a file's transitive dependents (files that import it, recursively). */
export function findDependents(
  importGraph: ReadonlyMap<string, ReadonlyArray<string>>,
  filePath: string,
  maxDepth = Infinity
): DependencyEdge[] {
  const reverse = reverseAdjacency(importGraph);
  const edges: DependencyEdge[] = [];
  const seen = new Set<string>();
  const queue: Array<{ node: string; depth: number }> = [{ node: filePath, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    if (current.depth >= maxDepth) continue;
    for (const neighbor of reverse.get(current.node) ?? []) {
      const key = `${current.node}->${neighbor}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({ from: neighbor, to: current.node, depth: current.depth + 1 });
        queue.push({ node: neighbor, depth: current.depth + 1 });
      }
    }
  }
  return edges;
}

/** Shortest import-graph distance from `start` to `target`, or null. */
export function importDistance(
  importGraph: ReadonlyMap<string, ReadonlyArray<string>>,
  start: string,
  target: string
): number | null {
  if (start === target) return 0;
  const visited = new Set<string>([start]);
  const queue: Array<{ node: string; depth: number }> = [{ node: start, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const neighbor of importGraph.get(current.node) ?? []) {
      if (neighbor === target) return current.depth + 1;
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push({ node: neighbor, depth: current.depth + 1 });
      }
    }
  }
  return null;
}