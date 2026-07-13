import type { RepositoryNode } from "./types.js";

export function filterFiles(node: RepositoryNode): boolean {
  return node.type === "file";
}

export function filterDirectories(node: RepositoryNode): boolean {
  return node.type === "directory";
}

export function filterByExtension(extensions: string[]): (node: RepositoryNode) => boolean {
  const extSet = new Set(extensions);
  return (node) => node.type === "file" && extSet.has(node.extension);
}

export function pruneIgnoredDirs(node: RepositoryNode): boolean {
  if (node.type !== "directory") {
    return false;
  }
  const ignored = [
    "node_modules",
    "dist",
    "build",
    ".next",
    ".git",
    ".turbo",
    ".cache",
    "coverage",
    ".nyc_output",
  ];
  return ignored.includes(node.name);
}