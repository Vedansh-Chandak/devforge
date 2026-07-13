export type {
  NodeType,
  FileNode,
  DirectoryNode,
  RepositoryNode,
  RepositoryTree,
  ScanErrorCode,
  FileMetadata,
  DirectoryMetadata,
  NodeMetadata,
  EnrichedTree,
  MetadataErrorCode,
  Language,
} from "./types.js";

export { RepositoryScanError, MetadataEnrichmentError } from "./types.js";

export { scanRepository } from "./indexer.js";

export {
  enrichWithMetadata,
  getMetadata,
  hasMetadata,
  getAllMetadata,
} from "./metadata.js";

export { detectLanguage, getExtensionsForLanguage, isLanguage } from "./language.js";

export {
  filterFiles,
  filterDirectories,
  filterByExtension,
  pruneIgnoredDirs,
} from "./filters.js";

export { traverseTree, collectTree, countTree } from "./traverse.js";
