/**
 * @devforge/github — Review Engine (DF-021).
 *
 * Generates deterministic review findings for a pull request's changed files.
 * Detects bugs, security issues, style problems, missing tests, complexity,
 * and architecture concerns, and suggests concrete patches.
 *
 * The engine is pure: given changed files (and optionally file contents) it
 * always produces the same findings. No model is required.
 */

import type { GitHubChangedFile } from './types.js';
import { parseChangedFile } from './diff.js';
import type { DiffLine, ParsedFileDiff } from './diff.js';
import type { SuggestedPatch } from './patch.js';
import { replacement, insertion } from './patch.js';

export type ReviewSeverity = 'error' | 'warning' | 'info';

export type ReviewCategory =
  | 'bugs'
  | 'security'
  | 'style'
  | 'missing-tests'
  | 'complexity'
  | 'architecture';

export interface ReviewFinding {
  readonly category: ReviewCategory;
  readonly severity: ReviewSeverity;
  readonly file: string;
  readonly line: number | null;
  readonly message: string;
  readonly suggestion: string;
  readonly patch?: SuggestedPatch;
}

export interface ReviewReport {
  readonly findings: readonly ReviewFinding[];
  readonly summary: string;
  readonly stats: Readonly<Record<ReviewCategory, number>>;
  readonly changedFiles: readonly string[];
}

export interface ReviewOptions {
  /** Read a file's current content by path (enables context checks). */
  readonly readFile?: (path: string) => Promise<string>;
  /** Include info-severity findings. Default true. */
  readonly includeInfo?: boolean;
}

interface RuleResult {
  readonly findings: readonly ReviewFinding[];
}

type Rule = (input: RuleInput) => RuleResult;

interface RuleInput {
  readonly file: GitHubChangedFile;
  readonly diff: ParsedFileDiff;
  readonly content: string | null;
}

const CATEGORY_ORDER: readonly ReviewCategory[] = [
  'bugs',
  'security',
  'style',
  'missing-tests',
  'complexity',
  'architecture',
];

/** The review engine. Reusable, deterministic, dependency-free. */
export class ReviewEngine {
  private readonly rules: readonly Rule[];

  constructor(rules: readonly Rule[] = defaultRules) {
    this.rules = rules;
  }

  /** Run all rules over the changed files and produce a report. */
  async review(files: readonly GitHubChangedFile[], options: ReviewOptions = {}): Promise<ReviewReport> {
    const findings: ReviewFinding[] = [];
    const seen = new Set<string>();

    for (const file of files) {
      const diff = parseChangedFile(file);
      const content = options.readFile ? await readSafely(options.readFile, diff.newPath) : null;
      const input: RuleInput = { file, diff, content };

      for (const rule of this.rules) {
        const result = rule(input);
        for (const finding of result.findings) {
          if (finding.severity === 'info' && options.includeInfo === false) continue;
          const key = `${finding.category}:${finding.file}:${finding.line}:${finding.message}`;
          if (seen.has(key)) continue;
          seen.add(key);
          findings.push(finding);
        }
      }
    }

    const stats = buildStats(findings);
    return {
      findings,
      summary: buildSummary(findings, files.length),
      stats,
      changedFiles: files.map((f) => f.filename),
    };
  }
}

async function readSafely(read: (path: string) => Promise<string>, path: string): Promise<string | null> {
  try {
    return await read(path);
  } catch {
    return null;
  }
}

function buildStats(findings: readonly ReviewFinding[]): Readonly<Record<ReviewCategory, number>> {
  const stats: Record<ReviewCategory, number> = {
    bugs: 0,
    security: 0,
    style: 0,
    'missing-tests': 0,
    complexity: 0,
    architecture: 0,
  };
  for (const finding of findings) {
    stats[finding.category] += 1;
  }
  return stats;
}

