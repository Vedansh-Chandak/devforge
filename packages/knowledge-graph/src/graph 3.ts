import type {
  KnowledgeNode,
  KnowledgeEdge,
  KnowledgeGraph,
  KnowledgeNodeId,
  KnowledgeEdgeKind,
} from "./types.js";

export function createKnowledgeGraph(): KnowledgeGraph {
  return {
    nodes: new Map(),
    edges: [],
    outgoing: new Map(),
    incoming: new Map(),
  };
}

export function addNode(graph: KnowledgeGraph, node: KnowledgeNode): void {
  const key = knowledgeNodeIdToString(node.id);
  graph.nodes.set(key, node);
  graph.outgoing.set(key, []);
  graph.incoming.set(key, []);
}

export function addEdge(graph: KnowledgeGraph, edge: KnowledgeEdge): void {
  const fromKey = knowledgeNodeIdToString(edge.from);
  const toKey = knowledgeNodeIdToString(edge.to);

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

export function getNode(graph: KnowledgeGraph, id: KnowledgeNodeId): KnowledgeNode | undefined {
  const key = knowledgeNodeIdToString(id);
  return graph.nodes.get(key);
}

export function getOutgoingEdges(graph: KnowledgeGraph, id: KnowledgeNodeId, kind?: KnowledgeEdgeKind): KnowledgeEdge[] {
  const key = knowledgeNodeIdToString(id);
  const edges = graph.outgoing.get(key) || [];
  if (kind) {
    return edges.filter((e) => e.kind === kind);
  }
  return edges;
}

export function getIncomingEdges(graph: KnowledgeGraph, id: KnowledgeNodeId, kind?: KnowledgeEdgeKind): KnowledgeEdge[] {
  const key = knowledgeNodeIdToString(id);
  const edges = graph.incoming.get(key) || [];
  if (kind) {
    return edges.filter((e) => e.kind === kind);
  }
  return edges;
}

export function getEdgesFrom(graph: KnowledgeGraph, id: KnowledgeNodeId, kind?: KnowledgeEdgeKind): KnowledgeEdge[] {
  return getOutgoingEdges(graph, id, kind);
}

export function getEdgesTo(graph: KnowledgeGraph, id: KnowledgeNodeId, kind?: KnowledgeEdgeKind): KnowledgeEdge[] {
  return getIncomingEdges(graph, id, kind);
}

export function getAllNodes(graph: KnowledgeGraph): KnowledgeNode[] {
  return Array.from(graph.nodes.values());
}

export function getAllEdges(graph: KnowledgeGraph): KnowledgeEdge[] {
  return [...graph.edges];
}

export function getNodesByKind(graph: KnowledgeGraph, kind: KnowledgeNode["kind"]): KnowledgeNode[] {
  return getAllNodes(graph).filter((n) => n.kind === kind);
}

export function hasNode(graph: KnowledgeGraph, id: KnowledgeNodeId): boolean {
  const key = knowledgeNodeIdToString(id);
  return graph.nodes.has(key);
}

export function knowledgeNodeIdToString(id: KnowledgeNodeId): string {
  return `kg:${id.kind}:${id.name}`;
}

export function serializeKnowledgeGraph(graph: KnowledgeGraph): string {
  const data = {
    nodes: Array.from(graph.nodes.values()).map((n) => ({
      id: n.id,
      kind: n.kind,
      name: n.name,
      sourceSymbols: n.sourceSymbols,
      properties: n.properties,
    })),
    edges: graph.edges.map((e) => ({
      id: e.id,
      kind: e.kind,
      from: e.from,
      to: e.to,
      properties: e.properties,
    })),
  };
  return JSON.stringify(data, null, 2);
}

export function deserializeKnowledgeGraph(json: string): KnowledgeGraph {
  const data = JSON.parse(json);
  const graph = createKnowledgeGraph();

  for (const nodeData of data.nodes) {
    const node: KnowledgeNode = {
      id: nodeData.id,
      kind: nodeData.kind,
      name: nodeData.name,
      qualifiedName: nodeData.qualifiedName || nodeData.name,
      sourceSymbols: nodeData.sourceSymbols || [],
      sourceFiles: nodeData.sourceFiles || [],
      properties: nodeData.properties || {},
      confidence: nodeData.confidence || 1.0,
      createdAt: nodeData.createdAt || new Date().toISOString(),
      version: nodeData.version || 1,
    };
    addNode(graph, node);
  }

  for (const edgeData of data.edges) {
    const edge: KnowledgeEdge = {
      id: edgeData.id,
      kind: edgeData.kind,
      from: edgeData.from,
      to: edgeData.to,
      properties: edgeData.properties || {},
    };
    addEdge(graph, edge);
  }

  return graph;
}