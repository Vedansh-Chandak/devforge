import { describe, it, expect, beforeEach } from 'vitest';
import { registerStatusCommand, isRepositoryContext } from '../../src/commands/status.js';
import { makeDeps, okResult } from '../helpers/deps.js';
import * as vscode from '../mocks/vscode.js';

const REPO = { root: '/repo', hasGit: true, branch: 'main', packageManager: 'pnpm' };

describe('isRepositoryContext', () => {
  it('recognizes repository contexts', () => {
    expect(isRepositoryContext(REPO)).toBe(true);
  });

  it('rejects non-contexts', () => {
    expect(isRepositoryContext({ root: '/repo' })).toBe(false);
    expect(isRepositoryContext(null)).toBe(false);
  });
});

describe('devforge.status command', () => {
  beforeEach(() => vscode.__resetMocks());

  it('executes status without prompting', async () => {
    const { deps, client } = makeDeps();
    registerStatusCommand(deps);
    await vscode.commands.executeCommand('devforge.status');
    expect(client.run).toHaveBeenCalledWith('status');
    expect(vscode.__inputBoxQueue).toHaveLength(0);
  });

  it('appends the result to the chat', async () => {
    const { deps } = makeDeps({ results: [okResult({ text: 'workspace ok' })] });
    registerStatusCommand(deps);
    await vscode.commands.executeCommand('devforge.status');
    expect(deps.chat.messages.find((m) => m.role === 'assistant')?.content).toBe('workspace ok');
  });

  it('refreshes the repository tree from the result payload', async () => {
    const { deps } = makeDeps({ results: [okResult({ data: REPO })] });
    const refreshed: unknown[] = [];
    const original = deps.tree.refreshRepository;
    deps.tree.refreshRepository = (repository?: unknown): void => { refreshed.push(repository); original(repository); };
    registerStatusCommand(deps);
    await vscode.commands.executeCommand('devforge.status');
    expect(refreshed).toEqual([REPO]);
  });
});
