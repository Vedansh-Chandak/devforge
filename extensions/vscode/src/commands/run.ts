/**
 * @devforge/vscode-extension — Run command (DF-020).
 *
 * `devforge.run` plans and executes a goal (Planner → Executor). Resulting
 * working-tree changes are surfaced as a pending diff preview.
 */

import type * as vscode from 'vscode';
import type { CommandDeps } from './deps.js';
import { promptText, appendUserMessage, handleResult, openWorkingTreeDiff } from './helpers.js';

/** Register the `devforge.run` command. */
export function registerRunCommand(deps: CommandDeps): vscode.Disposable {
  return deps.vscode.commands.registerCommand('devforge.run', async () => {
    const goal = await promptText(
      deps,
      'What should DevForge run?',
      'e.g. Add a status command and run it',
    );
    if (goal === undefined) return;
    appendUserMessage(deps, 'run', [goal]);
    const result = await deps.sessions.execute('run', goal);
    await handleResult(deps, result);
    if (result.ok) {
      await openWorkingTreeDiff(deps, 'DevForge: run changes', 'run');
    }
  });
}
