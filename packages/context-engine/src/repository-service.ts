import { scanRepository, collectTree } from "@devforge/repository-indexer";
import type { RepositoryTree, FileNode } from "@devforge/repository-indexer";
import { parseTypeScript } from "@devforge/parser-typescript";
import type { ParseResult } from "@devforge/parser-typescript";
import { buildSymbolGraph, symbolIdToKey } from "@devforge/symbol-graph";
import type { ParsedFile, SymbolGraph, SymbolNode } from "@devforge/symbol-graph";
import { buildKnowledgeGraph } from "@devforge/knowledge-graph";
import type { KnowledgeGraph } from "@devforge/knowledge-graph";

import { IncrementalCache, fingerprint } from "./cache.js";
import { ScanFailedError, InvalidPathError } from "./errors.js";
import {
  PARSEABLE_EXTENSIONS,
  realFileAccess,
} from "./types.js";
import type {
  FileAccess,
  RepositoryIndex,
  RefreshResult,
  SourceFile,
  SourceLanguage,
} from "./types.js";

function normalizePath(path: string): string {
  const cleaned = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (cleaned === "" || cleaned === ".") {
    throw new InvalidPathError(path);
  }
  if (cleaned.split("/").includes("..")) {
    throw new InvalidPathError(path);
  }
  return cleaned;
}

function extensionOf(path: string): string {
  const idx = path.lastIndexOf(".");
  if (idx < 0 || idx === path.length - 1) return "";
  return path.slice(idx + 1).toLowerCase();
}

export function isParseable(path: string): boolean {
  return PARSEABLE_EXTENSIONS.includes(extensionOf(path));
}

export function languageOf(path: string): SourceLanguage {
  const ext = extensionOf(path);
  if (ext === "tsx") return "typescript-react";
  if (PARSEABLE_EXTENSIONS.includes(ext)) return "typescript";
  return "unknown";
}

function parseFile(path: string, content: string): ParsedFile | null {
  if (!isParseable(path)) return null;
  const result: ParseResult = parseTypeScript(content, path);
  return { filePath: path, ...result };
}

function buildKnowledgeFromSymbolGraph(symbolGraph: SymbolGraph, parsed: ParsedFile[]): KnowledgeGraph {
  return buildKnowledgeGraph(symbolGraph, parsed);
}

/**
 * Low-level service that owns the incremental cache and the persistent parse
 * cache, and produces {@link RepositoryIndex} snapshots. Consumers generally
 * prefer {@link RepositoryContextService}, but this class is fully usable on
 * its own when callers only need the graph layer.
 */
export class RepositoryService {
  private readonly cache = new IncrementalCache();
  private readonly parsedCache = new Map<string, ParsedFile>();
  private readonly contents = new Map<string, string>();
  private readonly access: FileAccess;
  private _index: RepositoryIndex | null = null;
  private changedSinceRefresh = new Set<string>();

  constructor(access: FileAccess = realFileAccess) {
    this.access = access;
  }

  get index(): RepositoryIndex | null {
    return this._index;
  }

  /** Number of file fingerprints currently held in the incremental cache. */
  get cachedFileCount(): number {
    return this.cache.size;
  }

  get graphDigest(): string | undefined {
    return this.cache.graphDigest;
  }

  /** Paths detected as changed by the most recent refresh operation. */
  get changedPaths(): ReadonlyArray<string> {
    return Array.from(this.changedSinceRefresh);
  }

  /**
   * Scan a real repository on disk, read every file, and build the index.
   */
  async indexRepository(root: string): Promise<RepositoryIndex> {
    let tree: RepositoryTree;
    try {
      tree = await scanRepository(root);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ScanFailedError(root, message);
    }

    const fileNodes = (await collectTree(tree, {
      includeDirectories: false,
      filter: (node) => node.type === "file",
    })) as FileNode[];

    const contents = new Map<string, string>();
    for (const node of fileNodes) {
      try {
        const content = await this.access.readFile(node.absolutePath);
        contents.set(node.relativePath, content);
      } catch {
        // Unreadable files are skipped, mirroring the indexer's resilience.
      }
    }

    this.cache.register(contents);
    return this.commit(contents, new Set(contents.keys()));
  }

  /**
   * Build an index from an in-memory map of relative path -> content. This is
   * the deterministic, disk-free entry point used by tests and tools that
   * synthesize repositories.
   */
  indexFromContents(files: ReadonlyMap<string, string>): RepositoryIndex {
    const contents = new Map<string, string>();
    for (const [path, content] of files) {
      contents.set(normalizePath(path), content);
    }
    this.cache.register(contents);
    return this.commit(contents, new Set(contents.keys()));
  }

  /**
   * Incrementally refresh an indexed repository. `changedFiles` must contain
   * the up-to-date content of every file the caller knows changed; unchanged
   * files are served from the parse cache and never re-parsed.
   */
  async refresh(changedFiles: ReadonlyMap<string, string>): Promise<RefreshResult> {
    return this.refreshInternal(new Map(changedFiles));
  }

