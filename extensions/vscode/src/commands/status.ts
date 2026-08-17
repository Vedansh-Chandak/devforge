/**
 * @devforge/vscode-extension — Status command (DF-020).
 *
 * `devforge.status` reports workspace, provider, model, repository, and
 * engine version. The repository context tree is refreshed from the result.
 */

import type * as vscode from 'vscode';
import type { CommandDeps } from './deps.js';
import { appendUserMessage, handleResult } from './helpers.js';
import type { RepositoryContext } from '../types.js';

/** Narrow the repository context from a status result. */
export function isRepositoryContext(value: unknown): value is RepositoryContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    'root' in value &&
    'hasGit' in value &&
    'branch' in value
  );
}

/** Register the `devforge.status` command. */
export function registerStatusCommand(deps: CommandDeps): vscode.Disposable {
  return deps.vscode.commands.registerCommand('devforge.status', async () => {
    appendUserMessage(deps, 'status', []);
    const result = await deps.sessions.execute('status');
    await handleResult(deps, result);
    if (result.ok && isRepositoryContext(result.data)) {
      deps.tree.refreshRepository(result.data);
    }
  });
}
