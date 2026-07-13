import { describe, it, expect, beforeEach } from "vitest";
import { buildSymbolGraph, getNode, hasNode, hasEdge, getOutgoingEdges, getIncomingEdges, getNodesByKind, getNodesByFile } from "../index.js";
import type { ParsedFile } from "../types.js";

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

describe("Symbol Graph Query Layer", () => {
  let graph: ReturnType<typeof buildSymbolGraph>;

  beforeEach(() => {
    const parsedFiles = [
      createParsedFile({
        filePath: "a.ts",
        imports: [{
          moduleSpecifier: "./b",
          namedImports: [],
          defaultImport: "MyClass",
          namespaceImport: undefined,
          isTypeOnly: false,
          start: 0,
          end: 10,
        }],
        exports: [],
        classes: [],
        interfaces: [],
        enums: [],
        functions: [],
        typeAliases: [],
      }),
      createParsedFile({
        filePath: "b.ts",
        imports: [],
        exports: [],
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
        interfaces: [{
          name: "MyInterface",
          typeParameters: [],
          heritageClauses: [],
          members: [],
          start: 40,
          end: 50,
        }],
        enums: [{
          name: "MyEnum",
          members: [{ name: "A", value: 0, start: 0, end: 5 }],
          isConst: false,
          start: 60,
          end: 70,
        }],
        functions: [{
          name: "myFunction",
          typeParameters: [],
          parameters: [],
          modifiers: [],
          isAsync: false,
          isGenerator: false,
          start: 80,
          end: 90,
        }],
        typeAliases: [{
          name: "MyType",
          typeParameters: [],
          type: "string",
          start: 100,
          end: 110,
        }],
      }),
    ];

    graph = buildSymbolGraph(parsedFiles);
  });

  it("getNode() returns node by id", () => {
    // Find the actual node key from the graph
    const classNode = Array.from(graph.nodes.values()).find(n => n.name === "MyClass" && n.kind === "class");
    expect(classNode).toBeDefined();
    const node = getNode(graph, classNode!.id);
    expect(node).toBeDefined();
    expect(node?.name).toBe("MyClass");
    expect(node?.kind).toBe("class");
  });

  it("getNode() returns undefined for missing symbol", () => {
    const node = getNode(graph, { filePath: "b.ts", kind: "class", name: "NonExistent", declarationLocation: { start: 0, end: 0, line: 0, character: 0 } });
    expect(node).toBeUndefined();
  });

  it("hasNode() returns true for existing symbol", () => {
    const classNode = Array.from(graph.nodes.values()).find(n => n.name === "MyClass" && n.kind === "class");
    expect(hasNode(graph, classNode!.id)).toBe(true);
  });

  it("hasNode() returns false for missing symbol", () => {
    expect(hasNode(graph, { filePath: "b.ts", kind: "class", name: "NonExistent", declarationLocation: { start: 0, end: 0, line: 0, character: 0 } })).toBe(false);
  });

  it("hasEdge() returns true for existing edge", () => {
    const classNode = Array.from(graph.nodes.values()).find(n => n.name === "MyClass" && n.kind === "class");
    const methodNode = Array.from(graph.nodes.values()).find(n => n.name === "MyClass.myMethod" && n.kind === "function");
    expect(classNode).toBeDefined();
    expect(methodNode).toBeDefined();
    expect(hasEdge(graph, classNode!.id, methodNode!.id)).toBe(true);
  });

  it("hasEdge() returns false for non-existing edge", () => {
    const classNode = Array.from(graph.nodes.values()).find(n => n.name === "MyClass" && n.kind === "class");
    expect(hasEdge(graph, classNode!.id, { filePath: "b.ts", kind: "class", name: "NonExistent", declarationLocation: { start: 0, end: 0, line: 0, character: 0 } })).toBe(false);
  });

  it("getOutgoingEdges() returns all outgoing edges", () => {
    const classNode = Array.from(graph.nodes.values()).find(n => n.name === "MyClass" && n.kind === "class");
    const edges = getOutgoingEdges(graph, classNode!.id);
    const kinds = edges.map(e => e.kind);
    expect(kinds).toContain("contains");
  });

  it("getOutgoingEdges() filters by kind", () => {
    const classNode = Array.from(graph.nodes.values()).find(n => n.name === "MyClass" && n.kind === "class");
    const edges = getOutgoingEdges(graph, classNode!.id, "contains");
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.every(e => e.kind === "contains")).toBe(true);
  });

  it("getIncomingEdges() returns incoming edges", () => {
    const methodNode = Array.from(graph.nodes.values()).find(n => n.name === "MyClass.myMethod" && n.kind === "function");
    if (!methodNode) throw new Error("Method node not found");
    const edges = getIncomingEdges(graph, methodNode.id);
    expect(edges.length).toBeGreaterThan(0);
    expect(edges[0]!.kind).toBe("contains");
  });

  it("getIncomingEdges() filters by kind", () => {
    const methodNode = Array.from(graph.nodes.values()).find(n => n.name === "MyClass.myMethod" && n.kind === "function");
    if (!methodNode) throw new Error("Method node not found");
    const edges = getIncomingEdges(graph, methodNode.id, "contains");
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.every(e => e.kind === "contains")).toBe(true);
  });

  it("getNodesByKind() returns nodes of specific kind", () => {
    const classes = getNodesByKind(graph, "class");
    expect(classes.length).toBe(1);
    const classNode = classes[0];
    if (!classNode) throw new Error("Class node not found");
    expect(classNode.name).toBe("MyClass");

    const functions = getNodesByKind(graph, "function");
    expect(functions.length).toBeGreaterThanOrEqual(2);
  });

  it("getNodesByFile() returns nodes from specific file", () => {
    const aNodes = getNodesByFile(graph, "a.ts");
    expect(aNodes.length).toBe(0);

    const bNodes = getNodesByFile(graph, "b.ts");
    expect(bNodes.length).toBeGreaterThanOrEqual(6);
  });

  it("handles empty graph", () => {
    const emptyGraph = buildSymbolGraph([createParsedFile()]);
    expect(hasNode(emptyGraph, { filePath: "x.ts", kind: "class", name: "X", declarationLocation: { start: 0, end: 0, line: 0, character: 0 } })).toBe(false);
    expect(getNode(emptyGraph, { filePath: "x.ts", kind: "class", name: "X", declarationLocation: { start: 0, end: 0, line: 0, character: 0 } })).toBeUndefined();
    expect(getOutgoingEdges(emptyGraph, { filePath: "x.ts", kind: "class", name: "X", declarationLocation: { start: 0, end: 0, line: 0, character: 0 } })).toHaveLength(0);
    expect(getIncomingEdges(emptyGraph, { filePath: "x.ts", kind: "class", name: "X", declarationLocation: { start: 0, end: 0, line: 0, character: 0 } })).toHaveLength(0);
    expect(getNodesByKind(emptyGraph, "class")).toHaveLength(0);
    expect(getNodesByFile(emptyGraph, "x.ts")).toHaveLength(0);
    expect(hasEdge(emptyGraph, { filePath: "x.ts", kind: "class", name: "X", declarationLocation: { start: 0, end: 0, line: 0, character: 0 } }, { filePath: "x.ts", kind: "class", name: "Y", declarationLocation: { start: 0, end: 0, line: 0, character: 0 } })).toBe(false);
  });
});