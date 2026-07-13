import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

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

export interface BenchmarkResult {
  fixture: string;
  fileCount: number;
  typescriptFileCount: number;
  timings: {
    indexingMs: number;
    metadataMs: number;
    languageDetectionMs: number;
    parsingMs: number;
    symbolGraphMs: number;
    knowledgeGraphMs: number;
    totalMs: number;
  };
  counts: {
    symbolCount: number;
    symbolEdgeCount: number;
    knowledgeNodeCount: number;
    knowledgeEdgeCount: number;
  };
  memory: {
    heapUsedMB: number;
    heapTotalMB: number;
    externalMB: number;
  };
}

function getMemoryMB() {
  const mem = process.memoryUsage();
  return {
    heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100,
    heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100,
    externalMB: Math.round(mem.external / 1024 / 1024 * 100) / 100,
  };
}

function forceGC() {
  if (global.gc) {
    global.gc();
  }
}

export async function runBenchmark(fixturePath: string, fixtureName: string): Promise<BenchmarkResult> {
  forceGC();
  const memBefore = getMemoryMB();

  const timings: BenchmarkResult["timings"] = {
    indexingMs: 0,
    metadataMs: 0,
    languageDetectionMs: 0,
    parsingMs: 0,
    symbolGraphMs: 0,
    knowledgeGraphMs: 0,
    totalMs: 0,
  };

  const totalStart = Date.now();

  // Stage 1: Repository Indexing
  const indexingStart = Date.now();
  const tree = await scanRepository(fixturePath);
  timings.indexingMs = Date.now() - indexingStart;

  // Stage 2: Metadata Enrichment
  const metadataStart = Date.now();
  const enrichedTree = await enrichWithMetadata(tree);
  timings.metadataMs = Date.now() - metadataStart;

  // Stage 3: Language Detection + Collect TypeScript files
  const languageStart = Date.now();
  const allNodes = await collectTree(tree, { includeDirectories: false });
  const fileNodes = allNodes.filter((n): n is FileNode => n.type === "file");
  
  const typescriptFiles = fileNodes.filter(
    (f) => detectLanguage(f) === "typescript" || detectLanguage(f) === "typescript-react"
  );
  timings.languageDetectionMs = Date.now() - languageStart;

  // Stage 4: TypeScript Parsing
  const parsingStart = Date.now();
  const parsedFiles: ParsedFile[] = [];
  
  for (const file of typescriptFiles) {
    const code = await readFile(file.absolutePath, "utf-8");
    const parseResult: ParseResult = parseTypeScript(code, file.relativePath);
    
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

  // Stage 5: Symbol Graph Building
  const symbolGraphStart = Date.now();
  const symbolGraph = buildSymbolGraph(parsedFiles);
  timings.symbolGraphMs = Date.now() - symbolGraphStart;

  // Stage 6: Knowledge Graph Building
  const knowledgeGraphStart = Date.now();
  const knowledgeGraph = buildKnowledgeGraph(symbolGraph, parsedFiles);
  timings.knowledgeGraphMs = Date.now() - knowledgeGraphStart;

  timings.totalMs = Date.now() - totalStart;

  // Final memory measurement
  forceGC();
  const memAfter = getMemoryMB();
  
  return {
    fixture: fixtureName,
    fileCount: fileNodes.length,
    typescriptFileCount: typescriptFiles.length,
    timings,
    counts: {
      symbolCount: symbolGraph.nodes.size,
      symbolEdgeCount: symbolGraph.edges.length,
      knowledgeNodeCount: knowledgeGraph.nodes.size,
      knowledgeEdgeCount: knowledgeGraph.edges.length,
    },
    memory: {
      heapUsedMB: memAfter.heapUsedMB,
      heapTotalMB: memAfter.heapTotalMB,
      externalMB: memAfter.externalMB,
    },
  };
}

export function formatResult(result: BenchmarkResult): string {
  return `
╔═══════════════════════════════════════════════════════════════════════════════╗
║  Benchmark: ${result.fixture.padEnd(60)} ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  Files: ${String(result.fileCount).padEnd(5)}  TS Files: ${String(result.typescriptFileCount).padEnd(5)}  Parsed: ${String(result.counts.symbolCount).padEnd(5)} ║
║  Symbols: ${String(result.counts.symbolCount).padEnd(5)}  Sym Edges: ${String(result.counts.symbolEdgeCount).padEnd(5)}  KG Nodes: ${String(result.counts.knowledgeNodeCount).padEnd(5)}  KG Edges: ${String(result.counts.knowledgeEdgeCount).padEnd(5)} ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  Indexing:       ${String(result.timings.indexingMs).padStart(6)} ms  ║
║  Metadata:       ${String(result.timings.metadataMs).padStart(6)} ms  ║
║  Lang Detection: ${String(result.timings.languageDetectionMs).padStart(6)} ms  ║
║  Parsing:        ${String(result.timings.parsingMs).padStart(6)} ms  ║
║  Symbol Graph:   ${String(result.timings.symbolGraphMs).padStart(6)} ms  ║
║  Knowledge Graph:${String(result.timings.knowledgeGraphMs).padStart(6)} ms  ║
║  ────────────────────────────────────────────────────────────────────────── ║
║  TOTAL:          ${String(result.timings.totalMs).padStart(6)} ms  ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  Heap Used: ${String(result.memory.heapUsedMB).padStart(8)} MB  Heap Total: ${String(result.memory.heapTotalMB).padStart(8)} MB  ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`;
}

export async function runMultipleBenchmarks(
  fixturePath: string, 
  fixtureName: string, 
  runs: number = 3
): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];
  
  for (let i = 0; i < runs; i++) {
    const result = await runBenchmark(fixturePath, fixtureName);
    results.push(result);
    
    // Small delay between runs
    if (i < runs - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return results;
}

export function calculateMedian(results: BenchmarkResult[]): BenchmarkResult {
  if (results.length === 0) {
    throw new Error("Cannot calculate median of empty array");
  }
  const sorted = [...results].sort((a, b) => a.timings.totalMs - b.timings.totalMs);
  const index = Math.floor(sorted.length / 2);
  return sorted[index]!;
}

export function calculateStats(results: BenchmarkResult[]) {
  const totalTimes = results.map(r => r.timings.totalMs).sort((a, b) => a - b);
  const min = totalTimes[0];
  const max = totalTimes[totalTimes.length - 1];
  const median = totalTimes[Math.floor(totalTimes.length / 2)];
  const mean = totalTimes.reduce((a, b) => a + b, 0) / totalTimes.length;
  const variance = totalTimes.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / totalTimes.length;
  const stdDev = Math.sqrt(variance);
  
  return { min, max, median, mean, stdDev };
}
