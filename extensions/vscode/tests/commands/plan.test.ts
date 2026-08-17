import { describe, it, expect, beforeEach } from 'vitest';
import { registerPlanCommand, renderPlanMarkdown, isPlanResult } from '../../src/commands/plan.js';
import { makeDeps, okResult } from '../helpers/deps.js';
import * as vscode from '../mocks/vscode.js';

const OK_PLAN = {
  ok: true,
  plan: {
    summary: 'Add repo indexing',
    complexity: 'medium',
    risk: 'low',
    requiresConfirmation: false,
    steps: [
      { id: '1', type: 'edit', title: 'Write indexer', description: 'scan files', requiresConfirmation: false },
    ],
    assumptions: ['node installed'],
    expectedOutputs: ['index.json'],
  },
};

describe('renderPlanMarkdown', () => {
  it('renders a failed plan', () => {
    const text = renderPlanMarkdown({ ok: false, error: { code: 'X', message: 'no plan', retryable: false } });
    expect(text).toContain('no plan');
    expect(text).toContain('[X]');
  });

  it('renders the plan summary and metadata', () => {
    const text = renderPlanMarkdown(OK_PLAN as never);
    expect(text).toContain('Add repo indexing');
    expect(text).toContain('medium');
    expect(text).toContain('low');
  });

  it('renders each step', () => {
    const text = renderPlanMarkdown(OK_PLAN as never);
    expect(text).toContain('**1**');
    expect(text).toContain('Write indexer');
  });

  it('renders assumptions and expected outputs', () => {
    const text = renderPlanMarkdown(OK_PLAN as never);
    expect(text).toContain('node installed');
    expect(text).toContain('index.json');
  });

  it('notes confirmation requirements', () => {
    const plan = {
      ok: true,
      plan: { ...OK_PLAN.plan, requiresConfirmation: true, steps: [{ id: '1', type: 'edit', title: 'Step', description: '', requiresConfirmation: true }] },
    };
    const text = renderPlanMarkdown(plan as never);
    expect(text).toContain('yes');
    expect(text).toContain('requires confirmation');
  });
});

describe('isPlanResult', () => {
  it('recognizes successful plan results', () => {
    expect(isPlanResult(OK_PLAN)).toBe(true);
  });

  it('recognizes failed plan results', () => {
    expect(isPlanResult({ ok: false, error: { code: 'X', message: 'm', retryable: false } })).toBe(true);
  });

  it('rejects non-plan payloads', () => {
    expect(isPlanResult(null)).toBe(false);
    expect(isPlanResult({ diff: {} })).toBe(false);
    expect(isPlanResult('plan')).toBe(false);
  });
});

describe('devforge.plan command', () => {
  beforeEach(() => vscode.__resetMocks());

  it('renders structured plans into the chat', async () => {
    const { deps, client } = makeDeps({ results: [okResult({ data: OK_PLAN })] });
    vscode.__inputBoxQueue.push('add repo indexing');
    registerPlanCommand(deps);
    await vscode.commands.executeCommand('devforge.plan');
    expect(client.run).toHaveBeenCalledWith('plan', 'add repo indexing');
    const assistant = deps.chat.messages.find((m) => m.role === 'assistant');
    expect(assistant?.content).toContain('Add repo indexing');
  });

  it('falls back to the result text for non-plan payloads', async () => {
    const { deps } = makeDeps({ results: [okResult({ text: 'plain plan text', data: null })] });
    vscode.__inputBoxQueue.push('goal');
    registerPlanCommand(deps);
    await vscode.commands.executeCommand('devforge.plan');
    expect(deps.chat.messages.find((m) => m.role === 'assistant')?.content).toBe('plain plan text');
  });

  it('does nothing when cancelled', async () => {
    const { deps, client } = makeDeps();
    vscode.__inputBoxQueue.push(undefined);
    registerPlanCommand(deps);
    await vscode.commands.executeCommand('devforge.plan');
    expect(client.run).not.toHaveBeenCalled();
  });
});
