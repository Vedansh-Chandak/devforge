import { describe, it, expect } from "vitest";
import type { ParsedFile } from "@devforge/symbol-graph";
import {
  buildDependencyView,
  detectCircular,
  findDependencies,
  findDependents,
  importDistance,
  resolveModuleSpecifier,
} from "../src/index.js";
import { indexRepo, makeChainRepo, makeCycleRepo, makeAuthRepo } from "./helpers.js";

/** Minimal parsed file with the given direct imports. */
function parsed(
  filePath: string,
  imports: ReadonlyArray<{ from: string; to: string }> = []
): ParsedFile {
  return {
    filePath,
    imports: imports.map((i) => ({
      moduleSpecifier: `./${i.to}`,
      namedImports: [],
      defaultImport: undefined,
      namespaceImport: undefined,
      isTypeOnly: false,
      start: 0,
      end: 1,
    })),
    exports: [],
    classes: [],
    interfaces: [],
    enums: [],
    functions: [],
    typeAliases: [],
    syntaxErrors: [],
  };
}

describe("resolveModuleSpecifier", () => {
  const known = new Set(["src/a.ts", "src/dir/b.ts", "src/dir/index.ts", "b.ts", "index.ts", "root.js"]);

  it("resolves a sibling import", () => {
    expect(resolveModuleSpecifier("./b", "src/dir/logger.ts", known)).toBe("src/dir/b.ts");
  });

  it("resolves relative imports from a root-level file", () => {
    expect(resolveModuleSpecifier("./b", "index.ts", known)).toBe("b.ts");
  });

  it("returns null for non-relative (package) specifiers", () => {
    expect(resolveModuleSpecifier("@app/foo", "src/a.ts", known)).toBeNull();
    expect(resolveModuleSpecifier("node:fs", "src/a.ts", known)).toBeNull();
  });

  it("returns null when the target file is not known", () => {
    expect(resolveModuleSpecifier("./missing", "src/a.ts", known)).toBeNull();
  });

  it("resolves a directory index candidate", () => {
    expect(resolveModuleSpecifier("./utils", "src/a.ts", new Set(["src/a.ts", "src/utils/index.ts"]))).toBe("src/utils/index.ts");
  });

  it("resolves a tsx file", () => {
    const tsx = new Set(["comp.tsx"]);
    expect(resolveModuleSpecifier("./comp", "a.ts", tsx)).toBe("comp.tsx");
  });

  it("treats explicit .ts specifiers as-is", () => {
    const flat = new Set(["root.ts"]);
    expect(resolveModuleSpecifier("./root.ts", "a.ts", flat)).toBe("root.ts");
  });

  it("normalizes parent directory traversal", () => {
    expect(resolveModuleSpecifier("../a", "src/dir/b.ts", known)).toBe("src/a.ts");
  });

  it("rejects specifiers that escape the root", () => {
    expect(resolveModuleSpecifier("../../../../../x", "src/dir/b.ts", known)).toBeNull();
  });

  it("is deterministic across repeated calls", () => {
    const a = resolveModuleSpecifier("./b", "src/a.ts", known);
    const b = resolveModuleSpecifier("./b", "src/a.ts", known);
    expect(a).toBe(b);
  });
});

describe("detectCircular", () => {
  it("returns no cycles for an empty graph", () => {
    expect(detectCircular(new Map())).toEqual([]);
  });

  it("returns no cycles for an acyclic chain", () => {
    const graph = new Map([
      ["a", ["b"]],
      ["b", ["c"]],
      ["c", []],
    ]);
    expect(detectCircular(graph)).toEqual([]);
  });

  it("returns no cycles for an isolated node", () => {
    expect(detectCircular(new Map([["solo", []]]))).toEqual([]);
  });

  it("detects a self-loop", () => {
    const graph = new Map([["a", ["a"]]]);
    const cycles = detectCircular(graph);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.path).toEqual(["a"]);
  });

  it("detects a two-file cycle", () => {
    const graph = new Map([
      ["a", ["b"]],
      ["b", ["a"]],
    ]);
    const cycles = detectCircular(graph);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.path.sort()).toEqual(["a", "b"]);
  });

  it("detects a three-file cycle", () => {
    const graph = new Map([
      ["a", ["b"]],
      ["b", ["c"]],
      ["c", ["a"]],
    ]);
    const cycles = detectCircular(graph);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.path).toContain("a");
    expect(cycles[0]?.path).toContain("b");
    expect(cycles[0]?.path).toContain("c");
  });

  it("reports two disjoint cycles", () => {
    const graph = new Map([
      ["a", ["b"]],
      ["b", ["a"]],
      ["c", ["d"]],
      ["d", ["c"]],
    ]);
    expect(detectCircular(graph)).toHaveLength(2);
  });

  it("does not misreport an acyclic node adjacent to a cycle", () => {
    const graph = new Map([
      ["a", ["b"]],
      ["b", ["c"]],
      ["c", ["b"]],
      ["d", ["a"]],
    ]);
    const cycles = detectCircular(graph);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.path).not.toContain("d");
  });

  it("is deterministic across repeated calls", () => {
    const graph = new Map([
      ["a", ["b"]],
      ["b", ["a"]],
      ["x", []],
    ]);
    const one = detectCircular(graph);
    const two = detectCircular(graph);
    expect(one.map((c) => c.path.join("/"))).toEqual(two.map((c) => c.path.join("/")));
  });

  it("sorts cycle members deterministically", () => {
    const graph = new Map([
      ["b", ["a"]],
      ["a", ["b"]],
    ]);
    const cycles = detectCircular(graph);
    expect(cycles[0]?.path).toEqual(["a", "b"]);
  });
});

