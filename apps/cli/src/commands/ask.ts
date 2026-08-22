/**
 * @vedansh78/cli — ask command (M2).
 *
 * Full autonomous pipeline: CLI → Repository Discovery → Repository Indexer → Brain → Planner → Executor → Workspace → Verification → Execution Report
 */

import type { ExecutionContext } from '../services/session.js';
import { renderExecutionReport } from '../services/output.js';
import type { ExecutionReport } from '@devforge/execution';

/** Handler for `devforge ask <question>`. */
export async function handleAsk(ctx: ExecutionContext, question: string): Promise<string | object> {
  const { services, options, repository } = ctx;
  const { brain, planner, executor } = services;
  const startTime = Date.now();

  // 1. Repository Discovery (already done in context)
  // 2. Repository Indexer (done inside Brain via Runtime)
  // 3. Brain: get understanding/answer
  const brainResult = await brain.ask(question, { signal: ctx.signal });

  let output = '';
  let brainOutput: string | undefined;
  if (brainResult.status === 'answered') {
    brainOutput = brainResult.answer;
    output += `💭 ${brainResult.answer}\n\n`;
  } else if (brainResult.status === 'classified') {
    output += `🔍 Classified as: ${brainResult.intent}\n\n`;
  } else if (brainResult.status === 'invalid') {
    output += `❌ Invalid input: ${brainResult.error}\n\n`;
    return output;
  } else if (brainResult.status === 'provider_error') {
    output += `⚠️  Provider error: ${brainResult.error}\n\n`;
    return output;
  } else if (brainResult.status === 'tool_executed') {
    output += `🔧 Executed ${brainResult.toolCalls.length} tool(s)\n\n`;
  }

  // 4. Planner: generate plan
  const planResult = await planner.plan(question, { signal: ctx.signal });
  if (!planResult.ok) {
    output += `📋 Plan failed: ${planResult.error.message}\n`;
    return output;
  }

  output += `📋 ${planResult.plan.summary}\n`;
  output += `   Complexity: ${planResult.plan.complexity} | Risk: ${planResult.plan.risk} | Confirmation: ${planResult.plan.requiresConfirmation ? 'required' : 'none'}\n`;

  // 5. Executor: execute the plan
  if (options.debug) {
    output += `⚙️  Executing plan with ${planResult.plan.steps.length} steps...\n`;
  }

  const execReport = await executor.executePlan(planResult.plan, { signal: ctx.signal });
  output += renderExecutionReport(execReport);

  // 6. Verification is part of executor report

  // 7. Build execution report with performance metrics
  const duration = Date.now() - startTime;
  const executionReport: ExecutionReport & { 
    planningTimeMs: number; 
    executionTimeMs: number; 
    verificationTimeMs: number;
    repairAttempts: number;
    patchesGenerated: number;
    commandsExecuted: number;
  } = {
    ...execReport,
    planningTimeMs: 0, // TODO: track from planner
    executionTimeMs: execReport.durationMs,
    verificationTimeMs: 0, // TODO: track from verification
    repairAttempts: execReport.repairAttempts ?? 0,
    patchesGenerated: execReport.patchesGenerated ?? 0,
    commandsExecuted: execReport.steps.filter(s => s.type === 'COMMAND').length,
  };

  if (options.json) {
    return executionReport;
  }

  if (options.debug) {
    output += `\n\n📊 Performance:`;
    output += `\n  Total duration: ${duration}ms`;
    output += `\n  Execution: ${execReport.durationMs}ms`;
    output += `\n  Patches: ${execReport.patchesGenerated ?? 0}`;
    output += `\n  Repairs: ${execReport.repairAttempts ?? 0}`;
  }

  return output;
}