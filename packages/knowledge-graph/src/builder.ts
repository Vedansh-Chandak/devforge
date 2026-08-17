import type { SymbolGraph, SymbolNode, SymbolId, ParsedFile, SymbolEdge, EdgeKind } from "@devforge/symbol-graph";
import type {
  KnowledgeGraph,
  KnowledgeNode,
  KnowledgeNodeId,
  KnowledgeEdge,
  KnowledgeEdgeKind,
  BuildKnowledgeGraphOptions,
} from "./types.js";
import { createKnowledgeGraph, addNode, addEdge, getNode as getGraphNode } from "./graph.js";
import { recognizeAll, type RecognizedNode } from "./recognizer.js";

function knowledgeNodeIdToString(id: KnowledgeNodeId): string {
  return `kg:${id.kind}:${id.name}`;
}

function buildNodesFromRecognized(
  recognized: RecognizedNode[]
): KnowledgeNode[] {
  return recognized.map((r) => ({
    id: { kind: r.kind, name: r.name },
    kind: r.kind,
    name: r.name,
    qualifiedName: r.name,
    sourceSymbols: r.sourceSymbols,
    sourceFiles: Array.from(new Set(r.sourceSymbols.map((s) => s.filePath))),
    properties: r.properties,
    confidence: 1.0,
    createdAt: new Date().toISOString(),
    version: 1,
  }));
}

function buildEdgesFromSymbolGraph(
  kg: KnowledgeGraph,
  symbolGraph: SymbolGraph,
  nodes: KnowledgeNode[]
): void {
  const nodeBySymbolId = new Map<string, KnowledgeNode>();

  for (const node of nodes) {
    for (const symId of node.sourceSymbols) {
      const key = `${symId.filePath}:${symId.kind}:${symId.name}:${symId.declarationLocation.start}:${symId.declarationLocation.end}`;
      nodeBySymbolId.set(key, node);
    }
  }

  for (const edge of symbolGraph.edges) {
    const fromKey = `${edge.from.filePath}:${edge.from.kind}:${edge.from.name}:${edge.from.declarationLocation.start}:${edge.from.declarationLocation.end}`;
    const toKey = `${edge.to.filePath}:${edge.to.kind}:${edge.to.name}:${edge.to.declarationLocation.start}:${edge.to.declarationLocation.end}`;

    const fromNode = nodeBySymbolId.get(fromKey);
    const toNode = nodeBySymbolId.get(toKey);

    if (!fromNode || !toNode) {
      continue;
    }

    const kgEdgeKind = mapSymbolEdgeToKnowledgeEdge(edge.kind);
    if (!kgEdgeKind) {
      continue;
    }

    const edgeId = `${knowledgeNodeIdToString(fromNode.id)}-${kgEdgeKind}-${knowledgeNodeIdToString(toNode.id)}`;

    if (!kg.edges.some((e) => e.id === edgeId)) {
      addEdge(kg, {
        id: edgeId,
        kind: kgEdgeKind,
        from: fromNode.id,
        to: toNode.id,
        properties: {
          sourceSymbol: edge.from,
          edgeKind: edge.kind,
          symbolEdgeKind: edge.kind,
        },
      });
    }
  }

  // Add contains edges: module -> service/api/repository in same module
  addModuleContainsEdges(kg, nodes);
}

function addModuleContainsEdges(kg: KnowledgeGraph, nodes: KnowledgeNode[]): void {
  const modules = nodes.filter((n) => n.id.kind === "module");
  const components = nodes.filter((n) => ["service", "api", "repository"].includes(n.id.kind));

  for (const module of modules) {
    for (const component of components) {
      // Check if component is in the module's directory tree
      if (isInModuleDirectory(module, component)) {
        const edgeId = `${knowledgeNodeIdToString(module.id)}-contains-${knowledgeNodeIdToString(component.id)}`;
        if (!kg.edges.some((e) => e.id === edgeId)) {
          addEdge(kg, {
            id: edgeId,
            kind: "contains",
            from: module.id,
            to: component.id,
            properties: {},
          });
        }
      }
    }
  }
}

function isInModuleDirectory(module: KnowledgeNode, component: KnowledgeNode): boolean {
  const moduleName = module.id.name;
  for (const file of component.sourceFiles) {
    // Check if file path contains /modules/{moduleName}/ or similar
    const patterns = [
      new RegExp(`/modules/${moduleName}/`),
      new RegExp(`/features/${moduleName}/`),
      new RegExp(`/packages/${moduleName}/`),
      new RegExp(`/libs/${moduleName}/`),
      new RegExp(`/domains/${moduleName}/`),
    ];
    if (patterns.some((p) => p.test(file))) {
      return true;
    }
  }
  return false;
}

function mapSymbolEdgeToKnowledgeEdge(kind: EdgeKind): KnowledgeEdgeKind | null {
  switch (kind) {
    case "imports":
      return "dependsOn";
    case "contains":
      return "contains";
    case "extends":
    case "implements":
      return "dependsOn";
    case "calls":
      return "dependsOn";
    case "references":
      return "dependsOn";
    default:
      return null;
  }
}

export function buildKnowledgeGraph(
  symbolGraph: SymbolGraph,
  parsedFiles: ParsedFile[],
  _options: BuildKnowledgeGraphOptions = {}
): KnowledgeGraph {
  const kg = createKnowledgeGraph();

  const allSymbols: SymbolNode[] = [];
  for (const node of symbolGraph.nodes.values()) {
    allSymbols.push(node);
  }

  const recognized = recognizeAll(allSymbols, parsedFiles);

  const nodes = buildNodesFromRecognized(recognized);

  for (const node of nodes) {
    addNode(kg, node);
  }

  buildEdgesFromSymbolGraph(kg, symbolGraph, nodes);

  return kg;
}

export function getKnowledgeNode(kg: KnowledgeGraph, id: KnowledgeNodeId): KnowledgeNode | undefined {
  return getGraphNode(kg, id);
}

export function getDependencies(kg: KnowledgeGraph, id: KnowledgeNodeId): KnowledgeEdge[] {
  const key = knowledgeNodeIdToString(id);
  return kg.outgoing.get(key) || [];
}

export function getDependents(kg: KnowledgeGraph, id: KnowledgeNodeId): KnowledgeEdge[] {
  const key = knowledgeNodeIdToString(id);
  return kg.incoming.get(key) || [];
}