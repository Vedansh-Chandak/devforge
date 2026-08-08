import { symbolIdToKey } from "@devforge/symbol-graph";
import type {
  SymbolNode,
  SymbolGraph,
  SymbolId,
} from "@devforge/symbol-graph";
import type { RepositoryIndex, SymbolInfo, ResolvedRelation } from "./types.js";

/** Kinds the linker synthesizes as per-file namespace wrappers. */
const FILE_NAMESPACE_KIND = "namespace";

function isFileNamespace(node: Pick<SymbolNode, "kind" | "name">): boolean {
  return node.kind === FILE_NAMESPACE_KIND && node.name.includes("/");
}

function collectEdgeTargets(graph: SymbolGraph): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    const byKind = map.get(edge.kind) ?? new Set<string>();
    byKind.add(symbolIdToKey(edge.to));
    map.set(edge.kind, byKind);
  }
  return map;
}

function nodeToInfo(node: SymbolNode, exported: boolean): SymbolInfo {
  return {
    name: node.name,
    kind: node.kind,
    filePath: node.filePath,
    qualifiedName: node.name,
    declarationLocation: node.declarationLocation,
    exported,
  };
}

/**
 * Resolves symbols out of an indexed {@link SymbolGraph}. Pure repository
 * intelligence: resolves classes, interfaces, enums, types, functions, methods,
 * variables, namespaces, and default/named exports via the graph's edges.
 */
export class SymbolResolver {
  private readonly graph: SymbolGraph;
  private readonly edgeTargets: Map<string, Set<string>>;

  constructor(private readonly index: RepositoryIndex) {
    this.graph = index.symbolGraph;
    this.edgeTargets = collectEdgeTargets(this.graph);
  }

  private isExported(node: SymbolNode): boolean {
    if (isFileNamespace(node)) return false;
    return this.edgeTargets.get("exports")?.has(symbolIdToKey(node.id)) ?? false;
  }

  private nodeToSymbol(node: SymbolNode): SymbolInfo {
    return nodeToInfo(node, this.isExported(node));
  }

  private nodeToInfo(node: SymbolNode): SymbolInfo {
    return this.nodeToSymbol(node);
  }

  /** All definition symbols, excluding synthetic file-namespace wrappers. */
  allSymbols(): SymbolInfo[] {
    const nodes = Array.from(this.graph.nodes.values())
      .filter((n) => !isFileNamespace(n))
      .sort((a, b) => symbolIdToKey(a.id).localeCompare(symbolIdToKey(b.id)));
    return nodes.map((n) => this.nodeToInfo(n));
  }

  /** The file-namespace (module) symbols, one per parsed file. */
  moduleSymbols(): SymbolInfo[] {
    const nodes = Array.from(this.graph.nodes.values())
      .filter((n) => isFileNamespace(n))
      .sort((a, b) => a.name.localeCompare(b.name));
    return nodes.map((n) => this.nodeToInfo(n));
  }

  /** Exact name lookup across all definition symbols. */
  findSymbol(name: string): SymbolInfo[] {
    return this.allSymbols().filter(
      (s) => s.name === name || s.qualifiedName === name
    );
  }

  /** Case-insensitive substring search by name. */
  searchSymbols(name: string): SymbolInfo[] {
    const needle = name.toLowerCase();
    return this.allSymbols().filter(
      (s) =>
        s.name.toLowerCase().includes(needle) ||
        s.qualifiedName.toLowerCase().includes(needle)
    );
  }

  /**
   * The definition(s) of a symbol. Exact name match, preferring an exact kind
   * when a version string like `Class.method` or `File#Symbol` is supplied.
   */
  findDefinition(name: string): SymbolInfo[] {
    const all = this.allSymbols();
    const exact = all.filter((s) => s.name === name);
    if (exact.length > 0) return exact;
    return all.filter((s) => s.qualifiedName === name || s.name.endsWith(`.${name}`));
  }

  /** Symbols that hold an edge into `definition` (imports, exports, extends...). */
  referencesTo(definition: SymbolInfo): ResolvedRelation[] {
    const node = this.nodeById(definition);
    if (!node) return [];
    return this.relationsFor(node.id, "incoming");
  }

  /** Files + symbols that reference the given symbol. */
  findReferences(name: string): ResolvedRelation[] {
    const defs = this.findDefinition(name);
    const references: ResolvedRelation[] = [];
    for (const def of defs) {
      references.push(...this.referencesTo(def));
    }
    return dedupeRelations(references, sortReferences);
  }