describe("findDependencies", () => {
  const graph = new Map<string, string[]>([
    ["entry", ["mid"]],
    ["mid", ["leaf"]],
    ["leaf", []],
  ]);

  it("collects transitive dependencies by default", () => {
    const deps = findDependencies(graph, "entry");
    expect(deps.map((d) => d.to).sort()).toEqual(["leaf", "mid"]);
  });

  it("honors maxDepth = 1 (direct only)", () => {
    const deps = findDependencies(graph, "entry", 1);
    expect(deps.map((d) => d.to)).toEqual(["mid"]);
  });

  it("honors maxDepth = 0 (no edges)", () => {
    expect(findDependencies(graph, "entry", 0)).toEqual([]);
  });

  it("collects transitive dependencies with depth", () => {
    const deps = findDependencies(graph, "entry", Infinity);
    const pairs = deps.map((d) => `${d.from}->${d.to}:${d.depth}`);
    expect(pairs).toContain("entry->mid:1");
    expect(pairs).toContain("mid->leaf:2");
  });

  it("returns nothing for a file with no dependencies", () => {
    expect(findDependencies(graph, "leaf")).toEqual([]);
  });

  it("returns nothing for an unknown file", () => {
    expect(findDependencies(graph, "ghost")).toEqual([]);
  });

  it("terminates on cyclic graphs", () => {
    const cyclic = new Map<string, string[]>([
      ["a", ["b"]],
      ["b", ["a"]],
    ]);
    const deps = findDependencies(cyclic, "a", Infinity);
    expect(deps.map((d) => `${d.from}->${d.to}`)).toEqual(["a->b", "b->a"]);
  });

  it("deduplicates repeated edges", () => {
    const dup = new Map<string, string[]>([
      ["a", ["b", "b"]],
      ["b", []],
    ]);
    expect(findDependencies(dup, "a")).toHaveLength(1);
  });
});

describe("findDependents", () => {
  const graph = new Map<string, string[]>([
    ["entry", ["mid"]],
    ["mid", ["leaf"]],
    ["leaf", []],
    ["user", ["leaf"]],
  ]);

  it("lists direct importers of a leaf through transitively", () => {
    const deps = findDependents(graph, "leaf", 1);
    expect(deps.map((d) => d.from).sort()).toEqual(["mid", "user"]);
  });

  it("lists transitive dependents with depth by default", () => {
    const deps = findDependents(graph, "leaf");
    const pairs = new Set(deps.map((d) => `${d.from}->${d.to}:${d.depth}`));
    expect(pairs.has("mid->leaf:1")).toBe(true);
    expect(pairs.has("entry->mid:2")).toBe(true);
  });

  it("returns nothing when nobody imports the file", () => {
    expect(findDependents(graph, "entry")).toEqual([]);
  });
});

describe("importDistance", () => {
  const graph = new Map<string, string[]>([
    ["a", ["b"]],
    ["b", ["c"]],
    ["c", []],
  ]);

  it("is zero for the same node", () => {
    expect(importDistance(graph, "a", "a")).toBe(0);
  });

  it("measures one hop", () => {
    expect(importDistance(graph, "a", "b")).toBe(1);
  });

  it("measures multiple hops", () => {
    expect(importDistance(graph, "a", "c")).toBe(2);
  });

  it("returns null when unreachable", () => {
    expect(importDistance(graph, "c", "a")).toBeNull();
  });

  it("returns null for an absent target", () => {
    expect(importDistance(graph, "a", "zzz")).toBeNull();
  });

  it("finds the shortest path when multiple exist", () => {
    const g = new Map<string, string[]>([
      ["a", ["b", "direct"]],
      ["b", ["c"]],
      ["c", ["direct"]],
      ["direct", []],
    ]);
    expect(importDistance(g, "a", "direct")).toBe(1);
  });
});

