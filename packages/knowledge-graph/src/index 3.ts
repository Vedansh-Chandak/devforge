export {
  buildKnowledgeGraph,
  getKnowledgeNode as getNode,
  getDependencies,
  getDependents,
} from "./builder.js";

export {
  getNodeById,
  getAllNodesOfKind,
  findServicesUsingRepository,
  findDatabaseAccessors,
  findModuleServices,
  findModuleApis,
  getGraphStats,
  getNodesByModule,
  hasDependency,
  hasNode,
  getNodesByKind,
} from "./query.js";

export type {
  KnowledgeNodeKind,
  KnowledgeEdgeKind,
  KnowledgeNodeId,
  KnowledgeNode,
  KnowledgeNodeProperties,
  KnowledgeEdge,
  KnowledgeEdgeProperties,
  KnowledgeGraph,
  BuildKnowledgeGraphOptions,
} from "./types.js";