/**
 * @vedansh78/cli — plan command (M2).
 *
 * Brain → Planner → Print ExecutionPlan
 * Do not execute.
 */

import type { ExecutionContext } from '../services/session.js';
import { renderPlanResult } from '../services/output.js';

/** Handler for `devforge plan <goal>`. */
export async function handlePlan(ctx: ExecutionContext, goal: string): Promise<string> {
  const { services, options, repository } = ctx;
  const { brain, planner } = services;

  // 1. Brain analysis
  const brainResult = await brain.ask(`Plan: ${goal}`, { signal: ctx.signal });
  let output = '';
  
  if (brainResult.status === 'answered') {
    output += `💭 Brain Analysis:\n${brainResult.answer}\n\n`;
  } else if (brainResult.status === 'classified') {
    output += `🔍 Brain classified intent as: ${brainResult.intent} (${Math.round(brainResult.confidence * 100)}% confidence)\n\n`;
  }

  // 2. Planner: generate plan
  const result = await planner.plan(goal, { signal: ctx.signal });
  const rendered = renderPlanResult(result);

  if (options.debug && result.ok) {
    const { plan } = result;
    return `${output}${rendered}\n\nAssumptions:\n${plan.assumptions.map(a => `  - ${a}`).join('\n') || '  (none)'}\n\nExpected outputs:\n${plan.expectedOutputs.map(o => `  - ${o}`).join('\n') || '  (none)'}\n\nRepository: ${repository.root}`;
  }

  return `${output}${rendered}`;
}