function buildSummary(findings: readonly ReviewFinding[], fileCount: number): string {
  if (findings.length === 0) {
    return `No issues detected across ${fileCount} changed file(s).`;
  }
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  const infos = findings.filter((f) => f.severity === 'info').length;
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error(s)`);
  if (warnings > 0) parts.push(`${warnings} warning(s)`);
  if (infos > 0) parts.push(`${infos} info`);
  return `Reviewed ${fileCount} file(s): ${parts.join(', ') || 'no issues'}.`;
}

// ── Rule helpers ─────────────────────────────────────────────────────────

function addedLines(diff: ParsedFileDiff): DiffLine[] {
  const result: DiffLine[] = [];
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === 'addition') result.push(line);
    }
  }
  return result;
}

function allLines(diff: ParsedFileDiff): DiffLine[] {
  const result: DiffLine[] = [];
  for (const hunk of diff.hunks) {
    result.push(...hunk.lines);
  }
  return result;
}

function lineNumber(line: DiffLine): number | null {
  return line.newLineNumber ?? null;
}

function finding(
  category: ReviewCategory,
  severity: ReviewSeverity,
  file: string,
  line: number | null,
  message: string,
  suggestion: string,
  patch?: SuggestedPatch,
): ReviewFinding {
  return { category, severity, file, line, message, suggestion, ...(patch ? { patch } : {}) };
}

// ── Rules ────────────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  /(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\s*[=:]\s*["'][^"'\s]{8,}["']/i,
];

const DANGEROUS_PATTERNS = [
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
  /\.innerHTML\s*=/,
  /child_process\.(exec|execSync)\s*\(/,
];

const BUG_PATTERNS: ReadonlyArray<{ re: RegExp; message: string; suggestion: string; severity: ReviewSeverity }> = [
  { re: /==\s*null/, message: 'Loose equality with null', suggestion: 'Use `=== null || === undefined` or a nullish check.', severity: 'warning' },
  { re: /!==\s*undefined/, message: 'Inequality with undefined', suggestion: 'Prefer a nullish check to avoid false positives.', severity: 'info' },
  { re: /\.length\s*[<>]=?\s*0\b(?!\s*[=!])/, message: 'Unsigned length comparison', suggestion: 'Length is always >= 0; compare with `=== 0` or `> 0`.', severity: 'warning' },
  { re: /\bNaN\s*===\s*/, message: 'NaN can never equal itself', suggestion: 'Use `Number.isNaN(...)`.', severity: 'error' },
  { re: /=\s*=\s*(true|false)\b/, message: 'Comparing against a literal boolean', suggestion: 'Use the value directly.', severity: 'info' },
];

const STYLE_PATTERNS: ReadonlyArray<{ re: RegExp; message: string; suggestion: string; severity: ReviewSeverity }> = [
  { re: /\bvar\s+/, message: '`var` declaration', suggestion: 'Prefer `const`/`let`.', severity: 'warning' },
  { re: /console\.(log|debug)\s*\(/, message: 'Debug logging in production code', suggestion: 'Use the project logger instead.', severity: 'warning' },
  { re: /TODO\b/i, message: 'TODO comment', suggestion: 'Resolve or track the TODO before merging.', severity: 'info' },
];

const bugRule: Rule = ({ diff, file }) => {
  const findings: ReviewFinding[] = [];
  for (const line of addedLines(diff)) {
    const lineNo = lineNumber(line);
    for (const pattern of BUG_PATTERNS) {
      if (pattern.re.test(line.content)) {
        findings.push(finding('bugs', pattern.severity, file.filename, lineNo, pattern.message, pattern.suggestion));
        break;
      }
    }
  }
  return { findings };
};

const securityRule: Rule = ({ diff, file }) => {
  const findings: ReviewFinding[] = [];
  for (const line of addedLines(diff)) {
    const lineNo = lineNumber(line);
    const content = line.content.trim();
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(content)) {
        const envPatch = content.replace(/["'][^"'\s]{8,}["']/, 'process.env.SECRET');
        findings.push(
          finding('security', 'error', file.filename, lineNo, 'Potential hardcoded secret', 'Load secrets from environment variables or a secret manager.', replacement(file.filename, lineNo ?? 1, content, envPatch, 'Use an environment variable')),
        );
        break;
      }
    }
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(content)) {
        findings.push(
          finding('security', 'error', file.filename, lineNo, 'Potential code injection / unsafe eval', 'Avoid dynamic code execution; sanitize and validate input.'),
        );
        break;
      }
    }
  }
  return { findings };
};

const styleRule: Rule = ({ diff, file }) => {
  const findings: ReviewFinding[] = [];
  const isTestFile = /\.(test|spec)\./.test(file.filename);
  for (const line of addedLines(diff)) {
    const lineNo = lineNumber(line);
    const content = line.content.trim();
    for (const pattern of STYLE_PATTERNS) {
      if (pattern.re.test(content)) {
        if (pattern.message === 'Debug logging in production code' && isTestFile) continue;
        findings.push(finding('style', pattern.severity, file.filename, lineNo, pattern.message, pattern.suggestion));
        break;
      }
    }
  }
  return { findings };
};

const missingTestsRule: Rule = ({ file }) => {
  const findings: ReviewFinding[] = [];
  const isTestFile = /\.(test|spec)\./.test(file.filename);
  if (isTestFile) return { findings };
  if (!/\.(ts|tsx|js|jsx)$/.test(file.filename)) return { findings };
  const base = file.filename.replace(/\.(ts|tsx|js|jsx)$/, '');
  const suggestions: string[] = [];
  suggestions.push(`${base}.test.ts`);
  suggestions.push(`${base}.spec.ts`);
  if (file.status === 'added' || file.status === 'modified') {
    findings.push(
      finding(
        'missing-tests',
        'warning',
        file.filename,
        null,
        `No test file detected for ${file.filename}`,
        `Add a test file, e.g. \`${suggestions[0]}\` or \`${suggestions[1]}\`.`,
      ),
    );
  }
  return { findings };
};

