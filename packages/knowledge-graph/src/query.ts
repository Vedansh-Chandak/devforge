import type {
  KnowledgeGraph,
  KnowledgeNode,
  KnowledgeNodeId,
  KnowledgeEdge,
  KnowledgeEdgeKind,
} from "./types.js";
import { getNode, getAllNodes, getAllEdges, getEdgesFrom, getEdgesTo, hasNode as hasNodeInGraph, getNodesByKind } from "./graph.js";

export function getNodeById(graph: KnowledgeGraph, id: KnowledgeNodeId): KnowledgeNode | undefined {
  return getNode(graph, id);
}

export function getAllNodesOfKind(graph: KnowledgeGraph, kind: KnowledgeNode["kind"]): KnowledgeNode[] {
  return getAllNodes(graph).filter((n) => n.kind === kind);
}

export function findServicesUsingRepository(graph: KnowledgeGraph, repoName: string): KnowledgeNode[] {
  const repoId: KnowledgeNodeId = { kind: "repository", name: repoName };
  const edges = getEdgesTo(graph, repoId, "dependsOn");
  const services: KnowledgeNode[] = [];

  for (const edge of edges) {
    if (edge.from.kind === "service") {
      const service = getNode(graph, edge.from);
      if (service) {
        services.push(service);
      }
    }
  }

  return services;
}

export function findDatabaseAccessors(graph: KnowledgeGraph, dbName: string): KnowledgeNode[] {
  const dbId: KnowledgeNodeId = { kind: "database", name: dbName };
  const edges = getEdgesTo(graph, dbId, "dependsOn");
  const nodes: KnowledgeNode[] = [];

  for (const edge of edges) {
    if (edge.from.kind === "service" || edge.from.kind === "repository") {
      const node = getNode(graph, edge.from);
      if (node) {
        nodes.push(node);
      }
    }
  }

  return nodes;
}

export function findModuleServices(graph: KnowledgeGraph, moduleName: string): KnowledgeNode[] {
  const moduleId: KnowledgeNodeId = { kind: "module", name: moduleName };
  const edges = getEdgesFrom(graph, moduleId, "contains");
  const services: KnowledgeNode[] = [];

  for (const edge of edges) {
    if (edge.to.kind === "service") {
      const service = getNode(graph, edge.to);
      if (service) {
        services.push(service);
      }
    }
  }

  return services;
}

export function findModuleApis(graph: KnowledgeGraph, moduleName: string): KnowledgeNode[] {
  const moduleId: KnowledgeNodeId = { kind: "module", name: moduleName };
  const edges = getEdgesFrom(graph, moduleId, "contains");
  const apis: KnowledgeNode[] = [];

  for (const edge of edges) {
    if (edge.to.kind === "api") {
      const api = getNode(graph, edge.to);
      if (api) {
        apis.push(api);
      }
    }
  }

  return apis;
}

export function getGraphStats(graph: KnowledgeGraph): {
  nodeCount: number;
  edgeCount: number;
  nodesByKind: Record<string, number>;
  edgesByKind: Record<string, number>;
} {
  const nodes = getAllNodes(graph);
  const edges = getAllEdges(graph);

  const nodesByKind: Record<string, number> = {};
  for (const node of nodes) {
    nodesByKind[node.kind] = (nodesByKind[node.kind] || 0) + 1;
  }

  const edgesByKind: Record<string, number> = {};
  for (const edge of edges) {
    edgesByKind[edge.kind] = (edgesByKind[edge.kind] || 0) + 1;
  }

  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodesByKind,
    edgesByKind,
  };
}

export { getNodesByKind };

export function getNodesByModule(graph: KnowledgeGraph, moduleName: string): KnowledgeNode[] {
  const moduleId: KnowledgeNodeId = { kind: "module", name: moduleName };
  const edges = getEdgesFrom(graph, moduleId, "contains");
  const nodes: KnowledgeNode[] = [];

  for (const edge of edges) {
    const node = getNode(graph, edge.to);
    if (node) {
      nodes.push(node);
    }
  }

  return nodes;
}

export function hasNode(graph: KnowledgeGraph, id: KnowledgeNodeId): boolean {
  return hasNodeInGraph(graph, id);
}

export function hasDependency(graph: KnowledgeGraph, from: KnowledgeNodeId, to: KnowledgeNodeId): boolean {
  const edges = getEdgesFrom(graph, from, "dependsOn");
  return edges.some((edge) => edge.to.kind === to.kind && edge.to.name === to.name);
}