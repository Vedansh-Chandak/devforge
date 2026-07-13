import type {
  ParsedFile,
  SymbolNode,
  SymbolId,
  SymbolEdge,
  EdgeKind,
  ImportDeclaration,
  ExportDeclaration,
  NamedImport,
  NamedExport,
  ClassDeclaration,
  InterfaceDeclaration,
  HeritageClause,
  ExpressionWithTypeArguments,
  EnumDeclaration,
} from "./types.js";
import { createSymbolId, resolveLocalSymbols } from "./resolver.js";
import { symbolIdToKey } from "./graph.js";

interface FileSymbols {
  symbols: SymbolNode[];
  symbolMap: Map<string, SymbolNode>;
}

export function linkSymbols(
  allParsedFiles: ParsedFile[],
  fileSymbolsMap: Map<string, FileSymbols>
): SymbolEdge[] {
  const edges: SymbolEdge[] = [];

  for (const parsedFile of allParsedFiles) {
    const fileSymbols = fileSymbolsMap.get(parsedFile.filePath);
    if (!fileSymbols) continue;

    for (const imp of parsedFile.imports) {
      edges.push(...createImportEdges(parsedFile, imp, fileSymbolsMap));
    }

    for (const exp of parsedFile.exports) {
      edges.push(...createExportEdges(parsedFile, exp, fileSymbolsMap));
    }
  }

  for (const parsedFile of allParsedFiles) {
    const fileSymbols = fileSymbolsMap.get(parsedFile.filePath);
    if (!fileSymbols) continue;

    for (const cls of parsedFile.classes) {
      edges.push(...createHeritageEdges(cls, fileSymbols));
      edges.push(...createContainmentEdges(cls, fileSymbols));
    }
    for (const iface of parsedFile.interfaces) {
      edges.push(...createInterfaceHeritageEdges(iface, fileSymbols));
      edges.push(...createInterfaceContainmentEdges(iface, fileSymbols));
    }
    for (const enumDecl of parsedFile.enums) {
      edges.push(...createEnumContainmentEdges(enumDecl, fileSymbols));
    }
  }

  return edges;
}

function createImportEdges(
  parsedFile: ParsedFile,
  imp: ImportDeclaration,
  fileSymbolsMap: Map<string, FileSymbols>
): SymbolEdge[] {
  const edges: SymbolEdge[] = [];
  const fromFilePath = parsedFile.filePath;

  const resolvedModule = resolveModuleSpecifier(imp.moduleSpecifier, fromFilePath, allParsedFiles);
  if (!resolvedModule) return edges;

  const targetFileSymbols = fileSymbolsMap.get(resolvedModule);
  if (!targetFileSymbols) return edges;

  const fromFileSymbolId = createFileSymbolId(fromFilePath);

  if (imp.defaultImport) {
    const target = targetFileSymbols.symbolMap.get(imp.defaultImport);
    if (target) {
      edges.push(createEdge(fromFileSymbolId, target.id, "imports"));
    }
  }

  if (imp.namespaceImport) {
    const target = targetFileSymbols.symbolMap.get(imp.namespaceImport);
    if (target) {
      edges.push(createEdge(fromFileSymbolId, target.id, "imports"));
    }
  }

  for (const named of imp.namedImports) {
    const nameToFind = named.alias || named.name;
    const target = targetFileSymbols.symbolMap.get(nameToFind);
    if (target) {
      edges.push(createEdge(fromFileSymbolId, target.id, "imports"));
    }
  }

  return edges;
}

function createExportEdges(
  parsedFile: ParsedFile,
  exp: ExportDeclaration,
  fileSymbolsMap: Map<string, FileSymbols>
): SymbolEdge[] {
  const edges: SymbolEdge[] = [];
  const fromFileSymbolId = createFileSymbolId(parsedFile.filePath);

  if (exp.moduleSpecifier) {
    const resolvedModule = resolveModuleSpecifier(exp.moduleSpecifier, parsedFile.filePath, allParsedFiles);
    if (!resolvedModule) return edges;

    const targetFileSymbols = fileSymbolsMap.get(resolvedModule);
    if (!targetFileSymbols) return edges;

    for (const named of exp.namedExports) {
      const nameToFind = named.alias || named.name;
      const target = targetFileSymbols.symbolMap.get(nameToFind);
      if (target) {
        edges.push(createEdge(fromFileSymbolId, target.id, "exports"));
      }
    }
  } else {
    const fileSymbols = fileSymbolsMap.get(parsedFile.filePath);
    if (!fileSymbols) return edges;

    for (const named of exp.namedExports) {
      const target = fileSymbols.symbolMap.get(named.name);
      if (target) {
        edges.push(createEdge(fromFileSymbolId, target.id, "exports"));
      }
    }
  }

  return edges;
}

