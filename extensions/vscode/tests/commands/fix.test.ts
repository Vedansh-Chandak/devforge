import { describe, it, expect, beforeEach } from 'vitest';
import { registerFixCommand, selectedTextContext, isCodingReport } from '../../src/commands/fix.js';
import { makeDeps, okResult } from '../helpers/deps.js';
import * as vscode from '../mocks/vscode.js';

const CODING_REPORT = {
  outcome: 'fixed',
  transactions: [],
  patchesGenerated: true,
  diagnostics: [
    { source: 'tsc', diagnostics: [{ category: 'type', severity: 'error', message: 'bad type', file: 'a.ts', line: 1 }] },
  ],
};

describe('isCodingReport', () => {
  it('recognizes coding reports', () => {
    expect(isCodingReport(CODING_REPORT)).toBe(true);
  });

  it('rejects non-reports', () => {
    expect(isCodingReport({ ok: true })).toBe(false);
    expect(isCodingReport(null)).toBe(false);
  });
});

describe('selectedTextContext', () => {
  beforeEach(() => vscode.__resetMocks());

  it('returns undefined without an active editor', () => {
    expect(selectedTextContext(vscode as unknown as typeof import('vscode'))).toBeUndefined();
  });

  it('returns undefined for an empty selection', () => {
    vscode.__setActiveTextEditor(new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0)));
    expect(selectedTextContext(vscode as unknown as typeof import('vscode'))).toBeUndefined();
  });

  it('returns the selected text for a non-empty selection', () => {
    vscode.__setActiveTextEditor(new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 5)));
    const text = selectedTextContext(vscode as unknown as typeof import('vscode'));
    expect(text).toBe('const selected = true;');
  });
});

describe('devforge.fix command', () => {
  beforeEach(() => vscode.__resetMocks());

  it('executes fix and publishes diagnostics from the report', async () => {
    const { deps } = makeDeps({ results: [okResult({ data: CODING_REPORT })] });
    vscode.__inputBoxQueue.push('fix the type');
    registerFixCommand(deps);
    await vscode.commands.executeCommand('devforge.fix');
    expect(deps.chat.messages.find((m) => m.role === 'assistant')?.content).toBe('ok');
    const collection = vscode.__diagnosticCollections[0]!;
    expect(collection.entries.length).toBeGreaterThan(0);
  });

  it('does not publish diagnostics for non-report payloads', async () => {
    const { deps } = makeDeps({ results: [okResult({ data: null })] });
    vscode.__inputBoxQueue.push('goal');
    registerFixCommand(deps);
    await vscode.commands.executeCommand('devforge.fix');
    expect(vscode.__diagnosticCollections[0]!.entries).toHaveLength(0);
  });

  it('does nothing when cancelled', async () => {
    const { deps, client } = makeDeps();
    vscode.__inputBoxQueue.push(undefined);
    registerFixCommand(deps);
    await vscode.commands.executeCommand('devforge.fix');
    expect(client.run).not.toHaveBeenCalled();
  });
});
