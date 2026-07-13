import { lstat } from "node:fs/promises";
import type { BigIntStats, Stats } from "node:fs";

import type {
  RepositoryTree,
  RepositoryNode,
  DirectoryNode,
  FileMetadata,
  DirectoryMetadata,
  NodeMetadata,
  EnrichedTree,
} from "./types.js";
import { MetadataEnrichmentError } from "./types.js";

const METADATA_MAP_SYMBOL = Symbol.for("@devforge/repository-indexer/metadata-map");

interface MetadataMap {
  get(path: string): NodeMetadata | undefined;
  set(path: string, metadata: NodeMetadata): void;
  has(path: string): boolean;
  keys(): IterableIterator<string>;
  values(): IterableIterator<NodeMetadata>;
  entries(): IterableIterator<[string, NodeMetadata]>;
  [Symbol.iterator](): IterableIterator<[string, NodeMetadata]>;
}

class InternalMetadataMap implements MetadataMap {
  private readonly map = new Map<string, NodeMetadata>();

  get(path: string): NodeMetadata | undefined {
    return this.map.get(path);
  }

  set(path: string, metadata: NodeMetadata): void {
    this.map.set(path, metadata);
  }

  has(path: string): boolean {
    return this.map.has(path);
  }

  keys(): IterableIterator<string> {
    return this.map.keys();
  }

  values(): IterableIterator<NodeMetadata> {
    return this.map.values();
  }

  entries(): IterableIterator<[string, NodeMetadata]> {
    return this.map.entries();
  }

  [Symbol.iterator](): IterableIterator<[string, NodeMetadata]> {
    return this.map.entries();
  }
}

function asErrno(err: unknown): NodeJS.ErrnoException {
  if (err instanceof Error) {
    return err as NodeJS.ErrnoException;
  }
  return new Error(String(err)) as NodeJS.ErrnoException;
}

function extractMetadata(stat: BigIntStats | Stats): NodeMetadata {
  const mtimeMs = typeof stat.mtimeMs === "bigint" 
    ? Number(stat.mtimeMs) 
    : stat.mtimeMs;
  
  const mode = typeof stat.mode === "bigint"
    ? Number(stat.mode)
    : stat.mode;

  const inode = typeof stat.ino === "bigint"
    ? Number(stat.ino)
    : stat.ino;

  return {
    mtimeMs,
    mode,
    ...(inode !== undefined ? { inode } : {}),
  };
}

async function collectMetadata(
  node: RepositoryNode,
  metadataMap: MetadataMap,
): Promise<void> {
  let stat: BigIntStats | Stats;
  try {
    stat = await lstat(node.absolutePath, { bigint: true });
  } catch {
    return;
  }

  const metadata: NodeMetadata = extractMetadata(stat);
  metadataMap.set(node.absolutePath, metadata);

  if (node.type === "directory") {
    for (const child of node.children) {
      await collectMetadata(child, metadataMap);
    }
  }
}

const enrichedTrees = new WeakMap<object, MetadataMap>();

/**
 * Enrich a RepositoryTree with filesystem metadata.
 *
 * Performs a single pass over all nodes, collecting mtime, mode,
 * and inode (where available). Errors on individual nodes are
 * silently skipped; enrichment continues for remaining nodes.
 *
 * @param tree - The repository tree from scanRepository()
 * @returns An EnrichedTree with attached metadata
 *
 * @throws {MetadataEnrichmentError} Only on catastrophic failures
 *   (e.g., tree root no longer exists). Individual node errors
 *   do not throw.
 */
export async function enrichWithMetadata(tree: RepositoryTree): Promise<EnrichedTree> {
  const metadataMap: MetadataMap = new InternalMetadataMap();

  try {
    await collectMetadata(tree.root, metadataMap);
  } catch (err) {
    const errno = asErrno(err);
    const code = errno.code === "ENOENT" ? "ROOT_NOT_FOUND" : "ROOT_NOT_ACCESSIBLE";
    throw new MetadataEnrichmentError(code, tree.rootPath, `Failed to enrich tree: ${errno.message}`);
  }

  const enriched: EnrichedTree = {
    tree,
    _metadataBrand: Symbol("EnrichedTree"),
  };

  enrichedTrees.set(enriched, metadataMap);

  return enriched;
}

function getMetadataMap(enriched: EnrichedTree): MetadataMap | undefined {
  return enrichedTrees.get(enriched);
}

/**
 * Retrieve metadata for a specific node.
 *
 * @param enriched - The enriched tree
 * @param node - The node to get metadata for (must be from enriched.tree)
 * @returns Metadata if available, undefined if:
 *   - The node was skipped during enrichment (error)
 *   - The node is not from the provided tree
 *
 * @throws {TypeError} If node is not a valid RepositoryNode
 */
export function getMetadata(
  enriched: EnrichedTree,
  node: RepositoryNode,
): FileMetadata | DirectoryMetadata | undefined {
  const metadataMap = getMetadataMap(enriched);
  if (!metadataMap) {
    return undefined;
  }

  if (!node || typeof node !== "object" || !("type" in node)) {
    throw new TypeError("Invalid RepositoryNode");
  }

  return metadataMap.get(node.absolutePath) as FileMetadata | DirectoryMetadata | undefined;
}

/**
 * Check if a node has metadata available.
 *
 * @param enriched - The enriched tree
 * @param node - The node to check
 * @returns true if metadata exists, false otherwise
 */
export function hasMetadata(
  enriched: EnrichedTree,
  node: RepositoryNode,
): boolean {
  const metadataMap = getMetadataMap(enriched);
  if (!metadataMap) {
    return false;
  }

  return metadataMap.has(node.absolutePath);
}

/**
 * Get all metadata entries for iteration.
 *
 * @param enriched - The enriched tree
 * @returns Map of absolute paths to their metadata
 */
export function getAllMetadata(
  enriched: EnrichedTree,
): ReadonlyMap<string, FileMetadata | DirectoryMetadata> {
  const metadataMap = getMetadataMap(enriched);
  if (!metadataMap) {
    return new Map();
  }

  const result = new Map<string, FileMetadata | DirectoryMetadata>();
  for (const [key, value] of metadataMap.entries()) {
    result.set(key, value);
  }
  return result;
}