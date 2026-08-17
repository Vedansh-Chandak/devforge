import { describe, it, expect, beforeEach } from 'vitest';
import { registerAskCommand, registerExplainCommand } from '../../src/commands/ask.js';
import { makeDeps, okResult } from '../helpers/deps.js';
import * as vscode from '../mocks/vscode.js';

describe('devforge.ask command', () => {
  beforeEach(() => vscode.__resetMocks());

  it('registers the command', () => {
    const { deps } = makeDeps();
    registerAskCommand(deps);
    expect(vscode.__commands.has('devforge.ask')).toBe(true);
  });

  it('executes ask when the user provides input', async () => {
    const { deps, client } = makeDeps();
    vscode.__inputBoxQueue.push('how do I x?');
    registerAskCommand(deps);
    await vscode.commands.executeCommand('devforge.ask');
    expect(client.run).toHaveBeenCalledWith('ask', 'how do I x?');
    expect(deps.chat.messages).toHaveLength(2);
    expect(deps.chat.messages[1]?.content).toBe('ok');
  });

  it('does nothing when the input is cancelled', async () => {
    const { deps, client } = makeDeps();
    vscode.__inputBoxQueue.push(undefined);
    registerAskCommand(deps);
    await vscode.commands.executeCommand('devforge.ask');
    expect(client.run).not.toHaveBeenCalled();
    expect(deps.chat.messages).toHaveLength(0);
  });

  it('ignores blank input', async () => {
    const { deps, client } = makeDeps();
    vscode.__inputBoxQueue.push('   ');
    registerAskCommand(deps);
    await vscode.commands.executeCommand('devforge.ask');
    expect(client.run).not.toHaveBeenCalled();
  });

  it('appends a user message quoting the question', async () => {
    const { deps } = makeDeps();
    vscode.__inputBoxQueue.push('q');
    registerAskCommand(deps);
    await vscode.commands.executeCommand('devforge.ask');
    expect(deps.chat.messages[0]?.content).toContain('q');
  });
});

describe('devforge.explain command', () => {
  beforeEach(() => vscode.__resetMocks());

  it('executes explain with the topic', async () => {
    const { deps, client } = makeDeps();
    vscode.__inputBoxQueue.push('the verification pipeline');
    registerExplainCommand(deps);
    await vscode.commands.executeCommand('devforge.explain');
    expect(client.run).toHaveBeenCalledWith('explain', 'the verification pipeline');
  });

  it('does nothing when cancelled', async () => {
    const { deps, client } = makeDeps();
    vscode.__inputBoxQueue.push(undefined);
    registerExplainCommand(deps);
    await vscode.commands.executeCommand('devforge.explain');
    expect(client.run).not.toHaveBeenCalled();
  });

  it('surfaces failures to the chat as a system message', async () => {
    const { deps } = makeDeps({ results: [okResult({ ok: false, error: { code: 'E', message: 'nope' }, text: 'explain failed' })] });
    vscode.__inputBoxQueue.push('topic');
    registerExplainCommand(deps);
    await vscode.commands.executeCommand('devforge.explain');
    expect(deps.chat.messages[1]?.role).toBe('system');
    expect(vscode.__toasts.some((t) => t.kind === 'error')).toBe(true);
  });
});
