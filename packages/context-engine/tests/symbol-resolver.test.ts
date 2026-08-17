import { describe, it, expect } from "vitest";
import { SymbolResolver } from "../src/index.js";
import type { RepositoryIndex } from "../src/index.js";
import { indexRepo, makeAuthRepo } from "./helpers.js";

function resolverFor(files: Record<string, string>): SymbolResolver {
  const engine = indexRepo(files);
  return new SymbolResolver(engine.index as RepositoryIndex);
}

describe("allSymbols", () => {
  const resolver = resolverFor(makeAuthRepo());

  it("collects symbols of every supported kind", () => {
    const kinds = new Set(resolver.allSymbols().map((s) => s.kind));
    for (const k of ["interface", "class", "function"]) {
      expect(kinds.has(k)).toBe(true);
    }
  });

  it("excludes synthetic file-namespace wrappers from the symbol list", () => {
    const names = resolver.allSymbols().map((s) => s.name);
    expect(names.filter((n) => n.includes("/")).length).toBe(0);
  });

  it("is deterministic across calls", () => {
    const a = resolver.allSymbols().map((s) => `${s.filePath}:${s.name}`);
    const b = resolver.allSymbols().map((s) => `${s.filePath}:${s.name}`);
    expect(a).toEqual(b);
  });

  it("includes member symbols as qualified names", () => {
    expect(resolver.allSymbols().some((s) => s.name === "AuthService.authenticate")).toBe(true);
  });

  it("exposes no synthetic module-namespace symbols", () => {
    expect(resolver.moduleSymbols()).toEqual([]);
  });
});

describe("findSymbol", () => {
  const resolver = resolverFor(makeAuthRepo());

  it("finds an exact class by name", () => {
    const result = resolver.findSymbol("AuthService");
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("class");
    expect(result[0]?.filePath).toBe("auth/auth-service.ts");
  });

  it("finds an interface by name", () => {
    const result = resolver.findSymbol("Logger");
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("interface");
  });

  it("finds a function by name", () => {
    const result = resolver.findSymbol("sha256");
    expect(result).toHaveLength(1);
  });

  it("returns an empty list for an unknown name", () => {
    expect(resolver.findSymbol("MissingSymbol")).toEqual([]);
  });

  it("matches on qualified member names", () => {
    const result = resolver.findSymbol("AuthService.authenticate");
    expect(result.at(0)?.name).toBe("AuthService.authenticate");
  });

  it("is case-sensitive exact lookup", () => {
    expect(resolver.findSymbol("authservice")).toEqual([]);
  });
});

describe("searchSymbols", () => {
  const resolver = resolverFor(makeAuthRepo());

  it("finds symbols by case-insensitive substring", () => {
    const result = resolver.searchSymbols("token");
    expect(result.some((s) => s.name === "parseToken")).toBe(true);
    expect(result.some((s) => s.name === "TokenParser")).toBe(true);
  });

  it("returns nothing for an unmatched substring", () => {
    expect(resolver.searchSymbols("zzz-none")).toEqual([]);
  });

  it("is deterministic", () => {
    expect(resolver.searchSymbols("token").map((s) => s.name)).toEqual(
      resolver.searchSymbols("token").map((s) => s.name)
    );
  });
});

describe("findDefinition", () => {
  const resolver = resolverFor(makeAuthRepo());

  it("resolves the exact definition of a symbol", () => {
    const defs = resolver.findDefinition("parseToken");
    expect(defs).toHaveLength(1);
    expect(defs[0]?.name).toBe("parseToken");
  });

  it("returns all matching declarations when names collide across files", () => {
    const files = {
      "a.ts": "export class value {}\n",
      "b.ts": "export function value(): number { return 2; }\n",
      "c.ts": "export interface value { x: number }\n",
    };
    const defs = resolverFor(files).findDefinition("value");
    expect(defs.length).toBeGreaterThanOrEqual(2);
  });

  it("resolves qualified member definitions", () => {
    const defs = resolver.findDefinition("AuthService.parser");
    expect(defs.at(0)?.name).toBe("AuthService.parser");
  });

  it("returns an empty list for unknown names", () => {
    expect(resolver.findDefinition("nope")).toEqual([]);
  });
});

describe("findReferences", () => {
  const resolver = resolverFor(makeAuthRepo());

  it("reports heritage relations as references", () => {
    const refs = resolver.findReferences("Logger");
    const withImplements = refs.filter((r) => r.kind === "implements");
    expect(withImplements.map((r) => r.source.name)).toContain("ConsoleLogger");
  });

  it("returns empty references for a cross-file imported symbol", () => {
    expect(resolver.findReferences("AuthResult")).toEqual([]);
  });

  it("returns references that point at the target symbol", () => {
    const refs = resolver.findReferences("TokenParser");
    for (const ref of refs) {
      expect(ref.target.name).toBe("TokenParser");
    }
  });

  it("returns a stable ordering of references", () => {
    const a = resolver.findReferences("Logger");
    const b = resolver.findReferences("Logger");
    expect(a).toEqual(b);
  });
});

