/**
 * @devforge/vscode-extension — Ask & Explain commands (DF-020).
 *
 * `devforge.ask` runs the full autonomous pipeline (Brain → Planner →
 * Executor). `devforge.explain` explains a topic using repository context.
 */

import type * as vscode from 'vscode';
import type { CommandDeps } from './deps.js';
import { promptText, appendUserMessage, handleResult } from './helpers.js';

/** Register the `devforge.ask` command. */
export function registerAskCommand(deps: CommandDeps): vscode.Disposable {
  return deps.vscode.commands.registerCommand('devforge.ask', async () => {
    const question = await promptText(
      deps,
      'Ask DevForge',
      'e.g. How does the executor handle rollbacks?',
    );
    if (question === undefined) return;
    appendUserMessage(deps, 'ask', [question]);
    const result = await deps.sessions.execute('ask', question);
    await handleResult(deps, result);
  });
}

/** Register the `devforge.explain` command. */
export function registerExplainCommand(deps: CommandDeps): vscode.Disposable {
  return deps.vscode.commands.registerCommand('devforge.explain', async () => {
    const topic = await promptText(
      deps,
      'Explain a topic using repository context',
      'e.g. The verification pipeline',
    );
    if (topic === undefined) return;
    appendUserMessage(deps, 'explain', [topic]);
    const result = await deps.sessions.execute('explain', topic);
    await handleResult(deps, result);
  });
}
