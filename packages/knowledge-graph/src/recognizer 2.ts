import type {
  SymbolNode,
  SymbolId,
  SymbolKind,
  SymbolGraph,
  ParsedFile,
} from "@devforge/symbol-graph";
import type {
  KnowledgeNodeKind,
  KnowledgeNodeId,
  KnowledgeNode,
  KnowledgeNodeProperties,
} from "./types.js";

export interface RecognizedNode {
  readonly kind: KnowledgeNodeKind;
  readonly name: string;
  readonly sourceSymbols: ReadonlyArray<SymbolId>;
  readonly properties: KnowledgeNodeProperties;
}

const SERVICE_SUFFIXES = ["Service", "service"] as const;
const REPOSITORY_SUFFIXES = ["Repository", "repository", "Dao", "dao", "DataAccess", "dataAccess"] as const;
const CONTROLLER_SUFFIXES = ["Controller", "controller", "Handler", "handler", "Endpoint", "endpoint", "Router", "router"] as const;
const ENTITY_SUFFIXES = ["Entity", "entity", "Model", "model", "Document", "document", "Schema", "schema"] as const;

const MODULE_DIR_NAMES = ["modules", "module", "features", "feature", "packages", "package", "libs", "lib", "domains", "domain"] as const;
const SERVICE_DIR_NAMES = ["services", "service"] as const;
const REPOSITORY_DIR_NAMES = ["repositories", "repository", "repos", "repo", "dao", "daos", "data"] as const;
const CONTROLLER_DIR_NAMES = ["controllers", "controller", "handlers", "handler", "endpoints", "endpoint", "routes", "route", "api"] as const;
const DATABASE_DIR_NAMES = ["db", "database", "prisma", "orm"] as const;

function hasSuffix(name: string, suffixes: readonly string[]): boolean {
  return suffixes.some((s) => name.endsWith(s));
}

function dirMatches(filePath: string, dirNames: readonly string[]): boolean {
  const parts = filePath.split("/");
  return parts.some((p) => dirNames.includes(p.toLowerCase() as typeof dirNames[number]));
}

