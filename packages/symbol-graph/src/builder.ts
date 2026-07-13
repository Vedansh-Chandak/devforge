import type {
  ParsedFile,
  SymbolGraph,
  SymbolNode,
} from "./types.js";
import { createSymbolGraph, addNode, addEdge } from "./graph.js";
import { resolveLocalSymbols } from "./resolver.js";
import { linkSymbols, setAllParsedFiles } from "./linker.js";

interface FileSymbols {
  symbols: SymbolNode[];
  symbolMap: Map<string, SymbolNode>;
}

export function buildSymbolGraph(parsedFiles: ParsedFile[]): SymbolGraph {
  const graph = createSymbolGraph();
  const fileSymbolsMap = new Map<string, FileSymbols>();

  setAllParsedFiles(parsedFiles);

  for (const parsedFile of parsedFiles) {
    const localSymbols = resolveLocalSymbols(parsedFile);
    const symbolMap = new Map<string, SymbolNode>();
    
    for (const symbol of localSymbols) {
      addNode(graph, symbol);
      symbolMap.set(symbol.name, symbol);
    }

    fileSymbolsMap.set(parsedFile.filePath, {
      symbols: localSymbols,
      symbolMap,
    });
  }

  const edges = linkSymbols(parsedFiles, fileSymbolsMap);
  for (const edge of edges) {
    addEdge(graph, edge);
  }

  return graph;
}