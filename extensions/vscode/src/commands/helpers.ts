/**
 * @devforge/vscode-extension — Command helpers (DF-020).
 *
 * Shared plumbing for the command handlers: text prompting, result handling,
 * and routing structured results into the chat/diff/diagnostics/tree views.
 */

import type { CommandDeps } from './deps.js';
import type { CommandResult, DevForgeCommand } from '../types.js';
import type { CodingReport } from '@devforge/execution';
import type { DiagnosticSignal, DiagnosticGroup } from '../providers/diagnostics-provider.js';
import type { FindingNode } from '../providers/tree-provider.js';

/** Prompt the user for a single line of text; returns undefined when cancelled. */
export async function promptText(
  deps: CommandDeps,
  prompt: string,
  placeHolder?: string,
): Promise<string | undefined> {
  const value = await deps.vscode.window.showInputBox({
    prompt,
    placeHolder,
    ignoreFocusOut: true,
  });
  return value?.trim() ? value : undefined;
}

/** Append a user message for the executed command. */
export function appendUserMessage(deps: CommandDeps, command: DevForgeCommand, args: readonly string[]): void {
  const arg = args[0];
  deps.chat.append('user', arg ? `**devforge ${command}** \`${arg}\`` : `**devforge ${command}**`);
}

/**
 * Route a command result into the views:
 *  - chat panel receives the rendered text,
 *  - failed results surface a toast,
 *  - the task-history tree refreshes.
 */
export async function handleResult(deps: CommandDeps, result: CommandResult): Promise<void> {
  deps.chat.append(result.ok ? 'assistant' : 'system', result.text);
  deps.tree.refreshHistory();
  if (!result.ok) {
    deps.progress.notify(result.error?.message ?? 'DevForge command failed.', 'error');
  }
}

/** Extract structured diagnostics from a fix/run coding report, if any. */
export function reportDiagnostics(report: CodingReport): readonly DiagnosticSignal[] {
  const groups: DiagnosticGroup[] = report.diagnostics.map((entry) => ({
    source: entry.source,
    diagnostics: entry.diagnostics,
  }));
  return groups.flatMap((group) => group.diagnostics);
}

/**
 * Show a diff preview for the working-tree changes after an execution
 * produced patches. Marked `pending` so the inline Apply/Reject flow works.
 */
export async function openWorkingTreeDiff(deps: CommandDeps, title: string, patchId?: string): Promise<void> {
  const client = deps.sessions.getActiveClient();
  if (!client) return;
  try {
    const diff = await client.diff();
    if (diff.empty) return;
    await deps.diff.show(diff, title, { pending: true, patchId });
  } catch (error) {
    deps.logger.warn(`Unable to open diff preview: ${String(error)}`);
  }
}

/** Build tree finding nodes from diagnostic signals. */
export function findingsFromSignals(signals: readonly DiagnosticSignal[]): readonly FindingNode[] {
  return signals.map((signal) => ({
    category: signal.category,
    file: signal.file ? signal.file : '(workspace)',
    line: signal.line,
    severity: signal.severity,
    message: signal.code ? `[${signal.code}] ${signal.message}` : signal.message,
  }));
}

/** Set diagnostics on the collection and refresh the diagnostics tree. */
export function publishDiagnostics(deps: CommandDeps, signals: readonly DiagnosticSignal[]): void {
  deps.diagnostics.set(signals);
  deps.tree.refreshDiagnostics();
}

/** Clear diagnostics from the collection and refresh the tree. */
export function clearDiagnostics(deps: CommandDeps): void {
  deps.diagnostics.clear();
  deps.tree.refreshDiagnostics();
}
