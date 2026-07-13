import { describe, it, expect } from "vitest";
import { buildSymbolGraph, getNode } from "../index.js";
import type { ParsedFile, SymbolId, Location, SymbolNode } from "../types.js";

function createLocation(): Location {
  return { start: 0, end: 0, line: 0, character: 0 };
}

function createSymbolId(filePath: string, kind: string, name: string): SymbolId {
  return { filePath, kind: kind as any, name, declarationLocation: createLocation() };
}

function createParsedFile(overrides: Partial<ParsedFile> = {}): ParsedFile {
  return {
    filePath: "test.ts",
    imports: [],
    exports: [],
    classes: [],
    interfaces: [],
    enums: [],
    functions: [],
    typeAliases: [],
    syntaxErrors: [],
    ...overrides,
  };
}

function createImportDeclaration(overrides: Partial<any> = {}) {
  return {
    moduleSpecifier: "./other",
    namedImports: [],
    defaultImport: undefined,
    namespaceImport: undefined,
    isTypeOnly: false,
    start: 0,
    end: 0,
    ...overrides,
  };
}

function createExportDeclaration(overrides: Partial<any> = {}) {
  return {
    moduleSpecifier: undefined,
    namedExports: [],
    exportClause: undefined,
    isTypeOnly: false,
    start: 0,
    end: 0,
    ...overrides,
  };
}

