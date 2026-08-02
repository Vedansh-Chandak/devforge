import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { scanRepository, RepositoryScanError } from "../index.js";
import type { RepositoryTree, FileNode, DirectoryNode } from "../index.js";

describe("scanRepository", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "df-indexer-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  const createFixture = async (structure: Record<string, string | Record<string, unknown>>, base = tempRoot) => {
    for (const [name, content] of Object.entries(structure)) {
      const path = join(base, name);
      if (typeof content === "string") {
        await writeFile(path, content);
      } else {
        await mkdir(path, { recursive: true });
        await createFixture(content as Record<string, string | Record<string, unknown>>, path);
      }
    }
  };

  describe("basic traversal", () => {
    it("returns root directory with empty children for empty dir", async () => {
      const tree = await scanRepository(tempRoot);

      expect(tree.root.type).toBe("directory");
      expect(tree.root.children).toHaveLength(0);
      expect(tree.totalNodes).toBe(1);
    });

    it("recursively builds nested directories with lexicographic ordering", async () => {
      await createFixture({
        "dir2": { "file-b.txt": "b" },
        "dir1": { "file-a.txt": "a", "subdir": { "nested.txt": "n" } },
        "root-file.txt": "root",
      });

      const tree = await scanRepository(tempRoot);

      const rootChildren = tree.root.children.map((n) => n.name);
      expect(rootChildren).toEqual(["dir1", "dir2", "root-file.txt"]);

      const dir1 = tree.root.children.find((n) => n.name === "dir1") as DirectoryNode;
      expect(dir1.children.map((n) => n.name)).toEqual(["file-a.txt", "subdir"]);
    });

    it("represents mixed files and folders correctly", async () => {
      await createFixture({
        "src": { "index.ts": "export {}", "lib": { "util.ts": "export {}" } },
        "tests": { "test.ts": "test" },
        "README.md": "# Readme",
        "package.json": "{}",
      });

      const tree = await scanRepository(tempRoot);

      expect(tree.root.children).toHaveLength(4);
      const src = tree.root.children.find((n) => n.name === "src") as DirectoryNode;
      expect(src.children).toHaveLength(2);
      expect(src.children[0].type).toBe("file");
      expect(src.children[1].type).toBe("directory");
    });
  });

  describe("error handling", () => {
    it("throws NOT_FOUND for non-existent path", async () => {
      await expect(scanRepository("/absolutely/nonexistent/path/xyz"))
        .rejects.toThrow(RepositoryScanError);
      await expect(scanRepository("/absolutely/nonexistent/path/xyz"))
        .rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("throws NOT_A_DIRECTORY when root is a file", async () => {
      const file = join(tempRoot, "file.txt");
      await writeFile(file, "content");

      await expect(scanRepository(file))
        .rejects.toMatchObject({ code: "NOT_A_DIRECTORY" });
    });

    it("throws INVALID_ROOT when root is a symlink", async () => {
      const target = join(tempRoot, "real-dir");
      await mkdir(target);
      const link = join(tempRoot, "link-dir");
      await symlink(target, link, "dir");

      await expect(scanRepository(link))
        .rejects.toMatchObject({ code: "INVALID_ROOT" });
    });
  });

  describe("symlink handling inside tree", () => {
    it("skips broken symlinks", async () => {
      await createFixture({
        "target-dir": { "real.txt": "content" },
      });
      await symlink("/nonexistent/target", join(tempRoot, "broken-link"));

      const tree = await scanRepository(tempRoot);

      const names = tree.root.children.map((n) => n.name);
      expect(names).not.toContain("broken-link");
      expect(names).toContain("target-dir");
    });

    it("skips symlinks to files", async () => {
      await createFixture({
        "real.txt": "content",
      });
      await symlink(join(tempRoot, "real.txt"), join(tempRoot, "link-to-file.txt"));

      const tree = await scanRepository(tempRoot);

      // symlink skipped, only real file remains
      expect(tree.root.children.map((n) => n.name)).toEqual(["real.txt"]);
      expect(tree.root.children).toHaveLength(1);
    });

    it("skips symlinks to directories", async () => {
      await createFixture({
        "real-dir": { "nested.txt": "content" },
      });
      await symlink(join(tempRoot, "real-dir"), join(tempRoot, "link-to-dir"), "dir");

      const tree = await scanRepository(tempRoot);

      // Only real-dir should appear, not the symlink
      expect(tree.root.children).toHaveLength(1);
      expect(tree.root.children[0].name).toBe("real-dir");
    });
  });

  describe("file extensions", () => {
    beforeEach(async () => {
      await createFixture({
        "noextension": "data",
        "simple.txt": "data",
        "multi.part.ts": "data",
        ".env": "SECRET=1",
        ".gitignore": "node_modules",
        "README.md": "# Readme",
      });
    });

    it("file without extension has empty string extension", async () => {
      const tree = await scanRepository(tempRoot);
      const file = tree.root.children.find((n) => n.name === "noextension") as FileNode;
      expect(file.extension).toBe("");
    });

    it("file with simple extension", async () => {
      const tree = await scanRepository(tempRoot);
      const file = tree.root.children.find((n) => n.name === "simple.txt") as FileNode;
      expect(file.extension).toBe("txt");
    });

    it("file with multiple dots uses last segment", async () => {
      const tree = await scanRepository(tempRoot);
      const file = tree.root.children.find((n) => n.name === "multi.part.ts") as FileNode;
      expect(file.extension).toBe("ts");
    });

    it("dotfile (.env) has empty extension", async () => {
      const tree = await scanRepository(tempRoot);
      const file = tree.root.children.find((n) => n.name === ".env") as FileNode;
      expect(file.extension).toBe("");
    });

    it("dotfile (.gitignore) has empty extension", async () => {
      const tree = await scanRepository(tempRoot);
      const file = tree.root.children.find((n) => n.name === ".gitignore") as FileNode;
      expect(file.extension).toBe("");
    });
  });

  describe("large directory performance", () => {
    it("traverses 500 files successfully", async () => {
      const files = Object.fromEntries(
        Array.from({ length: 500 }, (_, i) => [`file${i.toString().padStart(4, "0")}.txt`, `content ${i}`])
      );
      await createFixture(files);

      const tree = await scanRepository(tempRoot);

      expect(tree.root.children).toHaveLength(500);
      expect(tree.totalNodes).toBe(501); // root + 500 files
    });
  });

  describe("deterministic ordering", () => {
    it("sorts children lexicographically case-sensitive", async () => {
      await createFixture({
        "a.txt": "a",
        "B.txt": "B",
        "a1.txt": "a1",
        "aa.txt": "aa",
        "Ab.txt": "Ab",
      });

      const tree = await scanRepository(tempRoot);
      const names = tree.root.children.map((n) => n.name);

      // Case-sensitive: uppercase before lowercase
      expect(names).toEqual(["Ab.txt", "B.txt", "a.txt", "a1.txt", "aa.txt"]);
    });
  });

  describe("RepositoryTree metadata", () => {
    it("scannedAt is valid ISO timestamp", async () => {
      await writeFile(join(tempRoot, "file.txt"), "content");
      const tree = await scanRepository(tempRoot);

      const date = new Date(tree.scannedAt);
      expect(date.toISOString()).toBe(tree.scannedAt);
      expect(date.getTime()).not.toBeNaN();
    });

    it("rootPath matches input exactly", async () => {
      const tree = await scanRepository(tempRoot);
      expect(tree.rootPath).toBe(tempRoot);
    });
  });
});
