import type {
  DependencyEdge,
  ResolvedRelation,
  RetrievedContent,
  RetrievalResult,
  ScoredFile,
  SymbolInfo,
} from "./types.js";
import { DEFAULT_LIMITS } from "./types.js";

/** Rough token estimate: roughly one token per four characters. */
export function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

/** Trim `content` to fit within `budget` tokens, splitting on line ends. */
export function truncateToTokens(
  content: string,
  budget: number,
  tokenCount: (c: string) => number = estimateTokens
): { slice: string; tokenCount: number; truncated: boolean } {
  if (budget <= 0) return { slice: "", tokenCount: 0, truncated: content.length > 0 };
  if (tokenCount(content) <= budget) {
    return { slice: content, tokenCount: tokenCount(content), truncated: false };
  }
  const lines = content.split("\n");
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const lineTokens = tokenCount(line + "\n");
    if (used + lineTokens > budget) break;
    kept.push(line);
    used += lineTokens;
  }
  const slice = kept.join("\n");
  return { slice, tokenCount: used, truncated: true };
}

/** Select the top `maxFiles` ranked files. */
export function selectTopFiles(
  ranked: ReadonlyArray<ScoredFile>,
  maxFiles: number
): ScoredFile[] {
  return ranked.slice(0, Math.max(0, maxFiles));
}

/** Select the top `max` symbols, preserving ranked order. */
export function selectTopSymbols(
  symbols: ReadonlyArray<SymbolInfo>,
  max: number
): SymbolInfo[] {
  return symbols.slice(0, Math.max(0, max));
}

/** Select the top `max` dependency edges. */
export function selectTopDependencies(
  dependencies: ReadonlyArray<DependencyEdge>,
  max: number
): DependencyEdge[] {
  return dependencies.slice(0, Math.max(0, max));
}

/** Select the top `max` reference relations. */
export function selectTopReferences(
  references: ReadonlyArray<ResolvedRelation>,
  max: number
): ResolvedRelation[] {
  return references.slice(0, Math.max(0, max));
}

/** Result of {@link retrieveContents}. */
export interface RetrieveContentsResult {
  readonly contents: RetrievedContent[];
  readonly tokenUsed: number;
  readonly truncated: boolean;
}

/**
 * Greedily pull file slices until either `maxFiles` are collected or the
 * token budget is exhausted. Content is served from `contentProvider` and
 * trimmed to the remaining budget on demand.
 */
export function retrieveContents(
  ranked: ReadonlyArray<ScoredFile>,
  maxFiles: number,
  tokenBudget: number,
  contentProvider: (filePath: string) => string | undefined,
  tokenCount: (c: string) => number = estimateTokens
): RetrieveContentsResult {
  const contents: RetrievedContent[] = [];
  let tokenUsed = 0;
  let truncated = false;
  const budgetPerFile = Math.max(1, Math.floor(tokenBudget / Math.max(1, maxFiles)));

  for (const file of ranked.slice(0, maxFiles)) {
    if (tokenUsed >= tokenBudget) {
      truncated = true;
      break;
    }
    const raw = contentProvider(file.filePath);
    if (raw === undefined) continue;
    const remaining = tokenBudget - tokenUsed;
    const target = Math.min(budgetPerFile, remaining);
    const { slice, tokenCount: used, truncated: fileTruncated } = truncateToTokens(raw, target, tokenCount);
    contents.push({ filePath: file.filePath, slice, tokenCount: used, truncated: fileTruncated });
    tokenUsed += used;
    if (fileTruncated) truncated = true;
  }

  return { contents, tokenUsed, truncated };
}

/** Compose a complete {@link RetrievalResult} under the given limits. */
export function retrieve(
  options: {
    readonly ranked: ReadonlyArray<ScoredFile>;
    readonly symbols: ReadonlyArray<SymbolInfo>;
    readonly dependencies: ReadonlyArray<DependencyEdge>;
    readonly references: ReadonlyArray<ResolvedRelation>;
    readonly contentProvider: (filePath: string) => string | undefined;
    readonly limits?: Partial<RetrievalResultLimits>;
  }
): RetrievalResult {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const files = selectTopFiles(options.ranked, limits.maxFiles);
  const symbols = selectTopSymbols(options.symbols, limits.maxSymbols);
  const dependencies = selectTopDependencies(options.dependencies, limits.maxDependencies);
  const references = selectTopReferences(options.references, limits.maxReferences);
  const { contents, tokenUsed, truncated } = retrieveContents(
    files,
    limits.maxFiles,
    limits.tokenBudget,
    options.contentProvider
  );

  return {
    files,
    symbols,
    dependencies,
    references,
    contents,
    tokenBudget: limits.tokenBudget,
    tokenUsed,
    truncated,
  };
}

/** Shape of a partial limit set accepted by {@link retrieve}. */
export interface RetrievalResultLimits {
  readonly maxFiles: number;
  readonly maxSymbols: number;
  readonly maxDependencies: number;
  readonly maxReferences: number;
  readonly tokenBudget: number;
}