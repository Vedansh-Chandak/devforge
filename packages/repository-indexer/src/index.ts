export type {
  NodeType,
  FileNode,
  DirectoryNode,
  RepositoryNode,
  RepositoryTree,
  ScanOptions,
  ScanError,
  ScanErrorCode,
  ScanResult,
} from "./types.js";

export { scanRepository } from "./indexer.js";

export {
  createIgnoreMatcher,
  shouldIgnore,
  type IgnoreMatcher,
  type IgnoreOptions,
} from "./ignore.js";

export {
  type FileMetadata,
  type StatLike,
  type BuildMetadataInput,
  type MetadataErrorCode,
  MetadataError,
  buildFileMetadata,
  getFileMetadata,
} from "./metadata.js";

export {
  createLanguageDetector,
  detectLanguage,
  type Language,
  type LanguageDetector,
  type LanguageDetectorOptions,
  type LanguageRule,
} from "./language-detector.js";
