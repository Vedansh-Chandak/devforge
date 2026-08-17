/**
 * Repository Tool Types
 *
 * Defines the RuntimeBridge interface — the thin boundary between
 * repository tools and Runtime's analyzed intelligence.
 *
 * Tools depend ONLY on this bridge, not on Runtime internals,
 * SymbolGraph, KnowledgeGraph, or RepositoryIndexer directly.
 */

import type { ToolId, ToolPermission, ToolResult, ToolExecutionContext } from '../types.js';

// ── Runtime Bridge ──

/**
 * RuntimeBridge abstracts what repository tools need from Runtime.
 *
 * The application satisfies this by wrapping its initialized Runtime:
 *   - Calling runtime.execute() to get analyzed metadata
 *   - Exposing query helpers that extract typed data from metadata
 *
 * Tools never import DevForgeRuntime, SymbolGraph, or KnowledgeGraph.
 */
export interface RuntimeBridge {
  /** Execute the runtime pipeline and return analyzed metadata. */
  execute(): Promise<RuntimeAnalysis>;

  /** Whether the runtime has been initialized and executed. */
  readonly ready: boolean;
}

/** Analyzed metadata returned by Runtime.execute(). */
export interface RuntimeAnalysis {
  /** Symbol graph nodes (keyed by qualified name). */
  symbols: ReadonlyMap<string, SymbolEntry>;
  /** Knowledge graph nodes. */
  architecture: ArchitectureData;
  /** Parsed file paths for text search. */
  parsedFiles: ReadonlyArray<string>;
}

// ── Symbol Entry ──

/** Flattened symbol info for tool output. */
export interface SymbolEntry {
  readonly name: string;
  readonly qualifiedName: string;
  readonly kind: SymbolKind;
  readonly filePath: string;
  readonly line: number;
  readonly documentation?: string;
}

export type SymbolKind =
  | 'class'
  | 'interface'
  | 'enum'
  | 'function'
  | 'type-alias'
  | 'variable'
  | 'namespace'
  | 'import'
  | 'export';

// ── Dependencies ──

export interface DependencyResult {
  readonly symbol: string;
  readonly dependencies: ReadonlyArray<DependencyEdge>;
  readonly dependents: ReadonlyArray<DependencyEdge>;
}

export interface DependencyEdge {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly edgeKind: string;
  readonly filePath: string;
}

// ── Architecture ──

export interface ArchitectureData {
  readonly modules: ReadonlyArray<ArchitectureNode>;
  readonly services: ReadonlyArray<ArchitectureNode>;
  readonly apis: ReadonlyArray<ArchitectureNode>;
  readonly repositories: ReadonlyArray<ArchitectureNode>;
  readonly databases: ReadonlyArray<ArchitectureNode>;
  readonly relationships: ReadonlyArray<ArchitectureRelationship>;
}

export interface ArchitectureNode {
  readonly name: string;
  readonly kind: string;
  readonly description?: string;
  readonly filePath?: string;
  readonly symbolCount: number;
}

export interface ArchitectureRelationship {
  readonly from: string;
  readonly to: string;
  readonly kind: string;
}

// ── Search ──

export interface SearchResult {
  readonly query: string;
  readonly symbols: ReadonlyArray<SymbolEntry>;
  readonly totalMatches: number;
}

// ── Read File ──

export interface ReadFileInput {
  readonly path: string;
  readonly startLine?: number;
  readonly endLine?: number;
}

export interface ReadFileResult {
  /** Repository-relative path (never absolute host path). */
  readonly path: string;
  readonly content: string;
  readonly size: number;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly truncated?: boolean;
}

// ── Tool IDs ──

export type RepositoryToolId =
  | 'repository.search'
  | 'repository.findSymbol'
  | 'repository.dependencies'
  | 'repository.architecture'
  | 'repository.readFile';

// ── Factory Input ──

/** Dependencies injected into repository tool factory. */
export interface RepositoryToolDependencies {
  /** Initialized RuntimeBridge providing analyzed repository data. */
  runtime: RuntimeBridge;
  /** Absolute path to workspace root (for readFile path security). */
  workspaceRoot: string;
}

// ── Constants ──

/** Default maximum file size for readFile (1 MB). */
export const DEFAULT_MAX_FILE_BYTES = 1 * 1024 * 1024;

/** Default maximum query length for search/findSymbol. */
export const DEFAULT_MAX_QUERY_LENGTH = 500;