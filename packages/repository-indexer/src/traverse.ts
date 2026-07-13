import type {
  RepositoryTree,
  RepositoryNode,
  DirectoryNode,
  FileNode,
} from "./types.js";
import type { TraverseOptions } from "./traverse-types.js";

export async function* traverseTree(
  tree: RepositoryTree,
  options: TraverseOptions = {},
): AsyncGenerator<RepositoryNode, void, unknown> {
  const {
    includeDirectories = true,
    filter = () => true,
    pruneDir = () => false,
  } = options;

  async function* walk(node: RepositoryNode): AsyncGenerator<RepositoryNode> {
    if (filter(node)) {
      yield node;
    }

    if (node.type === "directory") {
      if (pruneDir(node)) {
        return;
      }

      for (const child of node.children) {
        yield* walk(child);
      }
    }
  }

  if (includeDirectories || filter(tree.root)) {
    yield* walk(tree.root);
  } else {
    for (const child of tree.root.children) {
      yield* walk(child);
    }
  }
}

export async function collectTree(
  tree: RepositoryTree,
  options?: TraverseOptions,
): Promise<RepositoryNode[]> {
  const result: RepositoryNode[] = [];
  for await (const node of traverseTree(tree, options)) {
    result.push(node);
  }
  return result;
}

export async function countTree(
  tree: RepositoryTree,
  options?: TraverseOptions,
): Promise<number> {
  let count = 0;
  for await (const _ of traverseTree(tree, options)) {
    count++;
  }
  return count;
}