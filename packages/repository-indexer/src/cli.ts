#!/usr/bin/env node

import { scanRepository, RepositoryScanError } from "./index.js";
import type { RepositoryTree, DirectoryNode, FileNode } from "./types.js";

function printTree(node: DirectoryNode | FileNode, indent = 0): void {
  const prefix = "  ".repeat(indent);
  const typeIcon = node.type === "directory" ? "📁" : "📄";
  console.log(`${prefix}${typeIcon} ${node.name}`);
  if (node.type === "directory") {
    for (const child of node.children) {
      printTree(child, indent + 1);
    }
  }
}

function countNodes(tree: RepositoryTree): { directories: number; files: number; ignored: number } {
  let directories = 0;
  let files = 0;

  function count(node: DirectoryNode | FileNode): void {
    if (node.type === "directory") {
      directories++;
      for (const child of node.children) {
        count(child);
      }
    } else {
      files++;
    }
  }

  count(tree.root);
  return { directories, files, ignored: 0 };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const showTree = args.includes("--tree");
  const pathArg = args.find((a) => !a.startsWith("-")) || ".";
  
  const startTime = Date.now();
  
  try {
    const tree = await scanRepository(pathArg);
    const elapsed = Date.now() - startTime;
    const { directories, files } = countNodes(tree);

    console.log(`Repository: ${pathArg}`);
    console.log(`Directories: ${directories}`);
    console.log(`Files: ${files}`);
    console.log(`Ignored: 0`);
    console.log(`Elapsed: ${elapsed} ms`);

    if (showTree) {
      console.log("");
      printTree(tree.root);
    }
  } catch (err) {
    if (err instanceof RepositoryScanError) {
      console.error(`Error [${err.code}]: ${err.message}`);
      process.exitCode = 1;
    } else {
      console.error(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});