import type { RepositoryNode, DirectoryNode } from "./types.js";

export interface TraverseOptions {
  includeDirectories?: boolean;
  filter?: (node: RepositoryNode) => boolean;
  pruneDir?: (dir: DirectoryNode) => boolean;
}