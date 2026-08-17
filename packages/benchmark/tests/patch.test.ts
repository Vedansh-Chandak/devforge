import { describe, expect, it } from "vitest";
import {
  applyPatch,
  lineCount,
  patchStats,
  patchToText,
  uniquePreserveSorted,
} from "../src/patch.js";
import type { FilePatch } from "../src/types.js";

const basic: FilePatch = {
  changes: [
    { path: "src/a.ts", before: "old", after: "new" },
    { path: "src/b.ts", after: "brand new" },
  ],
};

describe("applyPatch", () => {
  it("applies matching changes in place", () => {
    const files = { "src/a.ts": "old" };
    const applied = applyPatch(files, basic);
    expect(applied.applied).toBe(true);
    expect(files["src/a.ts"]).toBe("new");
    expect(files["src/b.ts"]).toBe("brand new");
    expect(applied.conflicts).toEqual([]);
  });

  it("records conflicts when before does not match", () => {
    const files = { "src/a.ts": "different" };
    const applied = applyPatch(files, basic);
    expect(applied.applied).toBe(false);
    expect(applied.conflicts).toEqual(["src/a.ts"]);
    expect(files["src/a.ts"]).toBe("different");
    expect(files["src/b.ts"]).toBe("brand new");
  });

  it("reports multiple conflicts sorted uniquely", () => {
    const patch: FilePatch = {
      changes: [
        { path: "z.ts", before: "x", after: "y" },
        { path: "a.ts", before: "x", after: "y" },
        { path: "a.ts", before: "x", after: "z" },
      ],
    };
    const applied = applyPatch({ "a.ts": "nope", "z.ts": "nope" }, patch);
    expect(applied.applied).toBe(false);
    expect(applied.conflicts).toEqual(["a.ts", "z.ts"]);
  });

  it("deletes files when after is undefined", () => {
    const files = { old: "1", stay: "2" };
    const applied = applyPatch(files, {
      changes: [{ path: "old", before: "1", after: undefined }],
    });
    expect(applied.applied).toBe(true);
    expect(files.old).toBeUndefined();
    expect(files.stay).toBe("2");
  });

  it("creates files when before is undefined", () => {
    const files: Record<string, string> = {};
    const applied = applyPatch(files, { changes: [{ path: "new", after: "1" }] });
    expect(applied.applied).toBe(true);
    expect(files.new).toBe("1");
  });

  it("applies an empty patch cleanly", () => {
    const result = applyPatch({}, { changes: [] });
    expect(result.applied).toBe(true);
    expect(result.changedPaths).toEqual([]);
  });

  it("changedPaths contains both changed and conflicted paths", () => {
    const result = applyPatch({ "a.ts": "nope" }, {
      changes: [
        { path: "ok", after: "1" },
        { path: "a.ts", before: "x", after: "y" },
      ],
    });
    expect(result.changedPaths).toEqual(["a.ts", "ok"]);
  });
});

describe("uniquePreserveSorted", () => {
  it("deduplicates and sorts", () => {
    expect(uniquePreserveSorted(["c", "a", "c", "b"])).toEqual(["a", "b", "c"]);
  });

  it("returns an empty list for empty input", () => {
    expect(uniquePreserveSorted([])).toEqual([]);
  });

  it("keeps identical order for already-sorted unique input", () => {
    expect(uniquePreserveSorted(["a", "b"])).toEqual(["a", "b"]);
  });
});

describe("patchStats", () => {
  it("counts changed files uniquely", () => {
    const stats = patchStats({ changes: [{ path: "a", after: "1" }, { path: "a", after: "2" }] });
    expect(stats.filesChanged).toBe(1);
  });

  it("sums additions and deletions across changes", () => {
    const stats = patchStats({
      changes: [
        { path: "a", before: "x\ny\nz", after: "new" },
        { path: "b", after: "l1\nl2" },
      ],
    });
    expect(stats.deletions).toBe(3);
    expect(stats.additions).toBe(3);
    expect(stats.filesChanged).toBe(2);
  });

  it("counts a removal as deletion only", () => {
    const stats = patchStats({ changes: [{ path: "a", before: "1\n2", after: undefined }] });
    expect(stats.deletions).toBe(2);
    expect(stats.additions).toBe(0);
  });

  it("counts an addition as addition only", () => {
    const stats = patchStats({ changes: [{ path: "a", after: "1\n2\n3" }] });
    expect(stats.additions).toBe(3);
    expect(stats.deletions).toBe(0);
  });
});

describe("lineCount", () => {
  it("returns zero for an empty string", () => {
    expect(lineCount("")).toBe(0);
  });

  it("counts single-line strings as one", () => {
    expect(lineCount("abc")).toBe(1);
  });

  it("counts newline-separated lines", () => {
    expect(lineCount("a\nb")).toBe(2);
    expect(lineCount("a\nb\n")).toBe(3);
  });
});

describe("patchToText", () => {
  it("renders deterministic sorted diff sections", () => {
    const text = patchToText(basic);
    expect(text).toContain("diff --git a/src/a.ts b/src/a.ts");
    expect(text).toContain("diff --git a/src/b.ts b/src/b.ts");
    expect(text).toContain("-old");
    expect(text).toContain("+new");
  });

  it("is identical for identical patches", () => {
    const copy: FilePatch = JSON.parse(JSON.stringify(basic));
    expect(patchToText(basic)).toBe(patchToText(copy));
  });

  it("orders changes by path regardless of input order", () => {
    const shuffled: FilePatch = { changes: [{ path: "z", after: "1" }, { path: "a", after: "2" }] };
    const text = patchToText(shuffled);
    expect(text.indexOf("a/z")).toBeGreaterThan(text.indexOf("a/a"));
  });
});