import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerDiffInlineCommands } from '../../src/commands/diff.js';
import { makeDeps } from '../helpers/deps.js';
import * as vscode from '../mocks/vscode.js';

const DIFF = { empty: false, files: [{ oldPath: 'a.ts', newPath: 'a.ts', hunks: [] }] };

describe('devforge.diff inline commands', () => {
  beforeEach(() => vscode.__resetMocks());

  it('registers applyPatch and rejectPatch', () => {
    const { deps } = makeDeps();
    registerDiffInlineCommands(deps);
    expect(vscode.__commands.has('devforge.diff.applyPatch')).toBe(true);
    expect(vscode.__commands.has('devforge.diff.rejectPatch')).toBe(true);
  });

  it('warns when no diff preview is open', async () => {
    const { deps } = makeDeps();
    registerDiffInlineCommands(deps);
    await vscode.commands.executeCommand('devforge.diff.applyPatch');
    expect(vscode.__toasts.some((t) => t.kind === 'warn')).toBe(true);
    await vscode.commands.executeCommand('devforge.diff.rejectPatch');
    expect(vscode.__toasts.filter((t) => t.kind === 'warn')).toHaveLength(2);
  });

  it('applies a pending patch', async () => {
    const accepted = vi.fn().mockResolvedValue(undefined);
    const { deps } = makeDeps({ diffAccept: accepted });
    await deps.diff.show(DIFF, 't', { pending: true });
    registerDiffInlineCommands(deps);
    await vscode.commands.executeCommand('devforge.diff.applyPatch');
    expect(accepted).toHaveBeenCalledTimes(1);
    expect(vscode.__toasts.some((t) => t.kind === 'info' && t.message.includes('Patch accepted'))).toBe(true);
  });

  it('rejects a pending patch', async () => {
    const rejected = vi.fn().mockResolvedValue(undefined);
    const { deps } = makeDeps({ diffReject: rejected });
    await deps.diff.show(DIFF, 't', { pending: true });
    registerDiffInlineCommands(deps);
    await vscode.commands.executeCommand('devforge.diff.rejectPatch');
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(vscode.__toasts.some((t) => t.kind === 'info' && t.message.includes('Patch rejected'))).toBe(true);
  });

  it('toasts an error when apply fails on a pending diff', async () => {
    const { deps } = makeDeps({
      diffAccept: async (): Promise<void> => { throw new Error('git apply failed'); },
    });
    await deps.diff.show(DIFF, 't', { pending: true });
    registerDiffInlineCommands(deps);
    await vscode.commands.executeCommand('devforge.diff.applyPatch');
    expect(vscode.__toasts.some((t) => t.kind === 'error' && t.message.includes('Apply failed'))).toBe(true);
  });
});
