import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  truncateToTokens,
  selectTopFiles,
  selectTopSymbols,
  selectTopDependencies,
  selectTopReferences,
  retrieveContents,
  retrieve,
  DEFAULT_LIMITS,
} from "../src/index.js";
import type { DependencyEdge, ResolvedRelation, ScoredFile, SymbolInfo } from "../src/index.js";

function scored(filePath: string, score = 0): ScoredFile {
  return {
    filePath,
    score,
    hasExactMatch: false,
    referenceCount: 0,
    importDistance: null,
    folderProximity: 0,
    pathSimilarity: 0,
    recentlyChanged: false,
  };
}

function symbol(name: string, filePath = "a.ts"): SymbolInfo {
  return {
    name,
    kind: "function",
    filePath,
    qualifiedName: name,
    declarationLocation: { start: 0, end: 1, line: 0, character: 0 },
    exported: true,
  };
}

function dep(edge: [string, string]): DependencyEdge {
  return { from: edge[0], to: edge[1], depth: 1 };
}

function rel(source: string): ResolvedRelation {
  const info = symbol(source);
  return { source: info, target: symbol("target"), kind: "calls" };
}

const lenTokens = (content: string): number => content.length;

describe("estimateTokens", () => {
  it("estimates ~1 token per 4 characters", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("rounds up partial groupings", () => {
    expect(estimateTokens("abcde")).toBe(2);
  });

  it("empty content is zero tokens", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("is deterministic", () => {
    expect(estimateTokens("const x = 1")).toBe(estimateTokens("const x = 1"));
  });
});

describe("truncateToTokens", () => {
  it("returns the full slice when within budget", () => {
    const result = truncateToTokens("hello", 10, lenTokens);
    expect(result.slice).toBe("hello");
    expect(result.tokenCount).toBe(5);
    expect(result.truncated).toBe(false);
  });

  it("returns empty for a zero budget on non-empty content", () => {
    const result = truncateToTokens("hello", 0, lenTokens);
    expect(result.slice).toBe("");
    expect(result.tokenCount).toBe(0);
    expect(result.truncated).toBe(true);
  });

  it("marks truncation when content exceeds budget", () => {
    const result = truncateToTokens("abc\ndef", 3, lenTokens);
    expect(result.truncated).toBe(true);
  });

  it("keeps whole lines up to the budget", () => {
    const result = truncateToTokens("one\ntwo\nthree", 8, lenTokens);
    expect(result.slice).toBe("one\ntwo");
    expect(result.tokenCount).toBe(8);
  });

  it("stops before a line that would overflow", () => {
    const result = truncateToTokens("a\nb\nccccc", 5, lenTokens);
    expect(result.slice).toBe("a\nb");
    expect(result.tokenCount).toBe(4);
    expect(result.truncated).toBe(true);
  });

  it("a single long line truncates to nothing", () => {
    const result = truncateToTokens("a-very-long-line", 4, lenTokens);
    expect(result.slice).toBe("");
    expect(result.truncated).toBe(true);
  });

  it("uses the estimateTokens default when none is supplied", () => {
    const result = truncateToTokens("12345678");
    expect(result.slice).toBe("12345678");
  });

  it("empty content with full budget is untruncated", () => {
    const result = truncateToTokens("", 10, lenTokens);
    expect(result.slice).toBe("");
    expect(result.truncated).toBe(false);
  });

  it("never exceeds the provided budget", () => {
    const budget = 7;
    const result = truncateToTokens("a\nbb\nccc\ndddd", budget, lenTokens);
    expect(result.tokenCount).toBeLessThanOrEqual(budget);
  });
});

describe("selectTopFiles", () => {
  it("selects the first max files in ranked order", () => {
    const files = [scored("a", 3), scored("b", 2), scored("c", 1)];
    expect(selectTopFiles(files, 2).map((f) => f.filePath)).toEqual(["a", "b"]);
  });

  it("selects all files when max exceeds the list", () => {
    const files = [scored("a"), scored("b")];
    expect(selectTopFiles(files, 10)).toHaveLength(2);
  });

  it("selects none for a zero max", () => {
    expect(selectTopFiles([scored("a")], 0)).toEqual([]);
  });

  it("selects none for a negative max", () => {
    expect(selectTopFiles([scored("a")], -3)).toEqual([]);
  });

  it("handles an empty ranked list", () => {
    expect(selectTopFiles([], 5)).toEqual([]);
  });
});

describe("selectTopSymbols", () => {
  it("selects the first max symbols", () => {
    const symbols = [symbol("a"), symbol("b"), symbol("c")];
    expect(selectTopSymbols(symbols, 2).map((s) => s.name)).toEqual(["a", "b"]);
  });

  it("selects all when max exceeds the list", () => {
    expect(selectTopSymbols([symbol("a"), symbol("b")], 99)).toHaveLength(2);
  });

  it("selects none for a zero max", () => {
    expect(selectTopSymbols([symbol("a")], 0)).toEqual([]);
  });

  it("handles an empty symbol list", () => {
    expect(selectTopSymbols([], 4)).toEqual([]);
  });
});

describe("selectTopDependencies", () => {
  it("selects the first max dependency edges", () => {
    const deps = [dep(["a", "b"]), dep(["b", "c"])];
    expect(selectTopDependencies(deps, 1)).toHaveLength(1);
  });

  it("selects none for a zero max", () => {
    expect(selectTopDependencies([dep(["a", "b"])], 0)).toEqual([]);
  });

  it("handles empty dependency arrays", () => {
    expect(selectTopDependencies([], 4)).toEqual([]);
  });
});

describe("selectTopReferences", () => {
  it("selects the first max relations", () => {
    const refs = [rel("a"), rel("b")];
    expect(selectTopReferences(refs, 1)).toHaveLength(1);
  });

  it("selects none for a zero max", () => {
    expect(selectTopReferences([rel("a")], 0)).toEqual([]);
  });

  it("handles empty reference arrays", () => {
    expect(selectTopReferences([], 3)).toEqual([]);
  });
});

describe("retrieveContents", () => {
  const ranked = [scored("a", 3), scored("b", 2), scored("c", 1)];
  const provider = (p: string): string | undefined =>
    ({ "a": "aaaa", "b": "bb", "c": "c" })[p];
  const charTokens = (c: string): number => c.length;

  it("pulls full slices while inside the budget", () => {
    const result = retrieveContents(ranked, 3, 30, provider, charTokens);
    expect(result.contents.map((c) => c.filePath)).toEqual(["a", "b", "c"]);
    expect(result.tokenUsed).toBe(7);
    expect(result.truncated).toBe(false);
  });

  it("stops adding slices once the token budget is exhausted", () => {
    const many = Array.from({ length: 10 }, (_, i) => scored(`f${i}.ts`, 100 - i));
    const onceChar = (c: string): number => c.length;
    const result = retrieveContents(many, 10, 8, (p) => "x", onceChar);
    expect(result.contents).toHaveLength(8);
    expect(result.tokenUsed).toBe(8);
    expect(result.truncated).toBe(true);
  });

  it("respects maxFiles even when budget allows more", () => {
    const result = retrieveContents(ranked, 2, 100, provider, charTokens);
    expect(result.contents).toHaveLength(2);
  });

  it("skips files whose content is undefined", () => {
    const result = retrieveContents(ranked, 10, 100, () => undefined, charTokens);
    expect(result.contents).toEqual([]);
    expect(result.tokenUsed).toBe(0);
  });

  it("uses the default token estimator when none is supplied", () => {
    const result = retrieveContents(ranked, 10, 100, provider);
    expect(result.tokenUsed).toBe(3);
  });

  it("trims a file to the remaining budget when it would overflow", () => {
    const big = [scored("big.ts")];
    const result = retrieveContents(big, 1, 4, () => "1234567890", charTokens);
    expect(result.contents[0]?.tokenCount).toBeLessThanOrEqual(4);
  });

  it("empty ranked list yields nothing", () => {
    const result = retrieveContents([], 5, 100, provider, charTokens);
    expect(result.contents).toEqual([]);
    expect(result.tokenUsed).toBe(0);
  });
});

describe("retrieve (integration)", () => {
  const files = Array.from({ length: 30 }, (_, i) => scored(`f${i}.ts`, 100 - i));
  const symbols = Array.from({ length: 50 }, (_, i) => symbol(`S${i}`));
  const deps = Array.from({ length: 80 }, (_, i) => dep([`n${i}`, `n${i + 1}`]));

  it("caps files at the configured maxFiles", () => {
    const result = retrieve({
      ranked: files,
      symbols: [],
      dependencies: [],
      references: [],
      contentProvider: () => undefined,
      limits: { maxFiles: 5 },
    });
    expect(result.files).toHaveLength(5);
  });

  it("caps symbols at the configured maxSymbols", () => {
    const result = retrieve({
      ranked: [],
      symbols,
      dependencies: [],
      references: [],
      contentProvider: () => undefined,
      limits: { maxSymbols: 3 },
    });
    expect(result.symbols).toHaveLength(3);
  });

  it("caps dependencies and references separately", () => {
    const result = retrieve({
      ranked: [],
      symbols: [],
      dependencies: deps,
      references: [rel("r1"), rel("r2"), rel("r3")],
      contentProvider: () => undefined,
      limits: { maxDependencies: 4, maxReferences: 2 },
    });
    expect(result.dependencies).toHaveLength(4);
    expect(result.references).toHaveLength(2);
  });

  it("applies defaults for omitted limits", () => {
    const result = retrieve({
      ranked: files,
      symbols: [],
      dependencies: [],
      references: [],
      contentProvider: () => undefined,
    });
    expect(result.files).toHaveLength(DEFAULT_LIMITS.maxFiles);
    expect(result.tokenBudget).toBe(DEFAULT_LIMITS.tokenBudget);
  });

  it("reports the total token budget and usage", () => {
    const result = retrieve({
      ranked: [],
      symbols: [],
      dependencies: [],
      references: [],
      contentProvider: () => undefined,
      limits: { tokenBudget: 1234 },
    });
    expect(result.tokenBudget).toBe(1234);
    expect(result.tokenUsed).toBe(0);
  });

  it("is deterministic across repeated calls", () => {
    const options = {
      ranked: files,
      symbols,
      dependencies: deps,
      references: [rel("r")],
      contentProvider: () => undefined,
      limits: { maxFiles: 5, maxSymbols: 5, maxDependencies: 5, maxReferences: 5 },
    };
    const a = retrieve(options);
    const b = retrieve(options);
    expect(a.files.map((f) => f.filePath)).toEqual(b.files.map((f) => f.filePath));
  });
});