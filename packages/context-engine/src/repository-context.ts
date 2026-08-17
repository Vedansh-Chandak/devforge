import type {
  DependencyEdge,
  BuildContextOptions,
  RepositoryContext,
  RepositoryIndex,
  ResolvedRelation,
  ScoredFile,
  SearchResult,
  SourceFile,
  SymbolInfo,
  Cycle,
  RefreshResult,
  DependencyGraphView,
} from "./types.js";
import { DEFAULT_LIMITS } from "./types.js";
import { FileNotFoundError, InvalidQueryError, IndexNotReadyError } from "./errors.js";
import { RepositoryService } from "./repository-service.js";
import { SymbolResolver } from "./symbol-resolver.js";
import {
  buildDependencyView,
  findDependencies,
  findDependents,
  importDistance,
} from "./dependency-resolver.js";
import { rankFiles } from "./ranking.js";
import type { RankInput } from "./ranking.js";
import { retrieve } from "./retriever.js";
import { realFileAccess } from "./types.js";
import type { FileAccess } from "./types.js";

function tokenize(query: string): string[] {
  const words = query
    .toLowerCase()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 1);
  const unique = new Set<string>(words);
  return Array.from(unique).sort();
}

function pathSegments(filePath: string): string[] {
  return filePath.split("/");
}

function sharedFolderDepth(a: string, b: string): number {
  const sa = pathSegments(a).slice(0, -1);
  const sb = pathSegments(b).slice(0, -1);
  let depth = 0;
  const max = Math.min(sa.length, sb.length);
  for (let i = 0; i < max; i++) {
    if (sa[i] === sb[i]) depth += 1;
    else break;
  }
  return depth;
}

/**
 * The high-level repository context engine. Consumes the four core packages
 * (repository-indexer, parser-typescript, symbol-graph, knowledge-graph) and
 * exposes symbol-aware, dependency-aware context to consumers such as Brain
 * and Planner. Pure repository intelligence: no AI, no prompts.
 */
export class RepositoryContextService {
  private readonly service: RepositoryService;
  private readonly access: FileAccess;

  constructor(access: FileAccess = realFileAccess) {
    this.access = access;
    this.service = new RepositoryService(this.access);
  }

  get isIndexed(): boolean {
    return this.service.index !== null;
  }

  get index(): RepositoryIndex | null {
    return this.service.index;
  }

  get fileCount(): number {
    return this.service.index?.files.size ?? 0;
  }

  get symbolCount(): number {
    return this.service.index?.symbolGraph.nodes.size ?? 0;
  }

  get dependencyCount(): number {
    const index = this.service.index;
    if (!index) return 0;
    return Array.from(index.symbolGraph.edges).length;
  }

  get changedPaths(): ReadonlyArray<string> {
    return this.service.changedPaths;
  }

  async indexRepository(root: string): Promise<RepositoryIndex> {
    return this.service.indexRepository(root);
  }

  /** Index from an in-memory file map (deterministic, disk-free). */
  indexFromContents(files: ReadonlyMap<string, string>): RepositoryIndex {
    return this.service.indexFromContents(files);
  }

  /** Refresh with explicit, known changed file contents. */
  async refresh(changedFiles: ReadonlyMap<string, string>): Promise<RefreshResult> {
    return this.service.refresh(changedFiles);
  }

  /** Re-scan the repository and incrementally re-parse only changed files. */
  async refreshRepository(root: string): Promise<RefreshResult> {
    return this.service.refreshRepository(root);
  }

  getFile(path: string): SourceFile {
    const index = this.requireIndex();
    const file = index.files.get(normalizeRequestedPath(path));
    if (!file) throw new FileNotFoundError(path);
    return file;
  }

  hasFile(path: string): boolean {
    const index = this.service.index;
    if (!index) return false;
    return index.files.has(normalizeRequestedPath(path));
  }

  findSymbol(name: string): SymbolInfo[] {
    return this.resolver().findSymbol(name);
  }

  findDefinition(name: string): SymbolInfo[] {
    return this.resolver().findDefinition(name);
  }

  findReferences(name: string): ResolvedRelation[] {
    return this.resolver().findReferences(name);
  }

  findImplementations(name: string): ResolvedRelation[] {
    return this.resolver().findImplementations(name);
  }

  findCallers(name: string): ResolvedRelation[] {
    return this.resolver().findCallers(name);
  }

  findSymbolsInFile(path: string): SymbolInfo[] {
    this.requireFile(path);
    return this.resolver().findSymbolsInFile(normalizeRequestedPath(path));
  }

  findExports(path: string): SymbolInfo[] {
    this.requireFile(path);
    return this.resolver().findExports(normalizeRequestedPath(path));
  }

  findDependencies(file: string): DependencyEdge[] {
    const normalized = normalizeRequestedPath(file);
    this.requireFile(normalized);
    const view = this.dependencyView();
    return findDependencies(view.importGraph, normalized);
  }

