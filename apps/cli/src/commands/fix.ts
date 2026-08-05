/**
 * @devforge/cli — fix command (M2).
 *
 * Autonomous coding: analyze → generate patches → apply → verify → repair.
 * Uses the CodingEngine directly (no planner).
 */

import type { CliContext } from '../routing/context.js';
import { renderCodingReport } from '../utils/output.js';
import type { CodingReport } from '@devforge/execution';

/** Handler for `devforge fix <goal>`. */
export async function handleFix(ctx: CliContext, goal: string): Promise<string | object> {
  const { services, options } = ctx;
  const { executor } = services;
  const startTime = Date.now();

  if (options.debug) {
    return `🔧 Fix: ${goal}\n\nRunning autonomous coding engine...`;
  }

  const report = await executor.fix(goal);
  const rendered = renderCodingReport(report);

  // Add performance metrics
  const duration = Date.now() - startTime;
  const enhancedReport = {
    ...report,
    planningTimeMs: 0,
    executionTimeMs: report.executionTimeMs,
    verificationTimeMs: 0,
    repairAttempts: report.repairAttempts,
    patchesGenerated: report.patchesGenerated,
    commandsExecuted: 0,
  };

  if (options.json) {
    return enhancedReport;
  }

  if (options.debug) {
    return `${rendered}\n\n📊 Performance:\n  Total duration: ${duration}ms\n  Execution: ${report.executionTimeMs}ms\n  Patches: ${report.patchesGenerated}\n  Repairs: ${report.repairAttempts}`;
  }

  return rendered;
}