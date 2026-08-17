/**
 * @devforge/cli — Output service (M1).
 *
 * Renders command results as either human-readable text or JSON. The CLI never
 * prints JSON by default; --json switches every command to a single JSON blob
 * on stdout (logs still go to stderr).
 */

import type { ExecutionReport, CodingReport } from '@devforge/execution';
import type { ExecutionPlan, PlanResult } from '@devforge/planner';

/** Minimal ANSI color helpers. */
export const color = {
  reset: (s: string): string => `\x1b[0m${s}\x1b[0m`,
  red: (s: string): string => `\x1b[31m${s}\x1b[0m`,
  green: (s: string): string => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string): string => `\x1b[33m${s}\x1b[0m`,
  blue: (s: string): string => `\x1b[34m${s}\x1b[0m`,
  bold: (s: string): string => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string): string => `\x1b[2m${s}\x1b[0m`,
};

/** Render any value to JSON on a single line. */
export function writeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Apply a single ANSI color function to a string. */
type ColorFn = (s: string) => string;
type Colorizer = (fn: ColorFn, s: string) => string;

/** Render text for a plan. */
export function renderPlan(plan: ExecutionPlan, options: { useColor?: boolean } = {}): string {
  const useColor: Colorizer = options.useColor === false
    ? (_fn, s) => s
    : (fn, s) => fn(s);
  const lines: string[] = [];
  lines.push(useColor(color.bold, `Plan: ${plan.summary}`));
  lines.push(`  Complexity: ${plan.complexity}   Risk: ${plan.risk}`);
  lines.push(`  Confirmation required: ${plan.requiresConfirmation ? 'yes' : 'no'}`);
  lines.push('');
  for (const step of plan.steps) {
    const marker = step.requiresConfirmation ? '!' : ' ';
    const cost = '·'.repeat(Math.max(1, step.estimatedCost));
    lines.push(`  [${marker}] ${step.id} ${step.type.padEnd(9)} ${cost}  ${step.title}`);
    if (step.description) lines.push(`       ${step.description}`);
  }
  return lines.join('\n');
}

/** Render a PlanResult (union) to text. */
export function renderPlanResult(result: PlanResult): string {
  if (result.ok) {
    return renderPlan(result.plan);
  }
  return `${color.red(`Planning failed: [${result.error.code}] ${result.error.message}`)}`;
}

/** Render a CodingReport (fix outcome) to text. */
export function renderCodingReport(report: CodingReport): string {
  const outcome = report.outcome === 'SUCCESS'
    ? color.green('SUCCESS')
    : color.red(report.outcome);
  const lines: string[] = [];
  lines.push(`${color.bold('Fix outcome:')} ${outcome}`);
  lines.push(`  Patches generated: ${report.patchesGenerated}`);
  lines.push(`  Repair attempts:   ${report.repairAttempts}`);
  lines.push(`  Verification runs: ${report.verificationRuns}`);
  lines.push(`  Rollbacks:         ${report.rollbackCount}`);
  lines.push(`  Duration:          ${Math.round(report.executionTimeMs)} ms`);
  if (report.error) {
    lines.push(`  Error:             ${report.error.message}`);
  }
  return lines.join('\n');
}

/** Render an ExecutionReport to text. */
export function renderExecutionReport(report: ExecutionReport): string {
  const statusColor = (s: string): string =>
    s === 'COMPLETED' ? color.green(s) : s === 'FAILED' || s === 'CANCELLED' ? color.red(s) : color.yellow(s);
  const lines: string[] = [];
  lines.push(`${color.bold('Execution:')} ${statusColor(report.status)} in ${Math.round(report.durationMs)} ms`);
  lines.push(`  Plan: ${report.summary}`);
  for (const step of report.steps) {
    const ok = step.status === 'COMPLETED' ? color.green('ok') : color.red(step.status);
    lines.push(`    [${ok}] ${step.type.padEnd(9)} ${step.title}`);
  }
  if (report.error) {
    lines.push(`  ${color.red(`Error: ${report.error.message}`)}`);
  }
  return lines.join('\n');
}

/** Render a generic status block (key/value pairs). */
export function renderStatus(pairs: ReadonlyArray<readonly [string, string]>): string {
  const width = Math.max(...pairs.map(([k]) => k.length), 0);
  return pairs.map(([k, v]) => `  ${k.padEnd(width)}  ${v}`).join('\n');
}