  findDependents(file: string): DependencyEdge[] {
    const normalized = normalizeRequestedPath(file);
    this.requireFile(normalized);
    const view = this.dependencyView();
    return findDependents(view.importGraph, normalized);
  }

  /** Detect circular dependency cycles in the import graph. */
  getCircularDependencies(): Cycle[] {
    const view = this.dependencyView();
    return view.circular.map((path) => ({ path }));
  }

  getDependencyView(): DependencyGraphView {
    return this.dependencyView();
  }

  /**
   * Files related to `path`: same-folder siblings plus files that import or
   * are imported by it (and their same-folder siblings).
   */
  getRelatedFiles(path: string): string[] {
    const normalized = normalizeRequestedPath(path);
    this.requireFile(normalized);
    const view = this.dependencyView();
    const folder = pathSegments(normalized).slice(0, -1).join("/");
    const related = new Set<string>();
    for (const file of this.service.index?.files.keys() ?? []) {
      const dir = pathSegments(file).slice(0, -1).join("/");
      if (dir === folder) related.add(file);
    }
    for (const edge of findDependencies(view.importGraph, normalized)) {
      related.add(edge.to);
    }
    for (const edge of findDependents(view.importGraph, normalized)) {
      related.add(edge.from);
    }
    return Array.from(related).sort();
  }

  /**
   * Build a token-bounded {@link RepositoryContext} for a natural-language or
   * symbol query. Never returns the whole repository.
   */
  buildContext(query: string, options: BuildContextOptions = {}): RepositoryContext {
    const tokens = validateQuery(query);
    const index = this.requireIndex();
    const resolver = this.resolver();
    const view = this.dependencyView();
    const recent = normalizeRecent(options.recentlyChangedFiles);

    const matched = index.files.size > 0 ? this.symbolMatches(tokens) : [];
    const seeds = Array.from(new Set(matched.map((m) => m.filePath))).sort();

    const importGraph = view.importGraph;
    const anchor = anchorPath(tokens, seeds);

    const rankedInputs: RankInput[] = [];
    for (const filePath of Array.from(index.files.keys()).sort()) {
      const fileSymbols = resolver.findSymbolsInFile(filePath);
      const hasExactMatch = fileSymbols.some((s) => tokenEquals(s.name, tokens));
      const similarCount = fileSymbols.filter((s) => tokenMatches(s.name, tokens)).length;
      const referenceCount = fileSymbols
        .filter((s) => tokenMatches(s.name, tokens))
        .reduce((acc, s) => acc + this.referenceCountFor(s), 0);

      const distance = seeds.length > 0 ? minDistance(importGraph, seeds, filePath) : null;
      rankedInputs.push({
        filePath,
        hasExactMatch,
        similarSymbolCount: similarCount,
        referenceCount,
        importDistance: distance,
        pathHits: pathHits(filePath, tokens),
        sharedFolderDepth: anchor ? sharedFolderDepth(filePath, anchor) : 0,
        recentlyChanged: recent.has(filePath),
      });
    }

    const ranked = rankFiles(rankedInputs);

    const symbols = matched.sort((a, b) =>
      `${a.filePath}:${a.name}`.localeCompare(`${b.filePath}:${b.name}`)
    );

    const relatedInterfaces = options.includeRelatedInterfaces === false
      ? []
      : symbols.filter((s) => s.kind === "interface");

    const implementations = options.includeImplementations === false
      ? []
      : interfacesWithImplementations(tokens, resolver);

    const topFile = ranked[0]?.filePath;
    const dependencyChain = topFile
      ? findDependencies(importGraph, topFile, 2)
      : [];

    const limits = { ...DEFAULT_LIMITS, ...definedLimits(limitsOf(options)) };
    const result = retrieve({
      ranked,
      symbols,
      dependencies: dependencyChain,
      references: implementations,
      contentProvider: (p) => index.files.get(p)?.content,
      limits,
    });

    const relevantImports = new Map<string, string[]>();
    for (const scored of result.files) {
      relevantImports.set(
        scored.filePath,
        Array.from(importGraph.get(scored.filePath) ?? [])
      );
    }

    return {
      query,
      files: result.files,
      symbols: result.symbols,
      relatedInterfaces,
      importGraph: relevantImports,
      dependencyChain: result.dependencies,
      implementations: result.references,
      tokenBudget: result.tokenBudget,
      tokenUsed: result.tokenUsed,
      truncated: result.truncated,
    };
  }

