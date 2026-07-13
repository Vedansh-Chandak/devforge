import { sep, posix } from "node:path";

const BUILTIN_IGNORE_PATTERNS: readonly string[] = [
  ".DS_Store",
  "Thumbs.db",
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
  "coverage",
  ".nyc_output",
  "*.log",
  "*.tmp",
  "*.temp",
];

function normalizePattern(pattern: string): string {
  return pattern.replace(/\\/g, "/");
}

function patternToRegex(pattern: string): RegExp {
  const normalized = normalizePattern(pattern);

  let regex = "^";
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charAt(i);
    if (char === "*") {
      if (i + 1 < normalized.length && normalized.charAt(i + 1) === "*") {
        if (i + 2 < normalized.length && normalized.charAt(i + 2) === "/") {
          regex += "(?:.*/)?";
          i += 2;
        } else {
          regex += ".*";
          i++;
        }
      } else {
        regex += "[^/]*";
      }
    } else if (char === "?") {
      regex += "[^/]";
    } else if (char === ".") {
      regex += "\\.";
    } else if (char === "/") {
      regex += "/";
    } else {
      regex += char.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
    }
  }
  regex += "$";

  return new RegExp(regex);
}

function isDirectoryPattern(pattern: string): boolean {
  // Explicit directory patterns end with /
  if (pattern.endsWith("/")) return true;
  
  // Patterns with wildcards are handled by regex
  if (pattern.includes("*") || pattern.includes("?")) return false;
  
  // Known file patterns (exact filenames)
  const knownFilePatterns = new Set([".DS_Store", "Thumbs.db"]);
  if (knownFilePatterns.has(pattern)) return false;
  
  // Patterns starting with . (like .git, .next, .turbo, .cache) are directories
  if (pattern.startsWith(".")) return true;
  
  // Other patterns without extensions are directories
  return !pattern.includes(".");
}

function createDirectoryMatcher(pattern: string): (path: string) => boolean {
  const normalized = normalizePattern(pattern);
  
  // For directory patterns like "node_modules", we need to match:
  // - exact "node_modules"
  // - "node_modules/" (with trailing slash)
  // - "*/node_modules" (anywhere in path)
  // - "*/node_modules/" (anywhere in path with trailing slash)
  
  if (normalized.includes("*") || normalized.includes("?")) {
    // Glob pattern - use regex
    const regex = patternToRegex(normalized);
    return (path: string) => regex.test(path) || regex.test(path + "/");
  }
  
  // Simple directory name - match as path component
  return (path: string) => {
    const parts = path.split("/");
    return parts.includes(normalized);
  };
}

function createFileMatcher(pattern: string): (path: string) => boolean {
  const normalized = normalizePattern(pattern);
  
  if (normalized.includes("*") || normalized.includes("?")) {
    const regex = patternToRegex(normalized);
    return (path: string) => regex.test(path);
  }
  
  // Simple filename - match exact filename
  return (path: string) => {
    const basename = path.split("/").pop() || "";
    return basename === normalized;
  };
}

export class IgnoreEngine {
  private readonly directoryMatchers: Array<(path: string) => boolean>;
  private readonly fileMatchers: Array<(path: string) => boolean>;

  constructor(patterns: readonly string[] = BUILTIN_IGNORE_PATTERNS) {
    this.directoryMatchers = [];
    this.fileMatchers = [];

    for (const pattern of patterns) {
      if (isDirectoryPattern(pattern)) {
        this.directoryMatchers.push(createDirectoryMatcher(pattern));
      } else {
        this.fileMatchers.push(createFileMatcher(pattern));
      }
    }
  }

  shouldIgnore(relativePath: string, isDirectory: boolean): boolean {
    const normalized = relativePath.replace(/\\/g, "/");
    const pathParts = normalized.split("/");

    // Check if any parent directory is ignored (for files inside ignored dirs)
    for (let i = 0; i < pathParts.length; i++) {
      const parentPath = pathParts.slice(0, i + 1).join("/");
      for (const matcher of this.directoryMatchers) {
        if (matcher(parentPath)) {
          return true;
        }
      }
    }

    if (isDirectory) {
      for (const matcher of this.directoryMatchers) {
        if (matcher(normalized)) {
          return true;
        }
      }
    }

    for (const matcher of this.fileMatchers) {
      if (matcher(normalized)) {
        return true;
      }
    }

    if (isDirectory) {
      for (const matcher of this.fileMatchers) {
        if (matcher(normalized + "/")) {
          return true;
        }
      }
    }

    return false;
  }

  static createDefault(): IgnoreEngine {
    return new IgnoreEngine();
  }
}

export const defaultIgnoreEngine = IgnoreEngine.createDefault();