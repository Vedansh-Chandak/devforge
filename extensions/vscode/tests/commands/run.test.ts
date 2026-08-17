import { describe, it, expect, beforeEach } from 'vitest';
import { registerRunCommand } from '../../src/commands/run.js';
import { makeDeps } from '../helpers/deps.js';
import * as vscode from '../mocks/vscode.js';

describe('devforge.run command', () => {
  beforeEach(() => vscode.__resetMocks());

  it('executes run with the goal and opens a diff preview on success', async () => {
    const { deps, client } = makeDeps();
    vscode.__inputBoxQueue.push('add a status command');
    registerRunCommand(deps);
    await vscode.commands.executeCommand('devforge.run');
    expect(client.run).toHaveBeenCalledWith('run', 'add a status command');
    expect(deps.chat.messages.find((m) => m.role === 'assistant')?.content).toBe('ok');
    expect(vscode.__openedDocuments).toHaveLength(1);
  });

  it('does not open a diff preview on failure', async () => {
    const { deps } = makeDeps({ results: [{ command: 'run', args: ['x'], ok: false, text: 'failed', data: null, durationMs: 1, error: { code: 'E', message: 'boom' } }] });
    vscode.__inputBoxQueue.push('x');
    registerRunCommand(deps);
    await vscode.commands.executeCommand('devforge.run');
    expect(vscode.__openedDocuments).toHaveLength(0);
    expect(vscode.__toasts.some((t) => t.kind === 'error')).toBe(true);
  });

  it('does nothing when cancelled', async () => {
    const { deps, client } = makeDeps();
    vscode.__inputBoxQueue.push(undefined);
    registerRunCommand(deps);
    await vscode.commands.executeCommand('devforge.run');
    expect(client.run).not.toHaveBeenCalled();
  });
});
