import { readFile } from "node:fs/promises";
import { join, relative, resolve as resolvePath } from "node:path";

import {
  scanRepository,
  enrichWithMetadata,
  detectLanguage,
  collectTree,
  FileNode,
  EnrichedTree,
} from "@devforge/repository-indexer";
import { parseTypeScript, ParseResult } from "@devforge/parser-typescript";
import { buildSymbolGraph, SymbolGraph, ParsedFile } from "@devforge/symbol-graph";
import { buildKnowledgeGraph, KnowledgeGraph } from "@devforge/knowledge-graph";

export interface PipelineResult {
  tree: Awaited<ReturnType<typeof scanRepository>>;
  enrichedTree: EnrichedTree;
  typescriptFiles: FileNode[];
  parsedFiles: ParsedFile[];
  symbolGraph: SymbolGraph;
  knowledgeGraph: KnowledgeGraph;
  timings: {
    indexingMs: number;
    metadataMs: number;
    languageDetectionMs: number;
    parsingMs: number;
    symbolGraphMs: number;
    knowledgeGraphMs: number;
    totalMs: number;
  };
}

export async function runPipeline(rootPath: string): Promise<PipelineResult> {
  const timings: PipelineResult["timings"] = {
    indexingMs: 0,
    metadataMs: 0,
    languageDetectionMs: 0,
    parsingMs: 0,
    symbolGraphMs: 0,
    knowledgeGraphMs: 0,
    totalMs: 0,
  };

  const totalStart = Date.now();

  // Step 1: Repository Indexing
  const indexingStart = Date.now();
  const tree = await scanRepository(rootPath);
  timings.indexingMs = Date.now() - indexingStart;

  // Step 2: Metadata Enrichment
  const metadataStart = Date.now();
  const enrichedTree = await enrichWithMetadata(tree);
  timings.metadataMs = Date.now() - metadataStart;

  // Step 3: Language Detection + Collect TypeScript files
  const languageStart = Date.now();
  const allNodes = await collectTree(tree, { includeDirectories: false });
  const fileNodes = allNodes.filter((n): n is FileNode => n.type === "file");
  
  const typescriptFiles = fileNodes.filter(
    (f) => detectLanguage(f) === "typescript" || detectLanguage(f) === "typescript-react"
  );
  timings.languageDetectionMs = Date.now() - languageStart;

  // Step 4: TypeScript Parsing
  const parsingStart = Date.now();
  const parsedFiles: ParsedFile[] = [];
  
  for (const file of typescriptFiles) {
    const code = await readFile(file.absolutePath, "utf-8");
    const parseResult: ParseResult = parseTypeScript(code, file.relativePath);
    
    // Convert ParseResult to ParsedFile by adding filePath
    const parsedFile: ParsedFile = {
      filePath: file.relativePath,
      imports: parseResult.imports,
      exports: parseResult.exports,
      classes: parseResult.classes,
      interfaces: parseResult.interfaces,
      enums: parseResult.enums,
      functions: parseResult.functions,
      typeAliases: parseResult.typeAliases,
      syntaxErrors: parseResult.syntaxErrors,
    };
    parsedFiles.push(parsedFile);
  }
  timings.parsingMs = Date.now() - parsingStart;

  // Step 5: Symbol Graph Building
  const symbolGraphStart = Date.now();
  const symbolGraph = buildSymbolGraph(parsedFiles);
  timings.symbolGraphMs = Date.now() - symbolGraphStart;

  // Step 6: Knowledge Graph Building
  const knowledgeGraphStart = Date.now();
  const knowledgeGraph = buildKnowledgeGraph(symbolGraph, parsedFiles);
  timings.knowledgeGraphMs = Date.now() - knowledgeGraphStart;

  timings.totalMs = Date.now() - totalStart;

  return {
    tree,
    enrichedTree,
    typescriptFiles,
    parsedFiles,
    symbolGraph,
    knowledgeGraph,
    timings,
  };
}

export function serializePipelineResult(result: PipelineResult): string {
  return JSON.stringify({
    // Exclude timings and timestamps for deterministic comparison
    tree: {
      rootPath: result.tree.rootPath,
      totalNodes: result.tree.totalNodes,
      root: serializeNode(result.tree.root),
    },
    typescriptFileCount: result.typescriptFiles.length,
    symbolCount: result.symbolGraph.nodes.size,
    edgeCount: result.symbolGraph.edges.length,
    knowledgeNodeCount: result.knowledgeGraph.nodes.size,
    knowledgeEdgeCount: result.knowledgeGraph.edges.length,
  }, null, 2);
}

function serializeNode(node: any): any {
  if (!node || typeof node !== "object") return node;
  if (node.type === "file") {
    return {
      type: "file",
      name: node.name,
      relativePath: node.relativePath,
      extension: node.extension,
      size: node.size,
    };
  }
  if (node.type === "directory") {
    return {
      type: "directory",
      name: node.name,
      relativePath: node.relativePath,
      children: node.children.map(serializeNode),
    };
  }
  return node;
}
