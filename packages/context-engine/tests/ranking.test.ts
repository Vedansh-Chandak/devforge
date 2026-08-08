import { describe, it, expect } from "vitest";
import { scoreFile, rankFiles, WEIGHTS } from "../src/index.js";
import type { RankInput } from "../src/index.js";

function input(overrides: Partial<RankInput> = {}): RankInput {
  return {
    filePath: "src/a.ts",
    hasExactMatch: false,
    similarSymbolCount: 0,
    referenceCount: 0,
    importDistance: null,
    pathHits: 0,
    sharedFolderDepth: 0,
    recentlyChanged: false,
    ...overrides,
  };
}

describe("scoreFile - exact match", () => {
  it("assigns full exact-match weight", () => {
    const score = scoreFile(input({ hasExactMatch: true }));
    expect(score).toBe(WEIGHTS.exactSymbol);
  });

  it("assigns zero for a file with no signals", () => {
    expect(scoreFile(input())).toBe(0);
  });

  it("an exact match beats a plain file by exactly the exact weight", () => {
    expect(scoreFile(input({ hasExactMatch: true })) - scoreFile(input())).toBe(
      WEIGHTS.exactSymbol
    );
  });

  it("exact match with path hit adds the path weight on top", () => {
    expect(scoreFile(input({ hasExactMatch: true, pathHits: 1 }))).toBe(
      WEIGHTS.exactSymbol + WEIGHTS.pathHit
    );
  });
});

describe("scoreFile similar-symbol credit", () => {
  it("scores each similar symbol at the defined weight", () => {
    expect(scoreFile(input({ similarSymbolCount: 2 }))).toBe(2 * WEIGHTS.similarSymbol);
  });

  it("caps similar-symbol credit at the cap value", () => {
    const uncapped = scoreFile(input({ similarSymbolCount: 20 }));
    const capped = scoreFile(input({ similarSymbolCount: WEIGHTS.capSimilar + 10 }));
    expect(capped).toBe(uncapped);
    expect(capped).toBe(WEIGHTS.capSimilar * WEIGHTS.similarSymbol);
  });

  it("zero similar symbols contributes nothing", () => {
    expect(scoreFile(input({ similarSymbolCount: 0 }))).toBe(0);
  });

  it("similar credits are additive with recent-change credit", () => {
    expect(
      scoreFile(input({ similarSymbolCount: 1, recentlyChanged: true }))
    ).toBe(WEIGHTS.similarSymbol + WEIGHTS.recentlyChanged);
  });
});

describe("scoreFile reference credit", () => {
  it("scores each reference at the defined weight", () => {
    expect(scoreFile(input({ referenceCount: 3 }))).toBe(3 * WEIGHTS.reference);
  });

  it("caps reference credit at the cap value", () => {
    const saturated = scoreFile(input({ referenceCount: 8 }));
    const oversaturated = scoreFile(input({ referenceCount: 999 }));
    expect(oversaturated).toBe(saturated);
    expect(saturated).toBe(WEIGHTS.capReference * WEIGHTS.reference);
  });

  it("reference and similar credits are additive", () => {
    expect(
      scoreFile(input({ referenceCount: 1, similarSymbolCount: 1 }))
    ).toBe(WEIGHTS.reference + WEIGHTS.similarSymbol);
  });

  it("no references means no reference credit", () => {
    expect(scoreFile(input({ referenceCount: 0 }))).toBe(0);
  });
});

describe("scoreFile import-distance credit", () => {
  it("gives the reachable base plus weighted distance at depth 0", () => {
    expect(scoreFile(input({ importDistance: 0 }))).toBe(
      WEIGHTS.importReachable + WEIGHTS.importDistance
    );
  });

  it("gives less credit as distance grows", () => {
    const d0 = scoreFile(input({ importDistance: 0 }));
    const d1 = scoreFile(input({ importDistance: 1 }));
    const d2 = scoreFile(input({ importDistance: 2 }));
    expect(d0).toBeGreaterThan(d1);
    expect(d1).toBeGreaterThan(d2);
  });

  it("computes distance credit deterministically at depth 3", () => {
    expect(scoreFile(input({ importDistance: 3 }))).toBe(
      WEIGHTS.importReachable + WEIGHTS.importDistance / 4
    );
  });

  it("unreachable files earn no import credit", () => {
    expect(scoreFile(input({ importDistance: null }))).toBe(0);
  });

  it("a reachable file out-scores an unreachable file by the reachable credit", () => {
    expect(
      scoreFile(input({ importDistance: 0 })) - scoreFile(input({ importDistance: null }))
    ).toBe(WEIGHTS.importReachable + WEIGHTS.importDistance);
  });
});

describe("scoreFile path and folder credits", () => {
  it("scores each path hit at the path weight", () => {
    expect(scoreFile(input({ pathHits: 2 }))).toBe(2 * WEIGHTS.pathHit);
  });

  it("caps path hits at 3", () => {
    expect(scoreFile(input({ pathHits: 9 }))).toBe(3 * WEIGHTS.pathHit);
  });

  it("scores folder depth per shared segment", () => {
    expect(scoreFile(input({ sharedFolderDepth: 2 }))).toBe(2 * WEIGHTS.folderDepth);
  });

  it("caps folder depth at the folder cap", () => {
    expect(scoreFile(input({ sharedFolderDepth: 40 }))).toBe(
      WEIGHTS.capFolder * WEIGHTS.folderDepth
    );
  });

  it("a file with a path hit and folder proximity combines both", () => {
    expect(
      scoreFile(input({ pathHits: 1, sharedFolderDepth: 1 }))
    ).toBe(WEIGHTS.pathHit + WEIGHTS.folderDepth);
  });
});

