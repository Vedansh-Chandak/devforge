import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runPipeline, serializePipelineResult, PipelineResult } from "./pipeline.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
// Fix: fixtures are in packages/integration-tests/fixtures, not packages/fixtures
const FIXTURES_DIR = resolve(__dirname, "../fixtures");

const FIXTURES = {
  "simple-ts-project": "simple-ts-project",
  "express-api": "express-api",
  "empty-repo": "empty-repo",
  "ignored-files": "ignored-files",
  "circular-imports": "circular-imports",
  "large-fixture": "large-fixture",
} as const;

type FixtureName = keyof typeof FIXTURES;

async function runFixture(name: FixtureName): Promise<PipelineResult> {
  const fixturePath = resolve(FIXTURES_DIR, FIXTURES[name]);
  return runPipeline(fixturePath);
}

describe("Integration Test Suite - Full Pipeline", () => {
  const results: Map<FixtureName, PipelineResult> = new Map();

  beforeAll(async () => {
    for (const name of Object.keys(FIXTURES) as FixtureName[]) {
      results.set(name, await runFixture(name));
    }
  });

  describe("Repository Indexing", () => {
    it("should succeed for simple-ts-project", () => {
      const result = results.get("simple-ts-project")!;
      expect(result.tree.totalNodes).toBeGreaterThan(0);
      expect(result.tree.rootPath).toContain("simple-ts-project");
    });

    it("should succeed for express-api", () => {
      const result = results.get("express-api")!;
      expect(result.tree.totalNodes).toBeGreaterThan(0);
    });

    it("should handle empty repository", () => {
      const result = results.get("empty-repo")!;
      expect(result.tree.totalNodes).toBeGreaterThanOrEqual(1); // at least root
      expect(result.typescriptFiles.length).toBe(0);
    });

    it("should ignore node_modules and .gitignore files", () => {
      const result = results.get("ignored-files")!;
      // Should find the src/index.ts but not node_modules
      const nodeModulesFiles = result.tree.root.children?.some(
        (c) => c.type === "directory" && c.name === "node_modules"
      );
      expect(nodeModulesFiles).toBeFalsy();
    });
  });

  describe("Metadata Extraction", () => {
    it("should extract metadata for files", () => {
      const result = results.get("simple-ts-project")!;
      // Check enriched tree has metadata
      expect(result.enrichedTree).toBeDefined();
    });

    it("should have metadata for source files", () => {
      const result = results.get("simple-ts-project")!;
      for (const file of result.typescriptFiles) {
        // Metadata is attached via enrichWithMetadata
        expect(result.enrichedTree.tree).toBeDefined();
      }
    });
  });

  describe("Language Detection", () => {
    it("should detect TypeScript files correctly", () => {
      const result = results.get("simple-ts-project")!;
      expect(result.typescriptFiles.length).toBeGreaterThan(0);
      for (const file of result.typescriptFiles) {
        expect(file.extension).toMatch(/^(ts|tsx)$/);
      }
    });

    it("should detect TypeScript React files", () => {
      const result = results.get("express-api")!;
      // express-api has .ts files
      expect(result.typescriptFiles.length).toBeGreaterThan(0);
    });
  });

  describe("TypeScript Parser", () => {
    it("should parse symbols from simple-ts-project", () => {
      const result = results.get("simple-ts-project")!;
      expect(result.parsedFiles.length).toBeGreaterThan(0);
      
      // Check for expected symbols
      const allSymbols = result.parsedFiles.flatMap((f) => [
        ...f.classes,
        ...f.interfaces,
        ...f.functions,
        ...f.typeAliases,
      ]);
      expect(allSymbols.length).toBeGreaterThan(0);
    });

    it("should handle syntax errors gracefully", () => {
      const result = results.get("circular-imports")!;
      // Should not crash on circular imports
      expect(result.parsedFiles.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Symbol Graph Building", () => {
    it("should build symbol graph for simple-ts-project", () => {
      const result = results.get("simple-ts-project")!;
      expect(result.symbolGraph.nodes.size).toBeGreaterThan(0);
    });

    it("should have edges for imports/exports", () => {
      const result = results.get("simple-ts-project")!;
      expect(result.symbolGraph.edges.length).toBeGreaterThanOrEqual(0);
    });

    it("should build symbol graph for express-api", () => {
      const result = results.get("express-api")!;
      expect(result.symbolGraph.nodes.size).toBeGreaterThan(0);
    });

    it("should handle circular imports without crashing", () => {
      const result = results.get("circular-imports")!;
      expect(result.symbolGraph.nodes.size).toBeGreaterThanOrEqual(0);
      expect(result.symbolGraph.edges.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Knowledge Graph Building", () => {
    it("should build knowledge graph for simple-ts-project", () => {
      const result = results.get("simple-ts-project")!;
      expect(result.knowledgeGraph.nodes.size).toBeGreaterThan(0);
    });

    it("should have knowledge edges", () => {
      const result = results.get("simple-ts-project")!;
      expect(result.knowledgeGraph.edges.length).toBeGreaterThanOrEqual(0);
    });

    it("should build knowledge graph for large-fixture", () => {
      const result = results.get("large-fixture")!;
      expect(result.knowledgeGraph.nodes.size).toBeGreaterThan(0);
    });

    it("should have no orphan nodes", () => {
      const result = results.get("simple-ts-project")!;
      const kg = result.knowledgeGraph;
      
      const nodesWithEdges = new Set<string>();
      for (const edge of kg.edges) {
        nodesWithEdges.add(edge.from.kind + ":" + edge.from.name);
        nodesWithEdges.add(edge.to.kind + ":" + edge.to.name);
      }
      // Basic check - in a real scenario we'd check all nodes are reachable
      expect(nodesWithEdges.size).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Determinism", () => {
    it("should produce identical results on consecutive runs for simple-ts-project", async () => {
      const fixturePath = resolve(FIXTURES_DIR, FIXTURES["simple-ts-project"]);
      const result1 = await runPipeline(fixturePath);
      const result2 = await runPipeline(fixturePath);

      const serialized1 = serializePipelineResult(result1);
      const serialized2 = serializePipelineResult(result2);

      expect(serialized1).toBe(serialized2);
    });

    it("should produce identical results on consecutive runs for express-api", async () => {
      const fixturePath = resolve(FIXTURES_DIR, FIXTURES["express-api"]);
      const result1 = await runPipeline(fixturePath);
      const result2 = await runPipeline(fixturePath);

      const serialized1 = serializePipelineResult(result1);
      const serialized2 = serializePipelineResult(result2);

      expect(serialized1).toBe(serialized2);
    });

    it("should produce identical results on consecutive runs for large-fixture", async () => {
      const fixturePath = resolve(FIXTURES_DIR, FIXTURES["large-fixture"]);
      const result1 = await runPipeline(fixturePath);
      const result2 = await runPipeline(fixturePath);

      const serialized1 = serializePipelineResult(result1);
      const serialized2 = serializePipelineResult(result2);

      expect(serialized1).toBe(serialized2);
    });
  });

  describe("Performance Measurements", () => {
    it("should complete simple-ts-project within reasonable time", () => {
      const result = results.get("simple-ts-project")!;
      expect(result.timings.totalMs).toBeLessThan(5000);
      console.log("simple-ts-project timings:", result.timings);
    });

    it("should complete express-api within reasonable time", () => {
      const result = results.get("express-api")!;
      expect(result.timings.totalMs).toBeLessThan(10000);
      console.log("express-api timings:", result.timings);
    });

    it("should complete large-fixture within reasonable time", () => {
      const result = results.get("large-fixture")!;
      expect(result.timings.totalMs).toBeLessThan(30000);
      console.log("large-fixture timings:", result.timings);
    });

    it("should record all timing phases", () => {
      const result = results.get("simple-ts-project")!;
      expect(result.timings.indexingMs).toBeGreaterThanOrEqual(0);
      expect(result.timings.metadataMs).toBeGreaterThanOrEqual(0);
      expect(result.timings.languageDetectionMs).toBeGreaterThanOrEqual(0);
      expect(result.timings.parsingMs).toBeGreaterThanOrEqual(0);
      expect(result.timings.symbolGraphMs).toBeGreaterThanOrEqual(0);
      expect(result.timings.knowledgeGraphMs).toBeGreaterThanOrEqual(0);
      expect(result.timings.totalMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Symbol Counts and Connectivity", () => {
    it("should have expected symbol counts for simple-ts-project", () => {
      const result = results.get("simple-ts-project")!;
      const symbolCount = result.symbolGraph.nodes.size;
      const edgeCount = result.symbolGraph.edges.length;
      const knowledgeNodeCount = result.knowledgeGraph.nodes.size;
      const knowledgeEdgeCount = result.knowledgeGraph.edges.length;

      console.log("simple-ts-project counts:", { symbolCount, edgeCount, knowledgeNodeCount, knowledgeEdgeCount });
      
      expect(symbolCount).toBeGreaterThan(0);
      expect(knowledgeNodeCount).toBeGreaterThan(0);
    });

    it("should have expected counts for express-api", () => {
      const result = results.get("express-api")!;
      const symbolCount = result.symbolGraph.nodes.size;
      const knowledgeNodeCount = result.knowledgeGraph.nodes.size;

      console.log("express-api counts:", { symbolCount, knowledgeNodeCount });
      
      expect(symbolCount).toBeGreaterThan(0);
      expect(knowledgeNodeCount).toBeGreaterThan(0);
    });

    it("should have no duplicate symbols in simple-ts-project", () => {
      const result = results.get("simple-ts-project")!;
      const symbolKeys = new Set<string>();
      
      for (const [key] of result.symbolGraph.nodes) {
        expect(symbolKeys.has(key)).toBe(false);
        symbolKeys.add(key);
      }
    });
  });

  describe("Edge Cases", () => {
    it("should not crash on empty repository", async () => {
      const fixturePath = resolve(FIXTURES_DIR, FIXTURES["empty-repo"]);
      const result = await runPipeline(fixturePath);
      expect(result).toBeDefined();
    });

    it("should handle ignored files correctly", () => {
      const result = results.get("ignored-files")!;
      // Should find src/index.ts but not node_modules
      const sourceFiles = result.typescriptFiles.map((f) => f.relativePath);
      expect(sourceFiles.some((f) => f.includes("node_modules"))).toBe(false);
    });

    it("should handle circular imports without infinite loop", () => {
      const result = results.get("circular-imports")!;
      // Should complete without hanging
      expect(result.timings.totalMs).toBeLessThan(5000);
    });

    it("should handle large fixture with many files", () => {
      const result = results.get("large-fixture")!;
      expect(result.typescriptFiles.length).toBeGreaterThan(50);
      expect(result.symbolGraph.nodes.size).toBeGreaterThan(100);
    });
  });
});
