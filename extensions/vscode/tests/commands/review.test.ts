import { describe, it, expect, beforeEach } from 'vitest';
import { registerReviewCommand, isReviewPayload } from '../../src/commands/review.js';
import { makeDeps, okResult } from '../helpers/deps.js';
import * as vscode from '../mocks/vscode.js';

const EMPTY_DIFF = { empty: true, files: [] };
const NON_EMPTY_DIFF = { empty: false, files: [{ oldPath: 'a.ts', newPath: 'a.ts', hunks: [] }] };

describe('isReviewPayload', () => {
  it('recognizes review payloads', () => {
    expect(isReviewPayload({ diff: EMPTY_DIFF, changedFiles: [] })).toBe(true);
  });

  it('rejects non-payloads', () => {
    expect(isReviewPayload({ diff: EMPTY_DIFF })).toBe(false);
    expect(isReviewPayload(null)).toBe(false);
  });
});

describe('devforge.review command', () => {
  beforeEach(() => vscode.__resetMocks());

  it('executes review without prompting', async () => {
    const { deps, client } = makeDeps();
    registerReviewCommand(deps);
    await vscode.commands.executeCommand('devforge.review');
    expect(client.run).toHaveBeenCalledWith('review');
    expect(vscode.__inputBoxQueue).toHaveLength(0);
  });

  it('shows a diff preview when the working tree changed', async () => {
    const { deps } = makeDeps({ results: [okResult({ data: { diff: NON_EMPTY_DIFF, changedFiles: ['a.ts'] } })] });
    registerReviewCommand(deps);
    await vscode.commands.executeCommand('devforge.review');
    expect(vscode.__openedDocuments).toHaveLength(1);
    expect(deps.diff.current).not.toBeNull();
  });

  it('notes when there are no working-tree changes', async () => {
    const { deps } = makeDeps({ results: [okResult({ data: { diff: EMPTY_DIFF, changedFiles: [] } })] });
    registerReviewCommand(deps);
    await vscode.commands.executeCommand('devforge.review');
    expect(vscode.__openedDocuments).toHaveLength(0);
    expect(deps.chat.messages.some((m) => m.content === 'No working-tree changes to preview.')).toBe(true);
  });

  it('does not open a diff for non-payload results', async () => {
    const { deps } = makeDeps({ results: [okResult({ data: null })] });
    registerReviewCommand(deps);
    await vscode.commands.executeCommand('devforge.review');
    expect(vscode.__openedDocuments).toHaveLength(0);
  });
});
