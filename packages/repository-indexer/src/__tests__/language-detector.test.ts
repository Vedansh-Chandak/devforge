import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createLanguageDetector,
  detectLanguage,
  type Language,
  type LanguageRule,
} from "../language-detector.js";

describe("language-detector", () => {
  describe("default rulebook", () => {
    const cases: ReadonlyArray<{ in: string; want: Language }> = [
      // TypeScript family.
      { in: "ts", want: "typescript" },
      { in: "cts", want: "typescript" },
      { in: "mts", want: "typescript" },
      { in: "d.ts", want: "typescript" },
      { in: "user.d.ts", want: "typescript" },
      // JSX/TSX.
      { in: "tsx", want: "tsx" },
      { in: "ctsx", want: "tsx" },
      { in: "mtsx", want: "tsx" },
      { in: "component.tsx", want: "tsx" },
      { in: "jsx", want: "jsx" },
      { in: "cjsx", want: "jsx" },
      { in: "mjsx", want: "jsx" },
      // JavaScript.
      { in: "js", want: "javascript" },
      { in: "cjs", want: "javascript" },
      { in: "mjs", want: "javascript" },
      // Data.
      { in: "json", want: "json" },
      { in: "jsonc", want: "json" },
      // Markup.
      { in: "md", want: "markdown" },
      { in: "markdown", want: "markdown" },
      { in: "mdx", want: "markdown" },
      { in: "html", want: "html" },
      { in: "htm", want: "html" },
      // Styling.
      { in: "css", want: "css" },
      // Out of scope.
      { in: "py", want: "unknown" },
      { in: "rs", want: "unknown" },
      { in: "exe", want: "unknown" },
      { in: "", want: "unknown" },
    ];

    for (const { in: input, want } of cases) {
      it(`detects "${input}" as "${want}"`, () => {
        assert.equal(detectLanguage(input), want);
      });
    }
  });

  describe("input normalization", () => {
    it("lowercases the extension", () => {
      assert.equal(detectLanguage("TS"), "typescript");
    });
    it("trims whitespace", () => {
      assert.equal(detectLanguage("  ts  "), "typescript");
    });
    it("strips leading dot", () => {
      assert.equal(detectLanguage(".json"), "json");
    });
    it("handles uppercase + dot combo", () => {
      assert.equal(detectLanguage(".TS"), "typescript");
    });
  });

  describe("factory options", () => {
    it("uses custom rules when supplied (replacing defaults)", () => {
      const custom: ReadonlyArray<LanguageRule> = [
        { extension: "kdl", language: "yaml" },
      ];
      const detector = createLanguageDetector({ rules: custom });
      // Defaults are gone; known extensions now report "unknown"
      // because the engine considers ONLY the supplied booklet.
      assert.equal(detector.detect("ts"), "unknown");
      assert.equal(detector.detect("kdl"), "yaml");
    });

    it("appends overrides on top of defaults and wins on conflict", () => {
      const detector = createLanguageDetector({
        overrides: [{ extension: "x-special", language: "markdown" }],
      });
      assert.equal(detector.detect("x-special"), "markdown");
      // Defaults still resolve typescript for `.ts`.
      assert.equal(detector.detect("ts"), "typescript");
    });

    it("overrides can promote an extension to a real language", () => {
      const detector = createLanguageDetector({
        overrides: [{ extension: "py", language: "yaml" }],
      });
      assert.equal(detector.detect("py"), "yaml");
    });

    it("custom subclass: rules + overrides compose", () => {
      const detector = createLanguageDetector({
        rules: [{ extension: "go", language: "typescript" }],
      });
      assert.equal(detector.detect("go"), "typescript");
      assert.equal(detector.detect("ts"), "unknown"); // defaults replaced
      assert.equal(detector.detect("yaml"), "unknown"); // not in custom booklet
    });
  });

  describe("frozen post-construction", () => {
    it("the returned detector is frozen", () => {
      const detector = createLanguageDetector();
      assert.equal(Object.isFrozen(detector), true);
    });
  });

  describe("performance", () => {
    it("is fast for many calls", () => {
      const detector = createLanguageDetector();
      const inputs: ReadonlyArray<string> = ["ts", "tsx", "json", "html", "css", "py", "rs", "mdx"];
      const N = 1_000_000;
      const t0 = performance.now();
      let sink: Language = "unknown";
      for (let i = 0; i < N; i++) {
        sink = detector.detect(inputs[i % inputs.length]!);
      }
      const elapsed = performance.now() - t0;
      // Reference the sink so the optimizer can't elide the loop.
      assert.equal(typeof sink, "string");
      // Conservative ceiling: 200ms for 1M calls on commodity laptops.
      assert.ok(
        elapsed < 200,
        `detector too slow: ${elapsed.toFixed(2)}ms for ${N} calls`,
      );
    });
  });
});