describe("Symbol Graph", () => {
  it("creates nodes for classes", () => {
    const parsedFiles = [
      createParsedFile({
        classes: [{
          name: "MyClass",
          typeParameters: [],
          heritageClauses: [],
          members: [],
          modifiers: [],
          start: 0,
          end: 10,
        }],
      }),
    ];

    const graph = buildSymbolGraph(parsedFiles);
    const node = graph.nodes.get("test.ts:class:MyClass:0:10");
    expect(node).toBeDefined();
    expect(node?.kind).toBe("class");
    expect(node?.name).toBe("MyClass");
  });

  it("creates nodes for interfaces", () => {
    const parsedFiles = [
      createParsedFile({
        interfaces: [{
          name: "MyInterface",
          typeParameters: [],
          heritageClauses: [],
          members: [],
          start: 0,
          end: 10,
        }],
      }),
    ];

    const graph = buildSymbolGraph(parsedFiles);
    const node = graph.nodes.get("test.ts:interface:MyInterface:0:10");
    expect(node).toBeDefined();
    expect(node?.kind).toBe("interface");
  });

  it("creates nodes for enums", () => {
    const parsedFiles = [
      createParsedFile({
        enums: [{
          name: "MyEnum",
          members: [],
          isConst: false,
          start: 0,
          end: 10,
        }],
      }),
    ];

    const graph = buildSymbolGraph(parsedFiles);
    const node = graph.nodes.get("test.ts:enum:MyEnum:0:10");
    expect(node).toBeDefined();
    expect(node?.kind).toBe("enum");
  });

  it("creates nodes for functions", () => {
    const parsedFiles = [
      createParsedFile({
        functions: [{
          name: "myFunction",
          typeParameters: [],
          parameters: [],
          modifiers: [],
          isAsync: false,
          isGenerator: false,
          start: 0,
          end: 10,
        }],
      }),
    ];

    const graph = buildSymbolGraph(parsedFiles);
    const node = graph.nodes.get("test.ts:function:myFunction:0:10");
    expect(node).toBeDefined();
    expect(node?.kind).toBe("function");
  });

  it("creates nodes for type aliases", () => {
    const parsedFiles = [
      createParsedFile({
        typeAliases: [{
          name: "MyType",
          typeParameters: [],
          type: "string",
          start: 0,
          end: 10,
        }],
      }),
    ];

    const graph = buildSymbolGraph(parsedFiles);
    const node = graph.nodes.get("test.ts:type-alias:MyType:0:10");
    expect(node).toBeDefined();
    expect(node?.kind).toBe("type-alias");
  });

  it("creates import edges", () => {
    const parsedFiles = [
      createParsedFile({
        filePath: "a.ts",
        imports: [createImportDeclaration({
          moduleSpecifier: "./b",
          defaultImport: "MyClass",
        })],
      }),
      createParsedFile({
        filePath: "b.ts",
        classes: [{
          name: "MyClass",
          typeParameters: [],
          heritageClauses: [],
          members: [],
          modifiers: [],
          start: 0,
          end: 10,
        }],
      }),
    ];

    const graph = buildSymbolGraph(parsedFiles);
    const importEdges = graph.edges.filter((e) => e.kind === "imports");
    expect(importEdges.length).toBeGreaterThan(0);
  });

  it("creates export edges", () => {
    const parsedFiles = [
      createParsedFile({
        filePath: "a.ts",
        exports: [createExportDeclaration({
          namedExports: [{ name: "MyClass", isTypeOnly: false }],
        })],
        classes: [{
          name: "MyClass",
          typeParameters: [],
          heritageClauses: [],
          members: [],
          modifiers: [],
          start: 0,
          end: 10,
        }],
      }),
    ];

    const graph = buildSymbolGraph(parsedFiles);
    const exportEdges = graph.edges.filter((e) => e.kind === "exports");
    expect(exportEdges.length).toBeGreaterThan(0);
  });

  it("creates extends edges", () => {
    const parsedFiles = [
      createParsedFile({
        classes: [
          {
            name: "Base",
            typeParameters: [],
            heritageClauses: [],
            members: [],
            modifiers: [],
            start: 0,
            end: 10,
          },
          {
            name: "Derived",
            typeParameters: [],
            heritageClauses: [{ kind: "extends", types: [{ expression: "Base", typeArguments: undefined }] }],
            members: [],
            modifiers: [],
            start: 20,
            end: 30,
          },
        ],
      }),
    ];

    const graph = buildSymbolGraph(parsedFiles);
    const extendsEdges = graph.edges.filter((e) => e.kind === "extends");
    expect(extendsEdges.length).toBeGreaterThan(0);
  });

  it("creates implements edges", () => {
    const parsedFiles = [
      createParsedFile({
        interfaces: [{
          name: "MyInterface",
          typeParameters: [],
          heritageClauses: [],
          members: [],
          start: 0,
          end: 10,
        }],
        classes: [{
          name: "MyClass",
          typeParameters: [],
          heritageClauses: [{ kind: "implements", types: [{ expression: "MyInterface", typeArguments: undefined }] }],
          members: [],
          modifiers: [],
          start: 20,
          end: 30,
        }],
      }),
    ];

    const graph = buildSymbolGraph(parsedFiles);
    const implementsEdges = graph.edges.filter((e) => e.kind === "implements");
    expect(implementsEdges.length).toBeGreaterThan(0);
  });

  it("creates contains edges for class members", () => {
    const parsedFiles = [
      createParsedFile({
        classes: [{
          name: "MyClass",
          typeParameters: [],
          heritageClauses: [],
          members: [{
            kind: "method",
            name: "myMethod",
            typeParameters: [],
            parameters: [],
            returnType: "void",
            modifiers: [],
            isStatic: false,
            isAbstract: false,
            isOptional: false,
            isReadonly: false,
            start: 10,
            end: 20,
          }],
          modifiers: [],
          start: 0,
          end: 30,
        }],
      }),
    ];

    const graph = buildSymbolGraph(parsedFiles);
    const containsEdges = graph.edges.filter((e) => e.kind === "contains");
    expect(containsEdges.length).toBeGreaterThan(0);
  });

  it("handles multiple files with duplicate symbol names", () => {
    const parsedFiles = [
      createParsedFile({
        filePath: "a.ts",
        classes: [{
          name: "MyClass",
          typeParameters: [],
          heritageClauses: [],
          members: [],
          modifiers: [],
          start: 0,
          end: 10,
        }],
      }),
      createParsedFile({
        filePath: "b.ts",
        classes: [{
          name: "MyClass",
          typeParameters: [],
          heritageClauses: [],
          members: [],
          modifiers: [],
          start: 0,
          end: 10,
        }],
      }),
    ];

    const graph = buildSymbolGraph(parsedFiles);
    const nodes = Array.from(graph.nodes.values());
    const classNodes = nodes.filter((n) => n.kind === "class" && n.name === "MyClass");
    expect(classNodes.length).toBe(2);
  });

  it("handles nested classes and functions", () => {
    const parsedFiles = [
      createParsedFile({
        classes: [{
          name: "Outer",
          typeParameters: [],
          heritageClauses: [],
          members: [{
            kind: "method",
            name: "innerMethod",
            typeParameters: [],
            parameters: [],
            returnType: "void",
            modifiers: [],
            isStatic: false,
            isAbstract: false,
            isOptional: false,
            isReadonly: false,
            start: 10,
            end: 20,
          }],
          modifiers: [],
          start: 0,
          end: 30,
        }],
        functions: [{
          name: "outerFunction",
          typeParameters: [],
          parameters: [],
          modifiers: [],
          isAsync: false,
          isGenerator: false,
          start: 40,
          end: 50,
        }],
      }),
    ];

    const graph = buildSymbolGraph(parsedFiles);
    const nodes = Array.from(graph.nodes.values());
    const names = nodes.map((n) => n.name).sort();
    expect(names).toContain("Outer");
    expect(names).toContain("Outer.innerMethod");
    expect(names).toContain("outerFunction");
  });

  it("handles empty ParsedFile", () => {
    const parsedFiles = [createParsedFile()];
    const graph = buildSymbolGraph(parsedFiles);
    expect(graph.nodes.size).toBe(0);
    expect(graph.edges).toHaveLength(0);
  });
});