  /**
   * Re-scan the repository from disk and incrementally re-parse only the files
   * whose fingerprint actually changed (compared against the cache).
   */
  async refreshRepository(root: string): Promise<RefreshResult> {
    if (this._index === null) {
      await this.indexRepository(root);
      return this.refreshResult([]);
    }

    const current = await this.readAllFiles(root);
    const diff = this.cache.diff(this.fingerprintAll(current));
    const changed = new Map<string, string>();
    for (const path of [...diff.added, ...diff.changed]) {
      const content = current.get(path);
      if (content !== undefined) changed.set(path, content);
    }

    this.retireRemoved(diff.removed);
    for (const path of changed.keys()) this.cache.invalidate(path);
    this.cache.register(changed);
    this.commit(changed, new Set(changed.keys()), { reindexed: [...diff.added, ...diff.changed] });

    const broken: string[] = [];
    return {
      reindexedFiles: [...diff.added, ...diff.changed],
      retainedFiles: diff.retained,
      totalFiles: this.contents.size,
      broken,
    };
  }

  private async refreshInternal(changedFiles: ReadonlyMap<string, string>): Promise<RefreshResult> {
    if (this._index === null) {
      throw new Error("Cannot refresh before the repository has been indexed.");
    }

    const current = new Map<string, string>();
    for (const path of this.contents.keys()) {
      const existing = this.contents.get(path);
      if (existing !== undefined) current.set(path, existing);
    }
    for (const [path, content] of changedFiles) {
      current.set(normalizePath(path), content);
    }

    const diff = this.cache.diff(this.fingerprintAll(current));
    const toReindex = new Set([...diff.added, ...diff.changed]);

    const updated = new Map<string, string>();
    for (const path of toReindex) {
      const content = current.get(path);
      if (content !== undefined) updated.set(path, content);
    }

    this.retireRemoved(diff.removed);
    for (const path of toReindex) this.cache.invalidate(path);
    this.cache.register(updated);
    this.commit(updated, new Set(toReindex));

    return this.refreshResult(diff.removed);
  }

  private refreshResult(removed: ReadonlyArray<string>): RefreshResult {
    return {
      reindexedFiles: Array.from(this.changedSinceRefresh).filter((p) => this.contents.has(p)),
      retainedFiles: Array.from(this.contents.keys()).filter((p) => !this.changedSinceRefresh.has(p)),
      totalFiles: this.contents.size,
      broken: [...removed],
    };
  }

  private retireRemoved(removed: ReadonlyArray<string>): void {
    for (const path of removed) {
      this.cache.invalidate(path);
      this.parsedCache.delete(path);
      this.contents.delete(path);
      this.changedSinceRefresh.delete(path);
    }
  }

  private fingerprintAll(contents: ReadonlyMap<string, string>): Map<string, string> {
    const result = new Map<string, string>();
    for (const [path, content] of contents) {
      result.set(path, fingerprint(content));
    }
    return result;
  }

  private async readAllFiles(root: string): Promise<Map<string, string>> {
    let tree: RepositoryTree;
    try {
      tree = await scanRepository(root);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ScanFailedError(root, message);
    }
    const fileNodes = (await collectTree(tree, {
      includeDirectories: false,
      filter: (node) => node.type === "file",
    })) as FileNode[];

    const contents = new Map<string, string>();
    for (const node of fileNodes) {
      try {
        contents.set(node.relativePath, await this.access.readFile(node.absolutePath));
      } catch {
        // Skip unreadable files.
      }
    }
    return contents;
  }

  private commit(
    changedContents: ReadonlyMap<string, string>,
    changedPaths: ReadonlySet<string>,
    _options?: { reindexed?: string[] }
  ): RepositoryIndex {
    for (const [path, content] of changedContents) {
      this.contents.set(path, content);
      const parsed = parseFile(path, content);
      if (parsed) {
        this.parsedCache.set(path, parsed);
      } else {
        this.parsedCache.delete(path);
      }
    }

    this.changedSinceRefresh = new Set(changedPaths);

    const parsedFiles: ParsedFile[] = Array.from(this.parsedCache.values());
    const symbolGraph = buildSymbolGraph(parsedFiles);
    const knowledgeGraph = buildKnowledgeFromSymbolGraph(symbolGraph, parsedFiles);
    this.cache.recordGraphDigest(Array.from(this.contents.values()));

    const sourceFiles = new Map<string, SourceFile>();
    for (const [path, content] of this.contents) {
      sourceFiles.set(path, {
        path,
        content,
        language: languageOf(path),
        isParsed: this.parsedCache.has(path),
      });
    }

    const symbols = new Map<string, SymbolNode>();
    for (const node of symbolGraph.nodes.values()) {
      symbols.set(symbolIdToKey(node.id), node);
    }

    this._index = {
      files: sourceFiles,
      parsed: new Map(this.parsedCache),
      symbols,
      symbolGraph,
      knowledgeGraph,
      fingerprints: this.fingerprintAll(this.contents),
      changedSinceRefresh: new Set(this.changedSinceRefresh),
      indexedAt: new Date().toISOString(),
    };

    return this._index;
  }
}