  /**
   * Callers of a function/method: incoming "calls", "references" and "imports"
   * edges from another file. File-namespace sources are collapsed to the file.
   */
  findCallers(name: string): ResolvedRelation[] {
    const defs = this.findDefinition(name);
    if (defs.length === 0) return [];
    const relations: ResolvedRelation[] = [];
    for (const def of defs) {
      relations.push(...this.referencesTo(def));
    }
    return dedupeRelations(relations, sortReferences);
  }

  /**
   * Implementations of an interface/abstract base: incoming "implements" and
   * "extends" edges whose source is a concrete class or interface.
   */
  findImplementations(name: string): ResolvedRelation[] {
    const defs = this.findDefinition(name);
    const implementations: ResolvedRelation[] = [];
    for (const def of defs) {
      const node = this.nodeById(def);
      if (!node) continue;
      for (const edge of this.graph.incoming.get(symbolIdToKey(node.id)) ?? []) {
        if (edge.kind === "implements" || edge.kind === "extends") {
          const source = this.graph.nodes.get(symbolIdToKey(edge.from));
          if (!source || isFileNamespace(source)) continue;
          if (source.kind === "class" || source.kind === "interface") {
            implementations.push({
              source: this.nodeToInfo(source),
              target: def,
              kind: edge.kind,
            });
          }
        }
      }
    }
    return dedupeRelations(implementations, sortImplementation);
  }

  /** All symbols declared in the given file. */
  findSymbolsInFile(filePath: string): SymbolInfo[] {
    const nodes = Array.from(this.graph.nodes.values())
      .filter((n) => n.filePath === filePath && !isFileNamespace(n))
      .sort((a, b) => a.name.localeCompare(b.name));
    return nodes.map((n) => this.nodeToInfo(n));
  }

  /** The (re-)exported names of a file, whether declared there or re-exported. */
  findExports(filePath: string): SymbolInfo[] {
    const exported = new Set<string>();
    for (const edge of this.graph.edges) {
      if (edge.kind !== "exports") continue;
      const fromFile = edge.from.filePath;
      const toNode = this.graph.nodes.get(symbolIdToKey(edge.to));
      if (fromFile === filePath && toNode && !isFileNamespace(toNode)) {
        exported.add(symbolIdToKey(toNode.id));
      }
    }
    const infos: SymbolInfo[] = [];
    for (const key of exported) {
      const node = this.graph.nodes.get(key);
      if (node) infos.push(this.nodeToInfo(node));
    }
    return infos.sort((a, b) => a.name.localeCompare(b.name));
  }

  private nodeById(info: SymbolInfo): SymbolNode | undefined {
    return Array.from(this.graph.nodes.values()).find(
      (n) =>
        n.name === info.name &&
        n.filePath === info.filePath &&
        n.kind === info.kind
    );
  }

  private relationsFor(id: SymbolId, direction: "incoming" | "outgoing"): ResolvedRelation[] {
    const edges =
      direction === "incoming"
        ? this.graph.incoming.get(symbolIdToKey(id)) ?? []
        : this.graph.outgoing.get(symbolIdToKey(id)) ?? [];
    const reversed = direction === "incoming";
    const relations: ResolvedRelation[] = [];
    for (const edge of edges) {
      const source = this.graph.nodes.get(symbolIdToKey(edge.from));
      const target = this.graph.nodes.get(symbolIdToKey(edge.to));
      if (!source || !target) continue;
      if (isFileNamespace(source) || isFileNamespace(target)) continue;
      relations.push({
        source: this.nodeToInfo(source),
        target: this.nodeToInfo(target),
        kind: edge.kind,
      });
    }
    return relations;
  }
}

function dedupeRelations(
  relations: ResolvedRelation[],
  sort: (a: ResolvedRelation, b: ResolvedRelation) => number
): ResolvedRelation[] {
  const seen = new Set<string>();
  const unique: ResolvedRelation[] = [];
  for (const rel of relations) {
    const key = `${rel.kind}:${rel.source.filePath}:${rel.source.name}:${rel.target.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(rel);
    }
  }
  return unique.sort(sort);
}

const sortReferences = (a: ResolvedRelation, b: ResolvedRelation): number => {
  const byKind = a.kind.localeCompare(b.kind);
  if (byKind !== 0) return byKind;
  return `${a.source.filePath}:${a.source.name}`.localeCompare(`${b.source.filePath}:${b.source.name}`);
};

const sortImplementation = (a: ResolvedRelation, b: ResolvedRelation): number =>
  `${a.source.filePath}:${a.source.name}`.localeCompare(`${b.source.filePath}:${b.source.name}`);