/**
 * Language Detection Module.
 *
 * Decision-only module: maps a file extension to a canonical `Language`.
 *
 *  - Zero I/O. Zero parsing. No filesystem calls.
 *  - Independent of the parser, walker, ignore engine, metadata engine, AI.
 *  - One canonical input shape: the extension WITHOUT a leading dot.
 *    (`FileMetadata.extension` already strips the dot; we normalize again
 *    for caller forgiveness.)
 *  - Easy to extend: callers can replace or override the rule book.
 *  - Output is a discriminated string-literal union, including an explicit
 *    `"unknown"` so callers never need to distinguish "no match" from
 *    "match" via sentinel values.
 */

export type Language =
  | "typescript"
  | "javascript"
  | "tsx"
  | "jsx"
  | "json"
  | "markdown"
  | "yaml"
  | "html"
  | "css"
  | "unknown";

/**
 * A single rule. `extension` is the suffix matched against the normalized
 * basename. Compound suffixes like `"d.ts"` are first-class — they match `"foo.d.ts"`.
 */
export interface LanguageRule {
  readonly extension: string;
  readonly language: Language;
}

export interface LanguageDetectorOptions {
  /**
   * Replace the default rulebook entirely. Mutually compatible with `overrides`
   * which layer on top.
   */
  readonly rules?: ReadonlyArray<LanguageRule>;
  /**
   * Append (or override by `extension`) onto the effective rulebook. Wins on
   * conflict. Compound suffixes like `"d.ts"` are checked against `'foo.d.ts'`
   * verbatim.
   */
  readonly overrides?: ReadonlyArray<LanguageRule>;
}

export interface LanguageDetector {
  detect(extension: string): Language;
}

/**
 * Default rulebook. Frozen at module load.
 *
 * Order matters ONLY for debuggability — detection is exact-match against the
 * normalized suffix, not a fuzzy cascade. Sliding a newer rule in front of
 * an old one with the same extension lets you override cleanly, but the
 * recommended path is to use `LanguageDetectorOptions.overrides`.
 */
const DEFAULT_LANGUAGE_RULES: ReadonlyArray<LanguageRule> = Object.freeze([
  // Compound TSX/JSX idioms first to win against ".ts"/".js".
  { extension: "ts.tsx", language: "tsx" },
  { extension: "tsx", language: "tsx" },
  { extension: "ctsx", language: "tsx" },
  { extension: "mtsx", language: "tsx" },
  { extension: "js.jsx", language: "jsx" },
  { extension: "jsx", language: "jsx" },
  { extension: "cjsx", language: "jsx" },
  { extension: "mjsx", language: "jsx" },

  // Ambient declarations and `.config.ts`-style files are TypeScript.
  { extension: "d.ts", language: "typescript" },
  { extension: "cts", language: "typescript" },
  { extension: "mts", language: "typescript" },
  { extension: "ts", language: "typescript" },

  // JavaScript flavors.
  { extension: "cjs", language: "javascript" },
  { extension: "mjs", language: "javascript" },
  { extension: "js", language: "javascript" },

  // Data / Markup / Styling.
  { extension: "json", language: "json" },
  { extension: "jsonc", language: "json" },
  { extension: "md", language: "markdown" },
  { extension: "mdx", language: "markdown" },
  { extension: "markdown", language: "markdown" },
  { extension: "yml", language: "yaml" },
  { extension: "yaml", language: "yaml" },
  { extension: "html", language: "html" },
  { extension: "htm", language: "html" },
  { extension: "css", language: "css" },
]);

function normalizeExtension(input: string): string {
  return input.trim().toLowerCase().replace(/^\./, "");
}

function checkRule(extension: string, rule: LanguageRule): boolean {
  if (rule.extension === extension) return true;
  // Suffix match: `foo.d.ts` should match rule `d.ts`.
  if (extension.endsWith("." + rule.extension)) return true;
  return false;
}

export function createLanguageDetector(
  options?: LanguageDetectorOptions,
): LanguageDetector {
  const merged: ReadonlyArray<LanguageRule> = Object.freeze([
    ...(options?.rules ?? DEFAULT_LANGUAGE_RULES),
    ...(options?.overrides ?? []),
  ]);

  return Object.freeze({
    detect(extension: string): Language {
      const norm = normalizeExtension(extension);
      if (norm === "") return "unknown";
      for (const rule of merged) {
        if (checkRule(norm, rule)) {
          return rule.language;
        }
      }
      return "unknown";
    },
  });
}

/**
 * One-shot convenience: builds an ephemeral detector and returns its verdict.
 * Prefer `createLanguageDetector` when you have many extensions to detect.
 */
export function detectLanguage(extension: string): Language {
  return createLanguageDetector().detect(extension);
}

/**
 * Test hooks. Not part of the public contract; subject to change without
 * notice. Do not depend on this in production code.
 */
export const __testing__ = {
  DEFAULT_LANGUAGE_RULES,
  normalizeExtension,
  checkRule,
};