describe("buildDependencyView", () => {
  it("builds an import graph keyed by parsed file", () => {
    const view = buildDependencyView(
      [parsed("a.ts", [{ from: "./b", to: "b.ts" }]), parsed("b.ts")],
      new Set(["a.ts", "b.ts"])
    );
    expect(view.importGraph.get("a.ts")).toEqual(["b.ts"]);
    expect(view.importGraph.get("b.ts")).toEqual([]);
  });

  it("includes only known resolvable specifiers in the import graph", () => {
    const view = buildDependencyView(
      [parsed("a.ts", [{ from: "./ghost", to: "ghost.ts" }])],
      new Set(["a.ts"])
    );
    expect(view.importGraph.get("a.ts")).toEqual([]);
  });

  it("maps unresolved specifiers out of the graph", () => {
    const view = buildDependencyView(
      [parsed("a.ts", [{ from: "package/foo", to: "" }])],
      new Set(["a.ts"])
    );
    expect(view.importGraph.get("a.ts")).toEqual([]);
  });

  it("detects cycles authored via the import graph", () => {
    const view = buildDependencyView(
      [
        parsed("a.ts", [{ from: "./b", to: "b.ts" }]),
        parsed("b.ts", [{ from: "./a", to: "a.ts" }]),
      ],
      new Set(["a.ts", "b.ts"])
    );
    expect(view.circular).toHaveLength(1);
    expect(view.circular[0]?.sort()).toEqual(["a.ts", "b.ts"]);
  });

  it("exposes the export graph for re-export barrels", () => {
    const barrel: ParsedFile = {
      ...parsed("barrel.ts"),
      exports: [
        {
          moduleSpecifier: "./impl",
          namedExports: [{ name: "Foo", isTypeOnly: false }],
          isTypeOnly: false,
          start: 0,
          end: 2,
        },
      ],
    };
    const view = buildDependencyView([barrel, parsed("impl.ts")], new Set(["barrel.ts", "impl.ts"]));
    expect(view.exportGraph.get("barrel.ts")).toEqual(["impl.ts"]);
  });

  it("is deterministic across repeated calls", () => {
    const files = [parsed("a.ts", [{ from: "./b", to: "b.ts" }]), parsed("b.ts")];
    const known = new Set(["a.ts", "b.ts"]);
    const view = buildDependencyView(files, known);
    const again = buildDependencyView(files, known);
    expect(view.importGraph.get("a.ts")).toEqual(again.importGraph.get("a.ts"));
  });
});

describe("dependency view - integration with real repositories", () => {
  it("detects the cycle in a two-file circular repository", () => {
    const engine = indexRepo(makeCycleRepo());
    const view = engine.getDependencyView();
    expect(view.circular).toHaveLength(1);
    expect(view.circular[0]?.sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("reports circular dependencies through the service", () => {
    const engine = indexRepo(makeCycleRepo());
    const cycles = engine.getCircularDependencies();
    expect(cycles).toHaveLength(1);
    const [cycle] = cycles;
    expect(cycle?.path.sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("exposes direct imports for a chain file", () => {
    const engine = indexRepo(makeChainRepo());
    const deps = engine.findDependencies("src/entry.ts");
    expect(deps.map((d) => d.to)).toContain("src/mid.ts");
  });

  it("resolves transitive dependencies through the service", () => {
    const engine = indexRepo(makeChainRepo());
    const deps = engine.findDependencies("src/entry.ts", Infinity);
    const pairs = deps.map((d) => `${d.from}->${d.to}:${d.depth}`);
    expect(pairs).toContain("src/entry.ts->src/mid.ts:1");
    expect(pairs).toContain("src/mid.ts->src/leaf.ts:2");
  });

  it("excludes unreachable sibling errors from transitive dependencies", () => {
    const engine = indexRepo(makeChainRepo());
    const deps = engine.findDependencies("src/entry.ts", Infinity);
    expect(deps.some((d) => d.to === "src/other.ts")).toBe(false);
  });

  it("lists transitive dependents for a leaf file", () => {
    const engine = indexRepo(makeChainRepo());
    const dependents = engine.findDependents("src/leaf.ts");
    expect(new Set(dependents.map((d) => d.from))).toEqual(
      new Set(["src/mid.ts", "src/entry.ts"])
    );
  });

  it("has no circular dependencies in the chain repository", () => {
    const engine = indexRepo(makeChainRepo());
    expect(engine.getCircularDependencies()).toEqual([]);
  });

  it("reports no cycles for an acyclic auth repository", () => {
    const engine = indexRepo(makeAuthRepo());
    expect(engine.getCircularDependencies()).toEqual([]);
  });

  it("exposes the export graph through the service for a barrel file", () => {
    const engine = indexRepo(makeAuthRepo());
    const view = engine.getDependencyView();
    expect(view.exportGraph.get("auth/barrel.ts")?.sort()).toEqual([
      "auth/auth-service.ts",
      "auth/token.ts",
      "auth/types.ts",
    ]);
  });
});