describe("findImplementations", () => {
  const files = {
    "renderer.ts": `
export interface Renderer {
  render(): string;
}
export class SvgRenderer implements Renderer {
  render(): string {
    return "<svg>";
  }
}
export class CanvasRenderer implements Renderer {
  render(): string {
    return "canvas";
  }
}
`,
  };
  const resolver = resolverFor(files);

  it("finds classes implementing an interface in the same file", () => {
    const impls = resolver.findImplementations("Renderer");
    expect(impls.map((i) => i.source.name).sort()).toEqual([
      "CanvasRenderer",
      "SvgRenderer",
    ]);
    expect(impls.every((i) => i.kind === "implements")).toBe(true);
  });

  it("returns nothing for a symbol nothing implements", () => {
    expect(resolver.findImplementations("SvgRenderer")).toEqual([]);
  });

  it("returns nothing for an unknown symbol", () => {
    expect(resolver.findImplementations("Ghost")).toEqual([]);
  });

  it("reports implementations deterministically", () => {
    const a = resolver.findImplementations("Renderer");
    const b = resolver.findImplementations("Renderer");
    expect(a).toEqual(b);
  });
});

describe("findCallers", () => {
  const resolver = resolverFor(makeAuthRepo());

  it("reports caller relations via heritage edges", () => {
    const callers = resolver.findCallers("Logger");
    const sources = callers.map((c) => c.source.name);
    expect(sources).toContain("ConsoleLogger");
  });

  it("returns empty relations for symbols with no callers", () => {
    expect(resolver.findCallers("sha256")).toEqual([]);
  });
});

describe("findSymbolsInFile / findExports", () => {
  const resolver = resolverFor(makeAuthRepo());

  it("lists all symbols declared in a file", () => {
    const names = resolver.findSymbolsInFile("auth/token.ts").map((s) => s.name);
    expect(names).toContain("JwtParser");
    expect(names).toContain("parseToken");
  });

  it("returns empty for an unknown file", () => {
    expect(resolver.findSymbolsInFile("unknown.ts")).toEqual([]);
  });

  it("includes member symbols in the file listing", () => {
    const names = resolver.findSymbolsInFile("auth/auth-service.ts").map((s) => s.name);
    expect(names).toContain("AuthService");
    expect(names).toContain("AuthService.authenticate");
  });

  it("reports declared exports of a file", () => {
    const names = resolver.findExports("auth/token.ts").map((s) => s.name);
    expect(names).toContain("JwtParser");
    expect(names).toContain("parseToken");
  });

  it("reports re-exports from a barrel", () => {
    const names = resolver.findExports("auth/barrel.ts").map((s) => s.name);
    expect(names).toContain("AuthService");
    expect(names).toContain("JwtParser");
  });

  it("returns empty for an unknown file's exports", () => {
    expect(resolver.findExports("unknown.ts")).toEqual([]);
  });
});

describe("export flag tracking", () => {
  it("marks exported symbols as exported", () => {
    const resolver = resolverFor(makeAuthRepo());
    const authService = resolver.findSymbol("AuthService")[0];
    expect(authService?.exported).toBe(true);
  });

  it("marks non-exported helper symbols as not exported", () => {
    const files = {
      "a.ts": `
function internal(): void {}
export function publicFn(): void { return internal(); }
`,
    };
    const internal = resolverFor(files).findSymbol("internal")[0];
    expect(internal?.exported).toBe(false);
  });

  it("tracks exported members for interfaces", () => {
    const files = {
      "a.ts": `
export interface Shape { area(): number }
export class Circle implements Shape { area(): number { return 0; } }
`,
    };
    const r = resolverFor(files);
    const shape = r.findSymbol("Shape")[0];
    expect(shape?.exported).toBe(true);
    const impls = r.findImplementations("Shape");
    expect(impls.map((i) => i.source.name)).toContain("Circle");
  });
});

describe("supported symbol kinds via the parser pipeline", () => {
  const files = {
    "kinds.ts": `
export enum Level { LOW = 1, HIGH = 2 }
export interface Spec { level: Level }
export type Maybe = string | null;
export class Widget {
  build(): Maybe { return null; }
}
`,
  };

  const r = resolverFor(files);

  it("resolves enums", () => {
    expect(r.findSymbol("Level").at(0)?.kind).toBe("enum");
  });

  it("resolves type aliases", () => {
    expect(r.findSymbol("Maybe").at(0)?.kind).toBe("type-alias");
  });

  it("resolves interfaces", () => {
    expect(r.findSymbol("Spec").at(0)?.kind).toBe("interface");
  });

  it("resolves classes", () => {
    const result = r.findSymbol("Widget");
    expect(result.at(0)?.kind).toBe("class");
  });

  it("resolves enum members as variables", () => {
    expect(r.allSymbols().some((s) => s.name === "Level.LOW")).toBe(true);
  });

  it("keeps interface and class member symbols in the graph", () => {
    expect(r.findSymbol("Widget.build").at(0)?.name).toBe("Widget.build");
    expect(r.findSymbol("Spec.level").at(0)?.name).toBe("Spec.level");
  });
});

describe("empty index behavior", () => {
  it("returns no symbols for an empty repository", () => {
    const resolver = resolverFor({});
    expect(resolver.allSymbols()).toEqual([]);
    expect(resolver.moduleSymbols()).toEqual([]);
  });
});