  /** Ranked, token-bounded search across files and symbols. */
  search(query: string): SearchResult {
    const tokens = validateQuery(query);
    const index = this.requireIndex();
    const resolver = this.resolver();
    const view = this.dependencyView();

    const matched = this.symbolMatches(tokens);
    const seeds = Array.from(new Set(matched.map((m) => m.filePath))).sort();
    const anchor = anchorPath(tokens, seeds);

    const rankedInputs: RankInput[] = [];
    for (const filePath of Array.from(index.files.keys()).sort()) {
      const fileSymbols = resolver.findSymbolsInFile(filePath);
      rankedInputs.push({
        filePath,
        hasExactMatch: fileSymbols.some((s) => tokenEquals(s.name, tokens)),
        similarSymbolCount: fileSymbols.filter((s) => tokenMatches(s.name, tokens)).length,
        referenceCount: 0,
        importDistance: seeds.length > 0 ? minDistance(view.importGraph, seeds, filePath) : null,
        pathHits: pathHits(filePath, tokens),
        sharedFolderDepth: anchor ? sharedFolderDepth(filePath, anchor) : 0,
        recentlyChanged: false,
      });
    }

    return {
      query,
      files: rankFiles(rankedInputs),
      symbols: matched,
    };
  }

  private symbolMatches(tokens: ReadonlyArray<string>): SymbolInfo[] {
    return this.resolver().allSymbols().filter((s) => tokenMatches(s.name, tokens));
  }

  private referenceCountFor(symbol: SymbolInfo): number {
    return this.resolver().referencesTo(symbol).length;
  }

  private resolver(): SymbolResolver {
    this.requireIndex();
    return new SymbolResolver(this.service.index as RepositoryIndex);
  }

  private dependencyView(): DependencyGraphView {
    const index = this.requireIndex();
    return buildDependencyView(
      Array.from(index.parsed.values()),
      new Set(index.files.keys())
    );
  }

  private requireIndex(): RepositoryIndex {
    const index = this.service.index;
    if (!index) throw new IndexNotReadyError();
    return index;
  }

  private requireFile(path: string): void {
    if (!this.hasFile(path)) throw new FileNotFoundError(path);
  }
}

function interfacesWithImplementations(
  tokens: ReadonlyArray<string>,
  resolver: SymbolResolver
): ResolvedRelation[] {
  const result: ResolvedRelation[] = [];
  for (const symbol of resolver.allSymbols()) {
    if ((symbol.kind === "interface" || symbol.kind === "class") && tokenMatches(symbol.name, tokens)) {
      result.push(...resolver.findImplementations(symbol.name));
    }
  }
  return result;
}

function limitsOf(options: BuildContextOptions) {
  return {
    maxFiles: options.maxFiles,
    maxSymbols: options.maxSymbols,
    maxDependencies: options.maxDependencies,
    maxReferences: options.maxReferences,
    tokenBudget: options.tokenBudget,
  };
}

function definedLimits(
  limits: ReturnType<typeof limitsOf>
): Record<string, number> {
  const defined: Record<string, number> = {};
  for (const [key, value] of Object.entries(limits)) {
    if (value !== undefined) defined[key] = value;
  }
  return defined;
}

function normalizeRecent(
  recent: ReadonlySet<string> | ReadonlyArray<string> | undefined
): Set<string> {
  if (!recent) return new Set();
  return new Set(Array.from(recent));
}

function validateQuery(query: string): string[] {
  if (typeof query !== "string" || query.trim().length === 0) {
    throw new InvalidQueryError("Query must be a non-empty string.");
  }
  const tokens = tokenize(query);
  if (tokens.length === 0) {
    throw new InvalidQueryError(`Query produced no searchable tokens: ${query}`);
  }
  return tokens;
}

function normalizeRequestedPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function tokenMatches(symbolName: string, tokens: ReadonlyArray<string>): boolean {
  const lower = symbolName.toLowerCase();
  return tokens.some((t) => lower.includes(t));
}

function tokenEquals(symbolName: string, tokens: ReadonlyArray<string>): boolean {
  const lower = symbolName.toLowerCase();
  return tokens.some((t) => lower === t);
}

function pathHits(filePath: string, tokens: ReadonlyArray<string>): number {
  const segments = pathSegments(filePath.toLowerCase());
  let hits = 0;
  for (const token of tokens) {
    if (segments.some((s) => s.includes(token))) hits += 1;
  }
  return hits;
}

function anchorPath(tokens: ReadonlyArray<string>, seeds: ReadonlyArray<string>): string | null {
  const token = tokens[0];
  if (token && token.includes("/")) return token;
  if (seeds.length > 0) return seeds[0] ?? null;
  return null;
}

function minDistance(
  importGraph: ReadonlyMap<string, ReadonlyArray<string>>,
  seeds: ReadonlyArray<string>,
  target: string
): number | null {
  let best: number | null = null;
  for (const seed of seeds) {
    const distance = importDistance(importGraph, seed, target);
    if (distance !== null && (best === null || distance < best)) {
      best = distance;
    }
  }
  return best;
}