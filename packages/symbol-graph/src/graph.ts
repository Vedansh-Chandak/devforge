import type { SymbolGraph, SymbolNode, SymbolEdge, SymbolId, EdgeKind } from "./types.js";

export function createSymbolGraph(): SymbolGraph {
  return {
    nodes: new Map(),
    edges: [],
    outgoing: new Map(),
    incoming: new Map(),
  };
}

export function addNode(graph: SymbolGraph, node: SymbolNode): void {
  const key = symbolIdToKey(node.id);
  graph.nodes.set(key, node);
  graph.outgoing.set(key, []);
  graph.incoming.set(key, []);
}

export function addEdge(graph: SymbolGraph, edge: SymbolEdge): void {
  const fromKey = symbolIdToKey(edge.from);
  const toKey = symbolIdToKey(edge.to);

  graph.edges.push(edge);

  const outgoing = graph.outgoing.get(fromKey);
  if (outgoing) {
    outgoing.push(edge);
  }

  const incoming = graph.incoming.get(toKey);
  if (incoming) {
    incoming.push(edge);
  }
}

export function getNode(graph: SymbolGraph, id: SymbolId): SymbolNode | undefined {
  const key = symbolIdToKey(id);
  return graph.nodes.get(key);
}

export function getOutgoingEdges(graph: SymbolGraph, id: SymbolId, kind?: EdgeKind): SymbolEdge[] {
  const key = symbolIdToKey(id);
  const edges = graph.outgoing.get(key) || [];
  if (kind) {
    return edges.filter((e) => e.kind === kind);
  }
  return edges;
}

export function getIncomingEdges(graph: SymbolGraph, id: SymbolId, kind?: EdgeKind): SymbolEdge[] {
  const key = symbolIdToKey(id);
  const edges = graph.incoming.get(key) || [];
  if (kind) {
    return edges.filter((e) => e.kind === kind);
  }
  return edges;
}

export function getAllNodes(graph: SymbolGraph): SymbolNode[] {
  return Array.from(graph.nodes.values());
}

export function getAllEdges(graph: SymbolGraph): SymbolEdge[] {
  return [...graph.edges];
}

export function getNodesByKind(graph: SymbolGraph, kind: SymbolNode["kind"]): SymbolNode[] {
  return getAllNodes(graph).filter((n) => n.kind === kind);
}

export function getNodesByFile(graph: SymbolGraph, filePath: string): SymbolNode[] {
  return getAllNodes(graph).filter((n) => n.filePath === filePath);
}

export function hasNode(graph: SymbolGraph, id: SymbolId): boolean {
  const key = symbolIdToKey(id);
  return graph.nodes.has(key);
}

export function hasEdge(graph: SymbolGraph, from: SymbolId, to: SymbolId): boolean {
  const fromKey = symbolIdToKey(from);
  const edges = graph.outgoing.get(fromKey) || [];
  const toKey = symbolIdToKey(to);
  return edges.some((e) => symbolIdToKey(e.to) === toKey);
}

export function symbolIdToKey(id: SymbolId): string {
  return `${id.filePath}:${id.kind}:${id.name}:${id.declarationLocation.start}:${id.declarationLocation.end}`;
}

export function serializeSymbolGraph(graph: SymbolGraph): string {
  const data = {
    nodes: Array.from(graph.nodes.values()).map((n) => ({
      id: n.id,
      kind: n.kind,
      name: n.name,
      qualifiedName: n.name,
      filePath: n.filePath,
      declarationLocation: n.declarationLocation,
      documentation: n.documentation,
      modifiers: n.modifiers,
      typeParameters: n.typeParameters,
      signature: n.signature,
      metadata: n.metadata,
    })),
    edges: graph.edges.map((e) => ({
      from: e.from,
      to: e.to,
      kind: e.kind,
    })),
  };
  return JSON.stringify(data, null, 2);
}

export function deserializeSymbolGraph(json: string): SymbolGraph {
  const data = JSON.parse(json);
  const graph = createSymbolGraph();

  for (const nodeData of data.nodes) {
    const node: SymbolNode = {
      id: nodeData.id,
      kind: nodeData.kind,
      name: nodeData.name,
      qualifiedName: nodeData.qualifiedName,
      filePath: nodeData.filePath,
      declarationLocation: nodeData.declarationLocation,
      documentation: nodeData.documentation,
      modifiers: nodeData.modifiers,
      typeParameters: nodeData.typeParameters,
      signature: nodeData.signature,
      metadata: nodeData.metadata,
    };
    addNode(graph, node);
  }

  for (const edgeData of data.edges) {
    const edge: SymbolEdge = {
      from: edgeData.from,
      to: edgeData.to,
      kind: edgeData.kind,
    };
    addEdge(graph, edge);
  }

  return graph;
}