export function recognizeModule(symbol: SymbolNode, _parsedFiles: ParsedFile[]): RecognizedNode | null {
  if (symbol.kind !== "namespace" && symbol.kind !== "class" && symbol.kind !== "interface") {
    return null;
  }

  // Check if it's in a module directory AND is the module file (e.g., user.module.ts)
  // Only match if the file is directly in the module directory, not in subdirectories
  const moduleDirMatch = symbol.filePath.match(/\/modules\/([^/]+)\/[^/]+\.module\.(ts|js)$/i) ||
                         symbol.filePath.match(/\/features\/([^/]+)\/[^/]+\.module\.(ts|js)$/i) ||
                         symbol.filePath.match(/\/packages\/([^/]+)\/[^/]+\.module\.(ts|js)$/i) ||
                         symbol.filePath.match(/\/libs\/([^/]+)\/[^/]+\.module\.(ts|js)$/i) ||
                         symbol.filePath.match(/\/domains\/([^/]+)\/[^/]+\.module\.(ts|js)$/i);

  if (moduleDirMatch) {
    const moduleName = moduleDirMatch[1] ?? "unknown";
    return {
      kind: "module",
      name: moduleName,
      sourceSymbols: [symbol.id],
      properties: { filePath: symbol.filePath, exportName: symbol.name },
    };
  }

  // Check if the symbol name ends with "Module" (e.g., UserModule, AppModule)
  // Use directory name if available, otherwise derive from class name
  if (hasSuffix(symbol.name, ["Module", "module"])) {
    const dirMatch = symbol.filePath.match(/\/modules\/([^/]+)\//i) ||
                     symbol.filePath.match(/\/features\/([^/]+)\//i) ||
                     symbol.filePath.match(/\/packages\/([^/]+)\//i) ||
                     symbol.filePath.match(/\/libs\/([^/]+)\//i) ||
                     symbol.filePath.match(/\/domains\/([^/]+)\//i);
    
    const moduleName = (dirMatch?.[1] ?? symbol.name.replace(/Module$/, "").replace(/module$/, "")) || symbol.name;
    
    return {
      kind: "module",
      name: moduleName,
      sourceSymbols: [symbol.id],
      properties: { filePath: symbol.filePath, exportName: symbol.name },
    };
  }

  return null;
}

export function recognizeService(symbol: SymbolNode, _parsedFiles: ParsedFile[]): RecognizedNode | null {
  if (symbol.kind !== "class" && symbol.kind !== "interface") {
    return null;
  }

  if (hasSuffix(symbol.name, SERVICE_SUFFIXES) || dirMatches(symbol.filePath, SERVICE_DIR_NAMES)) {
    return {
      kind: "service",
      name: symbol.name,
      sourceSymbols: [symbol.id],
      properties: { filePath: symbol.filePath, exportName: symbol.name },
    };
  }

  return null;
}

export function recognizeRepository(symbol: SymbolNode, _parsedFiles: ParsedFile[]): RecognizedNode | null {
  if (symbol.kind !== "class" && symbol.kind !== "interface") {
    return null;
  }

  if (hasSuffix(symbol.name, REPOSITORY_SUFFIXES) || dirMatches(symbol.filePath, REPOSITORY_DIR_NAMES)) {
    return {
      kind: "repository",
      name: symbol.name,
      sourceSymbols: [symbol.id],
      properties: { filePath: symbol.filePath, exportName: symbol.name },
    };
  }

  return null;
}

export function recognizeApi(symbol: SymbolNode, _parsedFiles: ParsedFile[]): RecognizedNode | null {
  if (symbol.kind !== "class" && symbol.kind !== "interface" && symbol.kind !== "function") {
    return null;
  }

  if (hasSuffix(symbol.name, CONTROLLER_SUFFIXES) || dirMatches(symbol.filePath, CONTROLLER_DIR_NAMES)) {
    return {
      kind: "api",
      name: symbol.name,
      sourceSymbols: [symbol.id],
      properties: { filePath: symbol.filePath, exportName: symbol.name },
    };
  }

  return null;
}

export function recognizeDatabase(symbol: SymbolNode, _parsedFiles: ParsedFile[]): RecognizedNode | null {
  if (symbol.kind !== "class" && symbol.kind !== "interface") {
    return null;
  }

  // Only recognize as database based on directory name (db, database, prisma, orm)
  // NOT based on suffixes like Entity, Model (those are domain models, not databases)
  if (dirMatches(symbol.filePath, DATABASE_DIR_NAMES)) {
    return {
      kind: "database",
      name: symbol.name,
      sourceSymbols: [symbol.id],
      properties: { filePath: symbol.filePath, exportName: symbol.name },
    };
  }

  return null;
}

export function recognizeAll(symbols: SymbolNode[], parsedFiles: ParsedFile[]): RecognizedNode[] {
  const recognized: RecognizedNode[] = [];

  for (const symbol of symbols) {
    const module = recognizeModule(symbol, parsedFiles);
    if (module) {
      recognized.push(module);
      continue;
    }

    const service = recognizeService(symbol, parsedFiles);
    if (service) {
      recognized.push(service);
      continue;
    }

    const repository = recognizeRepository(symbol, parsedFiles);
    if (repository) {
      recognized.push(repository);
      continue;
    }

    const api = recognizeApi(symbol, parsedFiles);
    if (api) {
      recognized.push(api);
      continue;
    }

    const database = recognizeDatabase(symbol, parsedFiles);
    if (database) {
      recognized.push(database);
      continue;
    }
  }

  return deduplicateRecognized(recognized);
}

function deduplicateRecognized(nodes: RecognizedNode[]): RecognizedNode[] {
  const seen = new Map<string, RecognizedNode>();

  for (const node of nodes) {
    const key = `${node.kind}:${node.name}`;
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, node);
    } else {
      const merged: RecognizedNode = {
        ...existing,
        sourceSymbols: [...existing.sourceSymbols, ...node.sourceSymbols],
      };
      seen.set(key, merged);
    }
  }

  return Array.from(seen.values());
}