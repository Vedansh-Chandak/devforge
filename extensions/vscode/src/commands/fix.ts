/**
 * @devforge/vscode-extension — Fix command (DF-020).
 *
 * `devforge.fix` runs the autonomous coding loop. When the editor has an
 * active selection it is included as context, and the produced changes are
 * surfaced as a pending diff preview plus diagnostics.
 */

import type * as vscode from 'vscode';
import type { CommandDeps } from './deps.js';
import { promptText, appendUserMessage, handleResult, reportDiagnostics, openWorkingTreeDiff, publishDiagnostics } from './helpers.js';
import type { CodingReport } from '@devforge/execution';

/** Collect context from the active editor's selection, if any. */
export function selectedTextContext(vscodeNs: typeof import('vscode')): string | undefined {
  const editor = vscodeNs.window.activeTextEditor;
  if (!editor) return undefined;
  const selection = editor.selection;
  if (selection && !selection.isEmpty) {
    return editor.document.getText(selection);
  }
  return undefined;
}

/** Register the `devforge.fix` command. */
export function registerFixCommand(deps: CommandDeps): vscode.Disposable {
  return deps.vscode.commands.registerCommand('devforge.fix', async () => {
    const selected = selectedTextContext(deps.vscode);
    const goal = await promptText(
      deps,
      selected ? 'What should DevForge fix (with your selection as context)?' : 'What should DevForge fix?',
      'e.g. The failing executor test',
    );
    if (goal === undefined) return;
    appendUserMessage(deps, 'fix', [goal]);
    const result = await deps.sessions.execute('fix', goal);
    await handleResult(deps, result);

    if (result.ok && isCodingReport(result.data)) {
      const signals = reportDiagnostics(result.data);
      if (signals.length > 0) publishDiagnostics(deps, signals);
      await openWorkingTreeDiff(deps, 'DevForge: fix changes', 'fix');
    }
  });
}

/** Narrow the coding-report data from a fix result. */
export function isCodingReport(value: unknown): value is CodingReport {
  return (
    typeof value === 'object' &&
    value !== null &&
    'outcome' in value &&
    'transactions' in value &&
    'patchesGenerated' in value
  );
}
