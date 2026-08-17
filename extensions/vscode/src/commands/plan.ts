/**
 * @devforge/vscode-extension — Plan command (DF-020).
 *
 * `devforge.plan` generates an execution plan without executing it. The
 * structured plan (when available) is rendered into the chat panel so the
 * user can review steps before running anything.
 */

import type * as vscode from 'vscode';
import type { CommandDeps } from './deps.js';
import { promptText, appendUserMessage, handleResult } from './helpers.js';
import type { PlanResult } from '@devforge/planner';

/** Render a structured plan into markdown for the chat panel. */
export function renderPlanMarkdown(result: PlanResult): string {
  if (!result.ok) {
    return `**Planning failed**: [${result.error.code}] ${result.error.message}`;
  }
  const { plan } = result;
  const lines: string[] = [
    `## Plan: ${plan.summary}`,
    '',
    `- Complexity: **${plan.complexity}**`,
    `- Risk: **${plan.risk}**`,
    `- Confirmation required: ${plan.requiresConfirmation ? '**yes**' : 'no'}`,
    '',
    '### Steps',
    '',
  ];
  for (const step of plan.steps) {
    lines.push(`- **${step.id}** \`${step.type}\` — ${step.title}`);
    if (step.description) lines.push(`  ${step.description}`);
    if (step.requiresConfirmation) lines.push('  ⚠️ requires confirmation');
  }
  if (plan.assumptions.length > 0) {
    lines.push('', '### Assumptions', '');
    lines.push(...plan.assumptions.map((a) => `- ${a}`));
  }
  if (plan.expectedOutputs.length > 0) {
    lines.push('', '### Expected outputs', '');
    lines.push(...plan.expectedOutputs.map((o) => `- ${o}`));
  }
  return lines.join('\n');
}

/** Register the `devforge.plan` command. */
export function registerPlanCommand(deps: CommandDeps): vscode.Disposable {
  return deps.vscode.commands.registerCommand('devforge.plan', async () => {
    const goal = await promptText(
      deps,
      'What should DevForge plan?',
      'e.g. Add repository indexing to the CLI',
    );
    if (goal === undefined) return;
    appendUserMessage(deps, 'plan', [goal]);
    const result = await deps.sessions.execute('plan', goal);
    if (result.ok && isPlanResult(result.data)) {
      deps.chat.append('assistant', renderPlanMarkdown(result.data));
    } else {
      await handleResult(deps, result);
    }
    deps.tree.refreshHistory();
  });
}

/** Narrow the structured plan data from a command result. */
export function isPlanResult(value: unknown): value is PlanResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('ok' in value) &&
    ((value as { ok: boolean }).ok === true
      ? 'plan' in value && typeof (value as { plan: { steps?: unknown } }).plan === 'object'
      : 'error' in value)
  );
}
