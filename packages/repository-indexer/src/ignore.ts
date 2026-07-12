/**
 * Ignore Engine — single source of truth for "should this entry be in the tree?"
 *
 * Design notes:
 *  - Two distinct buckets: exact-basename (Set, O(1)) and suffix-pattern (regex, O(m)).
 *  - The engine NEVER deals with OS path separators. Callers feed it POSIX basenames
 *    so Windows/macOS/Linux behavior is identical without conditionals here.
 *  - The matcher compiles patterns ONCE per instance. The walker uses
 *    `createIgnoreMatcher()` once at the top of `scanRepository` and shares
 *    the instance across millions of recursive entries.
 */

/**
 * Defaults are an exact-match basename set for directories + `.DS_Store`,
 * plus a suffix-glob set for trivial files like `*.log`.
 */
const DEFAULT_IGNORE_DIRS: ReadonlyArray<string> = Object.freeze([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
  ".idea",
  ".vscode",
]);

const DEFAULT_IGNORE_FILES: ReadonlyArray<string> = Object.freeze([".DS_Store"]);

const DEFAULT_IGNORE_PATTERNS: ReadonlyArray<string> = Object.freeze(["*.log"]);

export interface IgnoreMatcher {
  shouldIgnore(basename: string): boolean;
}

export interface IgnoreOptions {
  /** Additional basenames to ignore (directories or files). */
  readonly extra?: ReadonlyArray<string>;
  /** Additional suffix-style patterns. Example: ["*.tmp", "*.swp"]. */
  readonly extraPatterns?: ReadonlyArray<string>;
}

/**
 * Convert a single-segment `*.ext` style glob to an anchored, case-sensitive
 * regular expression. Only the literal `*` at the start is honored — this is
 * intentionally minimal; richer globbing belongs in a future story.
 *
 * Examples:
 *   "*.log"   → /^[^/]+\.log$/
 *   "foo.bar" → /^foo\.bar$/
 */
function suffixToRegex(pattern: string): RegExp {
  if (!pattern.startsWith("*")) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${escaped}$`);
  }

  const rest = pattern.slice(1);
  const escaped = rest.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^[^/]+${escaped}$`);
}

function compilePatterns(patterns: ReadonlyArray<string>): ReadonlyArray<RegExp> {
  return Object.freeze(patterns.map(suffixToRegex));
}

export function createIgnoreMatcher(options?: IgnoreOptions): IgnoreMatcher {
  const basenameSet = new Set<string>();
  for (const name of DEFAULT_IGNORE_DIRS) basenameSet.add(name);
  for (const name of DEFAULT_IGNORE_FILES) basenameSet.add(name);
  if (options?.extra) {
    for (const name of options.extra) basenameSet.add(name);
  }

  const regexes = compilePatterns([
    ...DEFAULT_IGNORE_PATTERNS,
    ...(options?.extraPatterns ?? []),
  ]);

  return Object.freeze({
    shouldIgnore(basename: string): boolean {
      if (basenameSet.has(basename)) return true;
      for (const re of regexes) {
        if (re.test(basename)) return true;
      }
      return false;
    },
  });
}

/**
 * One-shot convenience: builds an ephemeral matcher and returns its verdict.
 * Prefer `createIgnoreMatcher` when you have many entries to check.
 */
export function shouldIgnore(basename: string, options?: IgnoreOptions): boolean {
  return createIgnoreMatcher(options).shouldIgnore(basename);
}

export const __testing__ = {
  DEFAULT_IGNORE_DIRS,
  DEFAULT_IGNORE_FILES,
  DEFAULT_IGNORE_PATTERNS,
  suffixToRegex,
};
