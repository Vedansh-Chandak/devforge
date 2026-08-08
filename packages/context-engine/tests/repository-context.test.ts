import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RepositoryContextService,
  IncrementalCache,
  fingerprint,
  graphHash,
  FileNotFoundError,
  IndexNotReadyError,
  InvalidQueryError,
  DuplicateFileError,
  DEFAULT_LIMITS,
} from "../src/index.js";
import {
  indexRepo,
  makeAuthRepo,
  makeCycleRepo,
  makeChainRepo,
  makeLeafRepo,
} from "./helpers.js";

describe("indexing via immutable snapshots", () => {
  it("registers files, symbols and fingerprints in the snapshot", () => {
    const engine = indexRepo(makeAuthRepo());
    expect(engine.isIndexed).toBe(true);
    expect(engine.fileCount).toBe(7);
    expect(engine.symbolCount).toBeGreaterThan(10);
    expect(engine.dependencyCount).toBeGreaterThan(0);
    expect(engine.index?.indexedAt).toBeDefined();
  });

  it("records a file fingerprint for each indexed path", () => {
    const engine = indexRepo(makeAuthRepo());
    expect(engine.index?.fingerprints.get("index.ts")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("tracks every indexed path as changed since the initial index", () => {
    const engine = indexRepo(makeAuthRepo());
    expect(engine.changedPaths).toHaveLength(7);
  });

  it("maps extensions to source languages", () => {
    const engine = indexRepo(makeAuthRepo());
    expect(engine.getFile("index.ts").language).toBe("typescript");
  });

  it("registers unparsable files without parsing them", () => {
    const engine = indexRepo({ "notes.md": "# readme\n", "util.ts": "export const x = 1;" });
    expect(engine.getFile("notes.md").isParsed).toBe(false);
    expect(engine.getFile("util.ts").isParsed).toBe(true);
  });

  it("normalizes leading ./ segments on lookup", () => {
    const engine = indexRepo(makeAuthRepo());
    expect(engine.hasFile("./auth/token.ts")).toBe(true);
    expect(engine.getFile("./auth/token.ts").path).toBe("auth/token.ts");
  });

  it("is deterministic across repeated identical indexes", () => {
    const a = indexRepo(makeAuthRepo());
    const b = indexRepo(makeAuthRepo());
    expect(a.symbolCount).toBe(b.symbolCount);
    expect(a.fileCount).toBe(b.fileCount);
  });
});

describe("file lookup", () => {
  it("returns source content via getFile", () => {
    const engine = indexRepo(makeAuthRepo());
    expect(engine.getFile("auth/types.ts").content).toContain("AuthConfig");
  });

  it("throws FileNotFoundError for unknown files", () => {
    const engine = indexRepo(makeAuthRepo());
    expect(() => engine.getFile("missing.ts")).toThrow(FileNotFoundError);
    expect(() => engine.getFile("missing.ts")).toThrow(/not found/i);
  });

  it("hasFile answers membership without throwing", () => {
    const engine = indexRepo(makeAuthRepo());
    expect(engine.hasFile("index.ts")).toBe(true);
    expect(engine.hasFile("nope.ts")).toBe(false);
  });

  it("throws IndexNotReadyError before indexing", async () => {
    const engine = new RepositoryContextService();
    expect(engine.isIndexed).toBe(false);
    expect(() => engine.getFile("index.ts")).toThrow(IndexNotReadyError);
    expect(() => engine.buildContext("foo")).toThrow(IndexNotReadyError);
    expect(() => engine.search("foo")).toThrow(IndexNotReadyError);
    expect(engine.fileCount).toBe(0);
    expect(engine.symbolCount).toBe(0);
    await expect(engine.refresh(new Map())).rejects.toThrow();
  });
});

describe("symbol lookup via the service", () => {
  const engine = indexRepo(makeAuthRepo());

  it("findSymbol returns matching definitions", () => {
    const result = engine.findSymbol("AuthService");
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("class");
  });

  it("findDefinition resolves a symbol", () => {
    const defs = engine.findDefinition("parseToken");
    expect(defs[0]?.filePath).toBe("auth/token.ts");
  });

  it("findReferences surfaces heritage relations", () => {
    const refs = engine.findReferences("Logger");
    expect(refs.some((r) => r.kind === "implements")).toBe(true);
  });

  it("findImplementations resolves same-file implementors", () => {
    const impls = engine.findImplementations("Logger");
    expect(impls.map((i) => i.source.name)).toContain("ConsoleLogger");
  });

  it("findCallers reports hierachical callers", () => {
    const callers = engine.findCallers("Logger");
    expect(callers.some((c) => c.source.name === "ConsoleLogger")).toBe(true);
  });

  it("findSymbolsInFile filters by file", () => {
    const names = engine.findSymbolsInFile("core/logger.ts").map((s) => s.name);
    expect(names).toContain("Logger");
  });
});

describe("buildContext - the context builder", () => {
  const engine = indexRepo(makeAuthRepo());

  it("returns the top-ranked auth file for an auth query", () => {
    const ctx = engine.buildContext("authentication");
    expect(ctx.files.length).toBeGreaterThan(0);
    expect(ctx.files[0]?.filePath).toContain("auth");
  });

  it("never exceeds the configured token budget", () => {
    const ctx = engine.buildContext("token", { tokenBudget: 500 });
    expect(ctx.tokenUsed).toBeLessThanOrEqual(ctx.tokenBudget);
    expect(ctx.tokenBudget).toBe(500);
  });

  it("returns symbols matched to a symbol query", () => {
    const ctx = engine.buildContext("authService");
    expect(ctx.symbols.some((s) => s.name === "AuthService")).toBe(true);
  });

  it("includes dependency chains of the top file", () => {
    const ctx = engine.buildContext("authentication");
    expect(ctx.dependencyChain.length).toBeGreaterThanOrEqual(2);
  });

  it("defaults to the DEFAULT_LIMITS token budget when unspecified", () => {
    const ctx = engine.buildContext("authentication");
    expect(ctx.tokenBudget).toBe(DEFAULT_LIMITS.tokenBudget);
  });

  it("limits file and symbol counts through options", () => {
    const ctx = engine.buildContext("authentication", { maxFiles: 2, maxSymbols: 4 });
    expect(ctx.files.length).toBeLessThanOrEqual(2);
    expect(ctx.symbols.length).toBeLessThanOrEqual(4);
  });

  it("reports related interfaces when enabled", () => {
    const ctx = engine.buildContext("auth", { includeRelatedInterfaces: true });
    expect(ctx.relatedInterfaces.length).toBeGreaterThanOrEqual(1);
    expect(ctx.relatedInterfaces.every((s) => s.kind === "interface")).toBe(true);
  });

  it("omits related interfaces when disabled", () => {
    const ctx = engine.buildContext("auth", { includeRelatedInterfaces: false });
    expect(ctx.relatedInterfaces).toEqual([]);
  });

  it("throws InvalidQueryError for an empty query", () => {
    expect(() => engine.buildContext("   ")).toThrow(InvalidQueryError);
    expect(() => engine.buildContext("")).toThrow(InvalidQueryError);
  });

  it("throws InvalidQueryError for a query with no tokens", () => {
    expect(() => engine.buildContext("...")).toThrow(InvalidQueryError);
  });

  it("gives recently changed files a ranking boost", () => {
    const ctx = engine.buildContext("auth", {
      recentlyChangedFiles: ["core/hasher.ts"],
    });
    const hasherRank = ctx.files.findIndex((f) => f.filePath === "core/hasher.ts");
    expect(hasherRank).not.toBe(-1);
  });

  it("returns a deterministic context for the same input", () => {
    const a = engine.buildContext("authentication");
    const b = engine.buildContext("authentication");
    expect(a.files.map((f) => f.filePath)).toEqual(b.files.map((f) => f.filePath));
  });
});

describe("search", () => {
  it("returns ranked files and matched symbols for a free-text query", () => {
    const engine = indexRepo(makeAuthRepo());
    const result = engine.search("token");
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.symbols.some((s) => s.name === "parseToken")).toBe(true);
  });

  it("matches interface names across files", () => {
    const engine = indexRepo(makeAuthRepo());
    const result = engine.search("logger");
    expect(result.symbols.some((s) => s.name === "ConsoleLogger")).toBe(true);
  });

  it("is deterministic", () => {
    const engine = indexRepo(makeAuthRepo());
    const a = engine.search("auth");
    const b = engine.search("auth");
    expect(a.files.map((f) => f.filePath)).toEqual(b.files.map((f) => f.filePath));
  });

  it("accepts symbol names as queries", () => {
    const engine = indexRepo(makeAuthRepo());
    const result = engine.search("parseToken");
    expect(result.symbols).toHaveLength(1);
  });

  it("throws for an empty query", () => {
    const engine = indexRepo(makeAuthRepo());
    expect(() => engine.search("")).toThrow(InvalidQueryError);
  });
});

describe("related files", () => {
  it("returns folder siblings plus import graph neighbors", () => {
    const engine = indexRepo(makeAuthRepo());
    const related = engine.getRelatedFiles("auth/auth-service.ts");
    expect(related).toContain("auth/types.ts");
    expect(related).toContain("auth/token.ts");
    expect(related).toContain("auth/barrel.ts");
    expect(related).toContain("index.ts");
  });

  it("is deterministic and sorted", () => {
    const engine = indexRepo(makeAuthRepo());
    const a = engine.getRelatedFiles("core/logger.ts");
    const b = engine.getRelatedFiles("core/logger.ts");
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual(a);
  });
});

describe("dependency queries through the service", () => {
  it("finds dependencies of a file", () => {
    const engine = indexRepo(makeAuthRepo());
    const deps = engine.findDependencies("auth/auth-service.ts");
    expect(deps.map((d) => d.to)).toContain("auth/types.ts");
    expect(deps.map((d) => d.to)).toContain("auth/token.ts");
  });

  it("finds dependents of a file", () => {
    const engine = indexRepo(makeAuthRepo());
    const dependents = engine.findDependents("auth/types.ts");
    expect(dependents.map((d) => d.from)).toContain("auth/auth-service.ts");
  });

  it("exposes the import graph view", () => {
    const engine = indexRepo(makeAuthRepo());
    const view = engine.getDependencyView();
    expect(view.importGraph.get("auth/auth-service.ts")?.sort()).toEqual([
      "auth/token.ts",
      "auth/types.ts",
    ]);
  });

  it("throws FileNotFoundError for unknown dependency targets", () => {
    const engine = indexRepo(makeAuthRepo());
    expect(() => engine.findDependencies("ghost.ts")).toThrow(FileNotFoundError);
  });
});

describe("refresh and incremental indexing", () => {
  it("returns unchanged results when content is identical", async () => {
    const engine = indexRepo(makeLeafRepo());
    const same = engine.getFile("src/util.ts").content;
    const result = await engine.refresh(new Map([["src/util.ts", same]]));
    expect(result.reindexedFiles).toEqual([]);
    expect(result.totalFiles).toBe(1);
  });

  it("re-parses only the changed file on refresh", async () => {
    const engine = indexRepo(makeChainRepo());
    const changed = "export function mid() { return 1; }\n";
    const result = await engine.refresh(new Map([["src/mid.ts", changed]]));
    expect(result.reindexedFiles).toContain("src/mid.ts");
    expect(result.retainedFiles).toContain("src/entry.ts");
    expect(engine.getFile("src/mid.ts").content).toContain("function mid");
  });

  it("adds a brand new file through refresh", async () => {
    const engine = indexRepo(makeLeafRepo());
    const result = await engine.refresh(new Map([["src/extra.ts", "export const extra = 1;"]]));
    expect(result.reindexedFiles).toContain("src/extra.ts");
    expect(engine.fileCount).toBe(2);
    expect(engine.hasFile("src/extra.ts")).toBe(true);
  });

  it("rebuilds the symbol graph after refresh", async () => {
    const engine = indexRepo({ "src/a.ts": "export const alpha = 1;" });
    await engine.refresh(
      new Map([["src/a.ts", "export function alphaName(): string { return 'a'; }"]])
    );
    expect(engine.findSymbol("alphaName").length).toBe(1);
  });

  it("keeps the snapshot available after refresh", async () => {
    const engine = indexRepo(makeLeafRepo());
    await engine.refresh(new Map([["src/util.ts", "export const z = 2;"]]));
    expect(engine.isIndexed).toBe(true);
    expect(engine.fileCount).toBe(1);
    expect(engine.getFile("src/util.ts").content).toContain("z = 2");
  });

  it("throws when refresh is called before indexing", async () => {
    const engine = new RepositoryContextService();
    await expect(engine.refresh(new Map())).rejects.toThrow();
  });
});

describe("duplicate handling", () => {
  it("throws DuplicateFileError when the same file is indexed twice", () => {
    const engine = indexRepo(makeLeafRepo());
    expect(() =>
      engine.indexFromContents(new Map([["src/util.ts", "export const y = 2;"]]))
    ).toThrow(DuplicateFileError);
  });

  it("recognizes the duplicate via the cache", () => {
    const cache = new IncrementalCache();
    cache.register(new Map([["a.ts", "x"]]));
    expect(() => cache.register(new Map([["a.ts", "y"]]))).toThrow(DuplicateFileError);
  });

  it("refuses file paths that escape the repository root", () => {
    const engine = indexRepo({});
    expect(() => engine.indexFromContents(new Map([["../evil.ts", "x"]]))).toThrow();
  });
});

describe("cache implementation", () => {
  it("fingerprints are deterministic", () => {
    expect(fingerprint("hello")).toBe(fingerprint("hello"));
  });

  it("fingerprints are 8-character hex values", () => {
    expect(fingerprint("hello")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("fingerprints differentiate different content", () => {
    expect(fingerprint("a")).not.toBe(fingerprint("b"));
  });

  it("graphHash folds fingerprints in sorted order", () => {
    expect(graphHash(["b", "a"])).toBe(graphHash(["a", "b"]));
  });

  it("tracks fingerprint and AST hash per path", () => {
    const cache = new IncrementalCache();
    cache.set("src/a.ts", "abc");
    expect(cache.has("src/a.ts")).toBe(true);
    expect(cache.get("src/a.ts")).toBe(fingerprint("abc"));
    expect(cache.size).toBe(1);
  });

  it("invalidate removes a path", () => {
    const cache = new IncrementalCache();
    cache.set("a.ts", "1");
    cache.invalidate("a.ts");
    expect(cache.has("a.ts")).toBe(false);
  });

  it("diff classifies added, changed, removed and retained", () => {
    const cache = new IncrementalCache();
    cache.register(new Map([["a.ts", "a"], ["b.ts", "b"], ["c.ts", "c"]]));
    const next = new Map([
      ["a.ts", fingerprint("a")],
      ["b.ts", fingerprint("b-changed")],
      ["d.ts", fingerprint("d")],
    ]);
    const diff = cache.diff(next);
    expect(diff.added).toEqual(["d.ts"]);
    expect(diff.changed).toEqual(["b.ts"]);
    expect(diff.removed).toEqual(["c.ts"]);
    expect(diff.retained).toEqual(["a.ts"]);
  });

  it("records and updates the graph digest", () => {
    const cache = new IncrementalCache();
    const first = cache.recordGraphDigest(["one", "two"]);
    expect(cache.graphDigest).toBe(first);
    const second = cache.recordGraphDigest(["one", "two", "three"]);
    expect(cache.graphDigest).toBe(second);
    expect(second).not.toBe(first);
  });

  it("tracks a monotonic path list", () => {
    const cache = new IncrementalCache();
    cache.set("x.ts", "1");
    cache.set("y.ts", "2");
    expect(cache.paths.sort()).toEqual(["x.ts", "y.ts"]);
  });
});

describe("disk-based repositories", () => {
  async function makeTempRepo(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "ctx-engine-"));
    await mkdir(join(dir, "src"), { recursive: true });
    await mkdir(join(dir, "src", "domain"), { recursive: true });
    await writeFile(join(dir, "src", "index.ts"), "export const idx = 1;\n");
    await writeFile(join(dir, "src", "domain", "model.ts"), "export interface Model { id: number }\n");
    return dir;
  }

  it("indexes a real directory tree", async () => {
    const dir = await makeTempRepo();
    try {
      const engine = new RepositoryContextService();
      await engine.indexRepository(dir);
      expect(engine.fileCount).toBe(2);
      expect(engine.findSymbol("Model")[0]?.kind).toBe("interface");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("incrementally refreshes a changed file on disk", async () => {
    const dir = await makeTempRepo();
    try {
      const engine = new RepositoryContextService();
      await engine.indexRepository(dir);
      const modelPath = join(dir, "src", "domain", "model.ts");
      await writeFile(modelPath, "export interface Model { id: number; name: string }\n");
      const result = await engine.refreshRepository(dir);
      expect(result.reindexedFiles).toContain("src/domain/model.ts");
      expect(engine.findDefinition("Model").length).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports retained files across a no-op refresh", async () => {
    const dir = await makeTempRepo();
    try {
      const engine = new RepositoryContextService();
      await engine.indexRepository(dir);
      const result = await engine.refreshRepository(dir);
      expect(result.reindexedFiles).toEqual([]);
      expect(result.retainedFiles).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});