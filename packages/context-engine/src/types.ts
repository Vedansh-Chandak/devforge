import type {
  SymbolGraph,
  SymbolKind,
  Location,
  ParsedFile,
  SymbolNode,
  SymbolId,
  EdgeKind,
} from "@devforge/symbol-graph";
import type { KnowledgeGraph } from "@devforge/knowledge-graph";

/** The set of file extensions parsed into the symbol graph. */
export const PARSEABLE_EXTENSIONS: ReadonlyArray<string> = ["ts", "tsx", "mts", "cts"];

/** The recognized programming languages a file may map to. */
export type SourceLanguage = "typescript" | "typescript-react" | "unknown";

/** A concrete source file registered in the index. */
export interface SourceFile {
  readonly path: string;
  readonly content: string;
  readonly language: SourceLanguage;
  readonly isParsed: boolean;
}

/** A lightweight, consumer-facing description of a resolved symbol. */
export interface SymbolInfo {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly filePath: string;
  readonly qualifiedName: string;
  readonly declarationLocation: Location;
  readonly exported: boolean;
}

/** A single graph hop originating at a symbol. */
export interface SymbolRelation {
  readonly kind: EdgeKind;
  readonly fromFilePath: string;
  readonly toFilePath: string;
  readonly fromName: string;
  readonly toName: string;
}

/** A resolved caller or implementor pairing plus the edge that links them. */
export interface ResolvedRelation {
  readonly source: SymbolInfo;
  readonly target: SymbolInfo;
  readonly kind: EdgeKind;
}

/** Adjacency bookkeeping built from a set of parsed files. */
export interface DependencyGraphView {
  readonly importGraph: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly exportGraph: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly circular: ReadonlyArray<ReadonlyArray<string>>;
}

/** A dependency edge with depth information for transitive traversals. */
export interface DependencyEdge {
  readonly from: string;
  readonly to: string;
  readonly depth: number;
}

/** A cycle reported by the dependency resolver. */
export interface Cycle {
  readonly path: ReadonlyArray<string>;
}

/** A file scored for relevance against a query. */
export interface ScoredFile {
  readonly filePath: string;
  readonly score: number;
  readonly hasExactMatch: boolean;
  readonly referenceCount: number;
  readonly importDistance: number | null;
  readonly folderProximity: number;
  readonly pathSimilarity: number;
  readonly recentlyChanged: boolean;
}

/** Token-aware limits applied by the retriever. */
export interface RetrieverLimits {
  readonly maxFiles: number;
  readonly maxSymbols: number;
  readonly maxDependencies: number;
  readonly maxReferences: number;
  readonly tokenBudget: number;
  readonly defaultTokenCount?: (content: string) => number;
}

/** A language-agnostic content slice trimmed to a token budget. */
export interface RetrievedContent {
  readonly filePath: string;
  readonly slice: string;
  readonly tokenCount: number;
  readonly truncated: boolean;
}

/** The aggregate, budget-bounded result of a retrieval. */
export interface RetrievalResult {
  readonly files: ReadonlyArray<ScoredFile>;
  readonly symbols: ReadonlyArray<SymbolInfo>;
  readonly dependencies: ReadonlyArray<DependencyEdge>;
  readonly references: ReadonlyArray<ResolvedRelation>;
  readonly contents: ReadonlyArray<RetrievedContent>;
  readonly tokenBudget: number;
  readonly tokenUsed: number;
  readonly truncated: boolean;
}

/** Highest-level context requested from a natural-language or symbol query. */
export interface RepositoryContext {
  readonly query: string;
  readonly files: ReadonlyArray<ScoredFile>;
  readonly symbols: ReadonlyArray<SymbolInfo>;
  readonly relatedInterfaces: ReadonlyArray<SymbolInfo>;
  readonly importGraph: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly dependencyChain: ReadonlyArray<DependencyEdge>;
  readonly implementations: ReadonlyArray<ResolvedRelation>;
  readonly tokenBudget: number;
  readonly tokenUsed: number;
  readonly truncated: boolean;
}

/** The result of a free-text search across the repository. */
export interface SearchResult {
  readonly query: string;
  readonly files: ReadonlyArray<ScoredFile>;
  readonly symbols: ReadonlyArray<SymbolInfo>;
}

/** Options accepted when building a {@link RepositoryContext}. */
export interface BuildContextOptions {
  readonly maxFiles?: number;
  readonly maxSymbols?: number;
  readonly maxDependencies?: number;
  readonly maxReferences?: number;
  readonly tokenBudget?: number;
  readonly includeRelatedInterfaces?: boolean;
  readonly includeImplementations?: boolean;
  readonly recentlyChangedFiles?: ReadonlySet<string> | ReadonlyArray<string>;
}

/** Default {@link RetrieverLimits} applied when the caller omits options. */
export const DEFAULT_LIMITS: Required<
  Pick<
    RetrieverLimits,
    "maxFiles" | "maxSymbols" | "maxDependencies" | "maxReferences" | "tokenBudget"
  >
> = {
  maxFiles: 25,
  maxSymbols: 40,
  maxDependencies: 60,
  maxReferences: 60,
  tokenBudget: 4000,
};

/**
 * The core, immutable snapshot index maintained by the service. Downstream
 * consumers (resolvers, rankers, retrievers) read from this single structure.
 */
export interface RepositoryIndex {
  readonly files: ReadonlyMap<string, SourceFile>;
  readonly parsed: ReadonlyMap<string, ParsedFile>;
  readonly symbols: ReadonlyMap<string, SymbolNode>;
  readonly symbolGraph: SymbolGraph;
  readonly knowledgeGraph: KnowledgeGraph;
  readonly fingerprints: ReadonlyMap<string, string>;
  readonly changedSinceRefresh: ReadonlySet<string>;
  readonly indexedAt: string;
}

/** The result returned by refresh operations. */
export interface RefreshResult {
  readonly reindexedFiles: ReadonlyArray<string>;
  readonly retainedFiles: ReadonlyArray<string>;
  readonly totalFiles: number;
  readonly broken: ReadonlyArray<string>;
}

/** Minimal file access abstraction used to read source from disk or tests. */
export interface FileAccess {
  readFile(path: string): Promise<string>;
}

/** Default {@link FileAccess} reading from the real filesystem. */
export const realFileAccess: FileAccess = {
  readFile: async (path: string) => {
    const { readFile } = await import("node:fs/promises");
    return readFile(path, "utf8");
  },
};

export type { SymbolGraph, SymbolKind, Location, ParsedFile, SymbolNode, SymbolId, EdgeKind, KnowledgeGraph };