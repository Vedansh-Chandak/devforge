import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  flattenDiagnostics,
  groupSignalsByFile,
  countDiagnostics,
  toFindingNodes,
  DiagnosticsProvider,
  DiagnosticSignal,
} from '../../src/providers/diagnostics-provider.js';
import * as vscode from '../mocks/vscode.js';

const errorSignal: DiagnosticSignal = { category: 'lint', severity: 'error', message: 'bad', file: 'a.ts', line: 2, column: 3, code: 'E1' };
const warningSignal: DiagnosticSignal = { category: 'lint', severity: 'warning', message: 'warn', file: 'a.ts' };
const noFileSignal: DiagnosticSignal = { category: 'doctor', severity: 'error', message: 'no file', file: '' };

describe('flattenDiagnostics', () => {
  it('flattens groups into a single list', () => {
    const flat = flattenDiagnostics([
      { source: 's1', diagnostics: [errorSignal] },
      { source: 's2', diagnostics: [warningSignal, noFileSignal] },
    ]);
    expect(flat).toHaveLength(3);
  });

  it('returns an empty list for no groups', () => {
    expect(flattenDiagnostics([])).toEqual([]);
  });
});

describe('groupSignalsByFile', () => {
  it('groups signals by file path', () => {
    const grouped = groupSignalsByFile([errorSignal, warningSignal, noFileSignal]);
    expect(grouped.get('a.ts')).toHaveLength(2);
    expect(grouped.get('')).toHaveLength(1);
  });

  it('maps file-less signals to the empty key', () => {
    expect(groupSignalsByFile([noFileSignal]).has('')).toBe(true);
  });
});

describe('countDiagnostics', () => {
  it('counts errors and warnings separately', () => {
    expect(countDiagnostics([errorSignal, errorSignal, warningSignal])).toEqual({ errors: 2, warnings: 1 });
  });

  it('returns zeros for an empty list', () => {
    expect(countDiagnostics([])).toEqual({ errors: 0, warnings: 0 });
  });
});

describe('toFindingNodes', () => {
  it('maps signals into finding nodes', () => {
    const nodes = toFindingNodes([errorSignal]);
    expect(nodes[0]).toMatchObject({ category: 'lint', file: 'a.ts', line: 2, severity: 'error' });
  });

  it('prefixes the code when present', () => {
    expect(toFindingNodes([errorSignal])[0]?.message).toBe('[E1] bad');
  });

  it('uses a placeholder file for file-less signals', () => {
    expect(toFindingNodes([noFileSignal])[0]?.file).toBe('(workspace)');
  });
});

describe('DiagnosticsProvider', () => {
  beforeEach(() => vscode.__resetMocks());

  function makeProvider(workspaceRoot = '/ws'): DiagnosticsProvider {
    return new DiagnosticsProvider({ vscode: vscode as unknown as typeof import('vscode'), workspaceRoot });
  }

  it('creates a diagnostic collection on construction', () => {
    makeProvider();
    expect(vscode.__diagnosticCollections).toHaveLength(1);
    expect(vscode.__diagnosticCollections[0]?.name).toBe('devforge');
  });

  it('toDiagnostic builds an error diagnostic with source', () => {
    const provider = makeProvider();
    const diag = provider.toDiagnostic(errorSignal);
    expect(diag.message).toBe('bad');
    expect(diag.source).toBe('devforge');
    expect(diag.code).toBe('E1');
    expect(diag.severity).toBe(vscode.DiagnosticSeverity.Error);
  });

  it('toDiagnostic maps warnings and zero-based lines', () => {
    const provider = makeProvider();
    const diag = provider.toDiagnostic({ ...warningSignal, line: 1, column: 1 });
    expect(diag.severity).toBe(vscode.DiagnosticSeverity.Warning);
    expect(diag.range.start.line).toBe(0);
    expect(diag.range.start.character).toBe(0);
  });

  it('set pushes grouped diagnostics onto the collection', () => {
    const provider = makeProvider('/ws');
    provider.set([errorSignal, warningSignal]);
    const collection = vscode.__diagnosticCollections[0]!;
    expect(collection.entries).toHaveLength(1);
    const [uri, diagnostics] = collection.entries[0]!;
    expect(uri.fsPath).toBe('/ws/a.ts');
    expect(diagnostics).toHaveLength(2);
  });

  it('set skips file-less signals', () => {
    const provider = makeProvider();
    provider.set([noFileSignal]);
    expect(vscode.__diagnosticCollections[0]!.entries).toHaveLength(0);
  });

  it('clear empties the collection', () => {
    const provider = makeProvider();
    provider.set([errorSignal]);
    provider.clear();
    expect(vscode.__diagnosticCollections[0]!.entries).toHaveLength(0);
  });

  it('resolves absolute paths unchanged', () => {
    const provider = makeProvider('/ws');
    const uri = (provider as unknown as { resolveUri: (f: string) => vscode.Uri | null }).resolveUri('/abs/a.ts');
    expect(uri?.fsPath).toBe('/abs/a.ts');
  });

  it('fromHealthCheck builds a doctor signal', () => {
    const signal = DiagnosticsProvider.fromHealthCheck(vscode as unknown as typeof import('vscode'), 'git', 'missing');
    expect(signal).toEqual({ category: 'doctor', severity: 'error', message: 'git: missing', file: '' });
  });

  it('treeId is stable for identical signals', () => {
    expect(DiagnosticsProvider.treeId(errorSignal)).toBe(DiagnosticsProvider.treeId(errorSignal));
    expect(DiagnosticsProvider.treeId(errorSignal)).not.toBe(DiagnosticsProvider.treeId(warningSignal));
  });
});