function createHeritageEdges(
  cls: ClassDeclaration,
  fileSymbols: FileSymbols
): SymbolEdge[] {
  const edges: SymbolEdge[] = [];
  const classSymbol = fileSymbols.symbolMap.get(cls.name);
  if (!classSymbol) return edges;

  for (const clause of cls.heritageClauses) {
    for (const type of clause.types) {
      const targetName = type.expression;
      const target = fileSymbols.symbolMap.get(targetName);
      if (target) {
        edges.push(createEdge(
          classSymbol.id,
          target.id,
          clause.kind === "extends" ? "extends" : "implements"
        ));
      }
    }
  }

  return edges;
}

function createInterfaceHeritageEdges(
  iface: InterfaceDeclaration,
  fileSymbols: FileSymbols
): SymbolEdge[] {
  const edges: SymbolEdge[] = [];
  const interfaceSymbol = fileSymbols.symbolMap.get(iface.name);
  if (!interfaceSymbol) return edges;

  for (const clause of iface.heritageClauses) {
    for (const type of clause.types) {
      const targetName = type.expression;
      const target = fileSymbols.symbolMap.get(targetName);
      if (target) {
        edges.push(createEdge(
          interfaceSymbol.id,
          target.id,
          "extends"
        ));
      }
    }
  }

  return edges;
}

function createContainmentEdges(
  cls: ClassDeclaration,
  fileSymbols: FileSymbols
): SymbolEdge[] {
  const edges: SymbolEdge[] = [];
  const classSymbol = fileSymbols.symbolMap.get(cls.name);
  if (!classSymbol) return edges;

  for (const member of cls.members) {
    const memberName = `${cls.name}.${member.name}`;
    const target = fileSymbols.symbolMap.get(memberName);
    if (target) {
      edges.push(createEdge(classSymbol.id, target.id, "contains"));
    }
  }

  return edges;
}

function createInterfaceContainmentEdges(
  iface: InterfaceDeclaration,
  fileSymbols: FileSymbols
): SymbolEdge[] {
  const edges: SymbolEdge[] = [];
  const interfaceSymbol = fileSymbols.symbolMap.get(iface.name);
  if (!interfaceSymbol) return edges;

  for (const member of iface.members) {
    const memberName = `${iface.name}.${member.name}`;
    const target = fileSymbols.symbolMap.get(memberName);
    if (target) {
      edges.push(createEdge(interfaceSymbol.id, target.id, "contains"));
    }
  }

  return edges;
}

function createEnumContainmentEdges(
  enumDecl: EnumDeclaration,
  fileSymbols: FileSymbols
): SymbolEdge[] {
  const edges: SymbolEdge[] = [];
  const enumSymbol = fileSymbols.symbolMap.get(enumDecl.name);
  if (!enumSymbol) return edges;

  for (const member of enumDecl.members) {
    const memberName = `${enumDecl.name}.${member.name}`;
    const target = fileSymbols.symbolMap.get(memberName);
    if (target) {
      edges.push(createEdge(enumSymbol.id, target.id, "contains"));
    }
  }

  return edges;
}

function resolveModuleSpecifier(
  specifier: string,
  fromFilePath: string,
  allParsedFiles: ParsedFile[]
): string | null {
  if (specifier.startsWith(".")) {
    const dir = fromFilePath.substring(0, fromFilePath.lastIndexOf("/") + 1);
    let resolved = dir + specifier;
    resolved = resolved.replace(/\/\.\//g, "/");
    while (resolved.includes("/../")) {
      resolved = resolved.replace(/[^/]+\/\.\.\//, "");
    }
    // Remove leading "./" 
    resolved = resolved.replace(/^\.\//, "");
    if (!resolved.endsWith(".ts") && !resolved.endsWith(".js")) {
      resolved += ".ts";
    }
    const matchingFile = allParsedFiles.find((f) => f.filePath === resolved || f.filePath === resolved.replace(/\.ts$/, ""));
    if (matchingFile) return matchingFile.filePath;
  }
  return null;
}

let allParsedFiles: ParsedFile[] = [];

export function setAllParsedFiles(files: ParsedFile[]): void {
  allParsedFiles = files;
}

function createFileSymbolId(filePath: string): SymbolId {
  return createSymbolId(filePath, "namespace", filePath, { start: 0, end: 0, line: 0, character: 0 });
}

function createEdge(from: SymbolId, to: SymbolId, kind: EdgeKind): SymbolEdge {
  return { from, to, kind };
}