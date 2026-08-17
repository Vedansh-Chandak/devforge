/**
 * @devforge/vscode-extension — Review command (DF-020).
 *
 * `devforge.review` reviews pending changes. The working-tree diff is shown
 * as a read-only preview so the user can inspect what would be reviewed.
 */

import type * as vscode from 'vscode';
import type { CommandDeps } from './deps.js';
import { appendUserMessage, handleResult } from './helpers.js';
import type { GitDiff } from '@devforge/execution';

/** The shape of the review command's structured data payload. */
export interface ReviewPayload {
  readonly diff: GitDiff;
  readonly changedFiles: readonly string[];
}

/** Narrow the review payload from a command result. */
export function isReviewPayload(value: unknown): value is ReviewPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'diff' in value &&
    'changedFiles' in value
  );
}

/** Register the `devforge.review` command. */
export function registerReviewCommand(deps: CommandDeps): vscode.Disposable {
  return deps.vscode.commands.registerCommand('devforge.review', async () => {
    appendUserMessage(deps, 'review', []);
    const result = await deps.sessions.execute('review');
    await handleResult(deps, result);

    if (result.ok && isReviewPayload(result.data)) {
      if (!result.data.diff.empty) {
        await deps.diff.show(result.data.diff, 'DevForge: working tree (review)');
      } else {
        deps.chat.append('system', 'No working-tree changes to preview.');
      }
    }
  });
}