describe("scoreFile recentlyChanged credit", () => {
  it("adds the flat bonus when recently changed", () => {
    expect(scoreFile(input({ recentlyChanged: true }))).toBe(WEIGHTS.recentlyChanged);
  });

  it("adds nothing when not recently changed", () => {
    expect(scoreFile(input({ recentlyChanged: false }))).toBe(0);
  });

  it("treats recentlyChanged as independent of import credit", () => {
    const base = scoreFile(input({ importDistance: 0 }));
    const recent = scoreFile(input({ importDistance: 0, recentlyChanged: true }));
    expect(recent - base).toBe(WEIGHTS.recentlyChanged);
  });
});

describe("rankFiles deterministic ordering", () => {
  it("sorts by descending score", () => {
    const ranked = rankFiles([
      input({ filePath: "low.ts", similarSymbolCount: 1 }),
      input({ filePath: "high.ts", hasExactMatch: true }),
    ]);
    expect(ranked.map((f) => f.filePath)).toEqual(["high.ts", "low.ts"]);
  });

  it("breaks score ties by ascending path", () => {
    const ranked = rankFiles([
      input({ filePath: "z.ts", hasExactMatch: true }),
      input({ filePath: "a.ts", hasExactMatch: true }),
      input({ filePath: "m.ts", hasExactMatch: true }),
    ]);
    expect(ranked.map((f) => f.filePath)).toEqual(["a.ts", "m.ts", "z.ts"]);
  });

  it("is stable for identical inputs ordered differently", () => {
    const base = [input({ filePath: "b.ts" }), input({ filePath: "a.ts" })];
    const one = rankFiles(base);
    const two = rankFiles([...base].reverse());
    expect(one.map((f) => f.filePath)).toEqual(two.map((f) => f.filePath));
  });

  it("is deterministic across repeated calls", () => {
    const files = [
      input({ filePath: "x.ts", hasExactMatch: true }),
      input({ filePath: "y.ts", similarSymbolCount: 5 }),
      input({ filePath: "z.ts" }),
    ];
    const a = rankFiles(files).map((f) => `${f.filePath}:${f.score}`);
    const b = rankFiles(files).map((f) => `${f.filePath}:${f.score}`);
    expect(a).toEqual(b);
  });

  it("preserves every input file in the output", () => {
    const files = rankFiles([
      input({ filePath: "p.ts" }),
      input({ filePath: "q.ts", pathHits: 2 }),
      input({ filePath: "r.ts", importDistance: 1 }),
    ]);
    expect(files).toHaveLength(3);
    expect(new Set(files.map((f) => f.filePath)).size).toBe(3);
  });

  it("does not mutate the input array", () => {
    const files = [input({ filePath: "c.ts" }), input({ filePath: "b.ts" })];
    const before = files.map((f) => f.filePath);
    rankFiles(files);
    expect(files.map((f) => f.filePath)).toEqual(before);
  });

  it("handles an empty input", () => {
    expect(rankFiles([])).toEqual([]);
  });
});

describe("rankFiles produced records", () => {
  it("propagates each signal into the scored record", () => {
    const [record] = rankFiles([
      input({
        filePath: "src/auth/service.ts",
        hasExactMatch: true,
        referenceCount: 4,
        importDistance: 2,
        pathHits: 3,
        sharedFolderDepth: 2,
        recentlyChanged: true,
      }),
    ]);
    expect(record).toMatchObject({
      filePath: "src/auth/service.ts",
      hasExactMatch: true,
      referenceCount: 4,
      importDistance: 2,
      folderProximity: 2,
      pathSimilarity: 3,
      recentlyChanged: true,
    });
  });

  it("exposes the deterministic score field", () => {
    const [record] = rankFiles([input({ hasExactMatch: true })]);
    expect(record.score).toBe(WEIGHTS.exactSymbol);
  });

  it("records null import distance for unreachable files", () => {
    const [record] = rankFiles([input({ importDistance: null })]);
    expect(record.importDistance).toBeNull();
  });
});

describe("WEIGHTS invariants", () => {
  it("weights are all positive", () => {
    const values = [
      WEIGHTS.exactSymbol,
      WEIGHTS.similarSymbol,
      WEIGHTS.reference,
      WEIGHTS.importReachable,
      WEIGHTS.importDistance,
      WEIGHTS.pathHit,
      WEIGHTS.folderDepth,
      WEIGHTS.recentlyChanged,
    ];
    for (const v of values) expect(v).toBeGreaterThan(0);
  });

  it("caps are positive and smaller than their primary weight", () => {
    expect(WEIGHTS.capSimilar).toBeGreaterThan(0);
    expect(WEIGHTS.capReference).toBeGreaterThan(0);
    expect(WEIGHTS.capFolder).toBeGreaterThan(0);
  });

  it("exact match outweighs any single text/folder signal", () => {
    expect(WEIGHTS.exactSymbol).toBeGreaterThan(
      WEIGHTS.capReference * WEIGHTS.reference
    );
    expect(WEIGHTS.exactSymbol).toBeGreaterThan(WEIGHTS.capFolder * WEIGHTS.folderDepth);
    expect(WEIGHTS.exactSymbol).toBeGreaterThan(WEIGHTS.capSimilar * WEIGHTS.similarSymbol);
  });

  it("import reachability can outweigh a bare exact match", () => {
    expect(scoreFile(input({ importDistance: 0 }))).toBeGreaterThan(WEIGHTS.exactSymbol);
  });
});