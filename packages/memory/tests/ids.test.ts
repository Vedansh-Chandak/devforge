import { describe, expect, it } from "vitest";
import { sha256, shortHash, stableStringify, compare } from "../src/ids.js";

describe("sha256", () => {
  it("produces a 64-char hex digest", () => {
    expect(sha256("hello")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for identical input", () => {
    expect(sha256("abc")).toBe(sha256("abc"));
  });

  it("differs for different input", () => {
    expect(sha256("abc")).not.toBe(sha256("abd"));
  });

  it("handles empty string deterministically", () => {
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("shortHash", () => {
  it("truncates to the requested length", () => {
    expect(shortHash("long input")).toHaveLength(16);
    expect(shortHash("x", 8)).toHaveLength(8);
  });

  it("is deterministic", () => {
    expect(shortHash("input")).toBe(shortHash("input"));
  });
});

describe("stableStringify", () => {
  it("sorts object keys deterministically", () => {
    const a = stableStringify({ b: 1, a: 2, c: 3 });
    const b = stableStringify({ c: 3, b: 1, a: 2 });
    expect(a).toBe(b);
  });

  it("sorts nested keys recursively", () => {
    expect(stableStringify({ z: { x: 1, y: 2 } })).toBe(
      stableStringify({ z: { y: 2, x: 1 } }),
    );
  });

  it("preserves array order", () => {
    expect(stableStringify({ a: [1, 2, 3] })).not.toBe(
      stableStringify({ a: [3, 2, 1] }),
    );
  });

  it("is byte-identical across runs", () => {
    const value = { list: ["x", "y"], nested: { deep: true }, num: 42, nil: null };
    expect(stableStringify(value)).toBe(stableStringify(value));
  });

  it("serializes primitives through JSON semantics", () => {
    expect(stableStringify("s")).toBe('"s"');
    expect(stableStringify(7)).toBe("7");
    expect(stableStringify(true)).toBe("true");
    expect(stableStringify(null)).toBe("null");
  });

  it("handles empty objects and arrays", () => {
    expect(stableStringify({})).toBe("{}");
    expect(stableStringify([])).toBe("[]");
  });
});

describe("compare", () => {
  it("orders lexicographically", () => {
    expect(compare("a", "b")).toBeLessThan(0);
    expect(compare("b", "a")).toBeGreaterThan(0);
    expect(compare("a", "a")).toBe(0);
  });

  it("is a total order over ids", () => {
    const ids = ["9", "a", "A", "", "aa", "1"];
    const sorted = ids.slice().sort(compare);
    const again = ids.slice().sort(compare);
    expect(sorted).toEqual(again);
    expect(compare(sorted[0]!, sorted[sorted.length - 1]!)).toBeLessThanOrEqual(0);
  });
});