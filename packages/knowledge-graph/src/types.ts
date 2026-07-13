import type { SymbolId, SymbolNode, SymbolGraph, EdgeKind } from "@devforge/symbol-graph";

export type KnowledgeNodeKind =
  | "module"
  | "service"
  | "api"
  | "repository"
  | "database";

export type KnowledgeEdgeKind =
  | "contains"
  | "dependsOn"
  | "exposes";

export interface KnowledgeNodeId {
  readonly kind: KnowledgeNodeKind;
  readonly name: string;
}

export function knowledgeNodeIdToString(id: KnowledgeNodeId): string {
  return `kg:${id.kind}:${id.name}`;
}

export function parseKnowledgeNodeId(str: string): KnowledgeNodeId | null {
  const match = str.match(/^kg:(module|service|api|repository|database):(.+)$/);
  if (!match || !match[1] || !match[2]) return null;
  return { kind: match[1] as KnowledgeNodeKind, name: match[2] };
}

export interface KnowledgeNodeProperties {
  readonly description?: string;
  readonly filePath?: string;
  readonly exportName?: string;
}

export interface KnowledgeNode {
  readonly id: KnowledgeNodeId;
  readonly kind: KnowledgeNodeKind;
  readonly name: string;
  readonly qualifiedName: string;
  readonly sourceSymbols: ReadonlyArray<SymbolId>;
  readonly sourceFiles: ReadonlyArray<string>;
  readonly properties: KnowledgeNodeProperties;
  readonly confidence: number;
  readonly createdAt: string;
  readonly version: number;
}

export interface KnowledgeEdgeProperties {
  readonly sourceSymbol?: SymbolId;
  readonly edgeKind?: EdgeKind;
  readonly symbolEdgeKind?: EdgeKind;
}

export interface KnowledgeEdge {
  readonly id: string;
  readonly kind: KnowledgeEdgeKind;
  readonly from: KnowledgeNodeId;
  readonly to: KnowledgeNodeId;
  readonly properties: KnowledgeEdgeProperties;
}

export interface KnowledgeGraph {
  readonly nodes: Map<string, KnowledgeNode>;
  readonly edges: KnowledgeEdge[];
  readonly outgoing: Map<string, KnowledgeEdge[]>;
  readonly incoming: Map<string, KnowledgeEdge[]>;
}

export interface BuildKnowledgeGraphOptions {
  readonly includePrivate?: boolean;
}