const complexityRule: Rule = ({ diff, file }) => {
  const findings: ReviewFinding[] = [];
  let additions = 0;
  let deletions = 0;
  for (const line of allLines(diff)) {
    if (line.kind === 'addition') additions += 1;
    if (line.kind === 'deletion') deletions += 1;
  }
  if (additions + deletions > 200) {
    findings.push(
      finding('complexity', 'warning', file.filename, null, `Large change (${additions + deletions} lines)`, 'Consider splitting the change into smaller, reviewable PRs.'),
    );
  }
  const deepNesting = addedLines(diff).filter((l) => l.content.startsWith('    '.repeat(5))).length;
  if (deepNesting >= 3) {
    findings.push(
      finding('complexity', 'warning', file.filename, null, 'Deeply nested code detected', 'Extract helper functions to reduce nesting depth.'),
    );
  }
  return { findings };
};

const architectureRule: Rule = ({ file, diff }) => {
  const findings: ReviewFinding[] = [];
  for (const line of addedLines(diff)) {
    const importMatch = /import\s+.+?\s+from\s+["']([^"']+)["']/.exec(line.content);
    if (importMatch?.[1]?.includes('../../..')) {
      findings.push(
        finding('architecture', 'info', file.filename, lineNumber(line), 'Deep relative import', 'Prefer path aliases or barrel exports to keep the module graph clean.'),
      );
      break;
    }
  }
  return { findings };
};

/** The default rule set in deterministic order. */
export const defaultRules: readonly Rule[] = [
  bugRule,
  securityRule,
  styleRule,
  missingTestsRule,
  complexityRule,
  architectureRule,
];

/** All category values, ordered. */
export const REVIEW_CATEGORIES: readonly ReviewCategory[] = CATEGORY_ORDER;
