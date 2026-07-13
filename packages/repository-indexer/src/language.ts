import type { FileNode, Language } from "./types.js";

const SPECIAL_FILENAMES: Record<string, Language> = {
  Dockerfile: "dockerfile",
  Makefile: "makefile",
  "CMakeLists.txt": "cmake",
  "package.json": "json",
  "tsconfig.json": "json",
  "Cargo.toml": "toml",
  "go.mod": "go",
  "composer.json": "json",
  ".gitignore": "unknown",
  ".npmrc": "unknown",
  ".nvmrc": "unknown",
  ".eslintrc": "json",
  ".eslintrc.json": "json",
  ".eslintrc.js": "javascript",
  ".prettierrc": "json",
  ".prettierrc.json": "json",
  ".prettierrc.js": "javascript",
  "jest.config.js": "javascript",
  "jest.config.ts": "typescript",
  "vite.config.js": "javascript",
  "vite.config.ts": "typescript",
  "next.config.js": "javascript",
  "turbo.json": "json",
  "pnpm-workspace.yaml": "yaml",
  "pnpm-lock.yaml": "yaml",
  "package-lock.json": "json",
  "yarn.lock": "unknown",
  "Cargo.lock": "toml",
  "go.sum": "go",
  "requirements.txt": "unknown",
  "Pipfile": "toml",
  "Pipfile.lock": "json",
  "pyproject.toml": "toml",
  "Gemfile": "ruby",
  "Gemfile.lock": "unknown",
  "pom.xml": "xml",
  "build.gradle": "unknown",
  "settings.gradle": "unknown",
};

const EXTENSION_MAP: Record<string, Language> = {
  ts: "typescript",
  tsx: "typescript-react",
  js: "javascript",
  jsx: "javascript-react",
  py: "python",
  java: "java",
  kt: "kotlin",
  rs: "rust",
  go: "go",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  c: "c",
  h: "c-header",
  hpp: "c-header",
  hxx: "c-header",
  cs: "csharp",
  swift: "swift",
  php: "php",
  rb: "ruby",
  lua: "lua",
  md: "markdown",
  markdown: "markdown",
  yml: "yaml",
  yaml: "yaml",
  json: "json",
  toml: "toml",
  xml: "xml",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  sql: "sql",
  sh: "shell",
  bash: "shell",
  zsh: "zsh",
  groovy: "groovy",
  gradle: "groovy",
};

/**
 * Detect the programming language of a file based on its name and extension.
 *
 * Detection order:
 * 1. Special filenames (Dockerfile, Makefile, package.json, etc.)
 * 2. File extension (.ts, .py, .java, etc.)
 * 3. UNKNOWN fallback
 *
 * @param node - The FileNode to classify
 * @returns The detected Language
 *
 * @example
 * const node: FileNode = {
 *   type: "file",
 *   name: "index.ts",
 *   relativePath: "src/index.ts",
 *   absolutePath: "/project/src/index.ts",
 *   extension: "ts",
 *   size: 1234,
 * };
 * detectLanguage(node); // returns "typescript"
 */
export function detectLanguage(node: FileNode): Language {
  if (node.type !== "file") {
    return "unknown";
  }

  const specialLang = SPECIAL_FILENAMES[node.name];
  if (specialLang) {
    return specialLang;
  }

  const ext = node.extension.toLowerCase();
  const extLang = EXTENSION_MAP[ext];
  if (extLang) {
    return extLang;
  }

  return "unknown";
}

/**
 * Get all supported extensions for a given language.
 *
 * @param language - The language to get extensions for
 * @returns Array of extensions (without leading dot)
 */
export function getExtensionsForLanguage(language: Language): string[] {
  return Object.entries(EXTENSION_MAP)
    .filter(([, lang]) => lang === language)
    .map(([ext]) => ext);
}

/**
 * Check if a file node matches a specific language.
 *
 * @param node - The FileNode to check
 * @param language - The language to match
 * @returns true if the file matches the language
 */
export function isLanguage(node: FileNode, language: Language): boolean {
  return detectLanguage(node) === language;
}