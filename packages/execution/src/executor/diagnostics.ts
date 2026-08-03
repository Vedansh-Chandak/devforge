/**
 * @devforge/execution — Diagnostics pipeline (DF-016B).
 *
 * Captures structured diagnostics from verification failures.
 * Never passes raw logs directly to models — extracts structured signals.
 */

import type { VerificationResult, VerificationOutcome } from '../executor/types.js';
import { DiagnosticsError } from './coding-errors.js';
import type { DiagnosticCategory } from './patch-model.js';

/** Category of a diagnostic signal. */
export type { DiagnosticCategory } from './patch-model.js';

/** Severity of a diagnostic. */
export type DiagnosticSeverity = 'error' | 'warning';

/** A single structured diagnostic signal. */
export interface Diagnostic {
  readonly category: DiagnosticCategory;
  readonly targetId?: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
  readonly file?: string;
  readonly code?: string; // e.g., TS error code, lint rule name
}

/** Aggregated diagnostics from a verification run. */
export interface Diagnostics {
  readonly source: string; // e.g., 'verification', 'command'
  readonly diagnostics: readonly Diagnostic[];
  /** Captured stderr lines (truncated, sanitized). */
  readonly stderr: readonly string[];
  /** Total verification duration in ms. */
  readonly verificationDurationMs: number;
  /** Human-readable summary. */
  readonly summary: string;
}

/** Configuration for diagnostics capture. */
export interface DiagnosticsConfig {
  /** Maximum stderr lines to capture per target. */
  readonly maxStderrLines?: number;
  /** Maximum characters per stderr line. */
  readonly maxLineLength?: number;
  /** Maximum total diagnostics to extract. */
  readonly maxDiagnostics?: number;
}

/** Default diagnostics config. */
export const DEFAULT_DIAGNOSTICS_CONFIG: Required<DiagnosticsConfig> = {
  maxStderrLines: 50,
  maxLineLength: 500,
  maxDiagnostics: 100,
};

/** Result of parsing a single target's output. */
interface TargetParseResult {
  diagnostics: Diagnostic[];
  stderrLines: string[];
}

/**
 * Capture structured diagnostics from a verification result.
 * Parses output by target category (typecheck, test, lint, etc.).
 */
export function captureDiagnostics(
  result: VerificationResult,
  config: DiagnosticsConfig = {},
): Diagnostics {
  const merged = { ...DEFAULT_DIAGNOSTICS_CONFIG, ...config };
  const allDiagnostics: Diagnostic[] = [];
  const allStderr: string[] = [];

  for (const target of result.targets) {
    const parsed = parseTargetOutput(target, merged);
    allDiagnostics.push(...parsed.diagnostics);
    allStderr.push(...parsed.stderrLines);
  }

  // Enforce max diagnostics
  const limitedDiagnostics = allDiagnostics.slice(0, merged.maxDiagnostics);

  return {
    source: 'verification',
    diagnostics: limitedDiagnostics,
    stderr: allStderr.slice(0, merged.maxStderrLines),
    verificationDurationMs: result.durationMs,
    summary: buildSummary(limitedDiagnostics, result),
  };
}

function parseTargetOutput(
  target: VerificationOutcome,
  config: Required<DiagnosticsConfig>,
): TargetParseResult {
  const diagnostics: Diagnostic[] = [];
  const stderrLines: string[] = [];

  if (!target.output) return { diagnostics, stderrLines };

  const lines = target.output.split('\n');
  const category = inferCategory(target.targetId);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Capture stderr (sanitized, truncated)
    if (stderrLines.length < config.maxStderrLines) {
      stderrLines.push(truncateLine(trimmed, config.maxLineLength));
    }

    // Extract structured diagnostics
    const extracted = extractDiagnosticsFromLine(trimmed, target.targetId, category);
    if (extracted) {
      diagnostics.push(extracted);
      if (diagnostics.length >= config.maxDiagnostics) break;
    }
  }

  return { diagnostics, stderrLines };
}

function inferCategory(targetId: string): DiagnosticCategory {
  const id = targetId.toLowerCase();
  if (id.includes('typecheck') || id.includes('tsc') || id.includes('build')) {
    return 'COMPILER';
  }
  if (id.includes('test') || id.includes('vitest') || id.includes('jest')) {
    return 'TEST';
  }
  if (id.includes('lint') || id.includes('eslint') || id.includes('prettier')) {
    return 'LINT';
  }
  if (id.includes('command') || id.includes('exec')) {
    return 'COMMAND';
  }
  return 'VERIFICATION';
}

