/**
 * @devforge/cli — run command (M2).
 *
 * Planner → Executor (generate plan, then execute it).
 */

import type { ExecutionContext } from '../services/session.js';
import { renderExecutionReport } from '../services/output.js';
import type { ExecutionReport } from '@devforge/execution';

/** Handler for `devforge run <goal>`. */
export async function handleRun(ctx: ExecutionContext, goal: string): Promise<string | object> {
  const { services, options } = ctx;
  const { planner, executor } = services;
  const startTime = Date.now();

  const planResult = await planner.plan(goal, { signal: ctx.signal });
  if (!planResult.ok) {
    return `❌ Planning failed: ${planResult.error.message}`;
  }

  if (options.debug) {
    const report = await executor.executePlan(planResult.plan, { signal: ctx.signal });
    return `⚙️  Executing plan: ${planResult.plan.summary}\n\n${renderExecutionReport(report)}`;
  }

  const report = await executor.executePlan(planResult.plan, { signal: ctx.signal });
  const duration = Date.now() - startTime;

  const enhancedReport: ExecutionReport & {
    planningTimeMs: number;
    executionTimeMs: number;
    verificationTimeMs: number;
    repairAttempts: number;
    patchesGenerated: number;
    commandsExecuted: number;
  } = {
    ...report,
    planningTimeMs: 0,
    executionTimeMs: report.durationMs,
    verificationTimeMs: 0,
    repairAttempts: report.repairAttempts ?? 0,
    patchesGenerated: report.patchesGenerated ?? 0,
    commandsExecuted: report.steps.filter(s => s.type === 'COMMAND').length,
  };

  if (options.json) {
    return enhancedReport;
  }

  if (options.debug) {
    return `${renderExecutionReport(report)}\n\n📊 Performance:\n  Total duration: ${duration}ms\n  Execution: ${report.durationMs}ms\n  Patches: ${report.patchesGenerated ?? 0}\n  Repairs: ${report.repairAttempts ?? 0}`;
  }

  return renderExecutionReport(report);
}