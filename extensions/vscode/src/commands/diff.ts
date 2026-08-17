/**
 * @devforge/vscode-extension — Diff inline commands (DF-020).
 *
 * The inline "Apply Patch" / "Reject Patch" actions that operate on the most
 * recently shown pending diff preview.
 */

import type { CommandDeps } from './deps.js';

/** Register `devforge.diff.applyPatch` and `devforge.diff.rejectPatch`. */
export function registerDiffInlineCommands(deps: CommandDeps): ReturnType<typeof deps.vscode.Disposable.from> {
  const apply = deps.vscode.commands.registerCommand('devforge.diff.applyPatch', async () => {
    const document = deps.diff.current;
    if (!document) {
      deps.progress.notify('No DevForge diff preview is open.', 'warn');
      return;
    }
    try {
      await deps.diff.acceptPatch(document);
      deps.progress.notify('Patch accepted.', 'info');
      deps.tree.refreshHistory();
    } catch (error) {
      deps.progress.notify(`Apply failed: ${String(error)}`, 'error');
    }
  });

  const reject = deps.vscode.commands.registerCommand('devforge.diff.rejectPatch', async () => {
    const document = deps.diff.current;
    if (!document) {
      deps.progress.notify('No DevForge diff preview is open.', 'warn');
      return;
    }
    try {
      await deps.diff.rejectPatch(document);
      deps.progress.notify('Patch rejected — changes reverted.', 'info');
      deps.tree.refreshHistory();
    } catch (error) {
      deps.progress.notify(`Reject failed: ${String(error)}`, 'error');
    }
  });

  return deps.vscode.Disposable.from(apply, reject);
}