function extractDiagnosticsFromLine(
  line: string,
  targetId: string,
  category: DiagnosticCategory,
): Diagnostic | null {
  // TypeScript compiler errors: "file.ts:10:5 - error TS2304: Cannot find name 'foo'"
  const tsMatch = line.match(/^(.+?):(\d+):(\d+)\s+-\s+(error|warning)\s+(TS\d+):\s+(.+)$/);
  if (tsMatch) {
    return {
      category: 'COMPILER',
      targetId,
      severity: tsMatch[4]! as DiagnosticSeverity,
      message: tsMatch[6]!,
      file: tsMatch[1]!,
      line: parseInt(tsMatch[2]!, 10),
      column: parseInt(tsMatch[3]!, 10),
      code: tsMatch[5]!,
    };
  }

  // Generic file:line:col: message
  const genericMatch = line.match(/^(.+?):(\d+):(\d+):\s*(.+)$/);
  if (genericMatch) {
    return {
      category,
      targetId,
      severity: 'error',
      message: genericMatch[4]!,
      file: genericMatch[1]!,
      line: parseInt(genericMatch[2]!, 10),
      column: parseInt(genericMatch[3]!, 10),
    };
  }

  // Test failure patterns: "× message" / "✕ message" lines
  if (category === 'TEST') {
    const testFail = line.match(/^[×✕]\s+(.+)$/);
    if (testFail) {
      return {
        category: 'TEST',
        targetId,
        severity: 'error',
        message: testFail[1]!,
      };
    }
  }

  // Lint errors: "file.ts:1:1 error 'rule-name' message"
  if (category === 'LINT') {
    const lintMatch = line.match(/^(.+?):(\d+):(\d+)\s+(error|warning)\s+'([^']+)'\s+(.+)$/);
    if (lintMatch) {
      return {
        category: 'LINT',
        targetId,
        severity: lintMatch[4]! as DiagnosticSeverity,
        message: lintMatch[6]!,
        file: lintMatch[1]!,
        line: parseInt(lintMatch[2]!, 10),
        column: parseInt(lintMatch[3]!, 10),
        code: lintMatch[5]!,
      };
    }
  }

  // Generic error line (contains "error" or "Error")
  if (/error/i.test(line) && line.length > 10) {
    return {
      category,
      targetId,
      severity: 'error',
      message: truncateLine(line, 200),
    };
  }

  return null;
}

function buildSummary(diagnostics: readonly Diagnostic[], result: VerificationResult): string {
  const counts = { error: 0, warning: 0 };
  for (const d of diagnostics) {
    if (d.category === 'TEST') continue;
    counts[d.severity] += 1;
  }
  const failedTargets = result.targets.filter((t) => !t.success).length;
  return `Verification ${result.ok ? 'passed' : 'failed'} (${result.targets.length} targets, ${failedTargets} failed, ${counts.error} errors, ${counts.warning} warnings, ${result.durationMs}ms)`;
}

function truncateLine(line: string, maxLength: number): string {
  if (line.length <= maxLength) return line;
  return line.slice(0, maxLength - 3) + '...';
}

/**
 * Capture diagnostics from a raw command result (for non-verification commands).
 */
export function captureCommandDiagnostics(
  command: string,
  args: readonly string[],
  stdout: string,
  stderr: string,
  exitCode: number | null,
  durationMs: number,
  config: DiagnosticsConfig = {},
): Diagnostics {
  const merged = { ...DEFAULT_DIAGNOSTICS_CONFIG, ...config };
  const output = [stdout, stderr].filter(Boolean).join('\n');
  const lines = output.split('\n');
  const diagnostics: Diagnostic[] = [];
  const stderrLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (stderrLines.length < merged.maxStderrLines) {
      stderrLines.push(truncateLine(trimmed, merged.maxLineLength));
    }

    if (/error/i.test(trimmed) || /warning/i.test(trimmed)) {
      diagnostics.push({
        category: 'COMMAND',
        severity: /error/i.test(trimmed) ? 'error' : 'warning',
        message: truncateLine(trimmed, 200),
      });
    }
  }

  return {
    source: 'command',
    diagnostics: diagnostics.slice(0, merged.maxDiagnostics),
    stderr: stderrLines,
    verificationDurationMs: durationMs,
    summary: `Command ${command} ${args.join(' ')} exited with ${exitCode ?? 'signal'} (${durationMs}ms)`,
  };
}