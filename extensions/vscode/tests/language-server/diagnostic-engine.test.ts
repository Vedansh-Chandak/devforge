import { describe, it, expect } from 'vitest';
import { DiagnosticEngine, RuleDiagnostic } from '../../src/language-server.js';
import { DiagnosticSeverity } from 'vscode-languageserver/node';

describe('DiagnosticEngine', () => {
  it('produces no diagnostics for clean text', () => {
    expect(DiagnosticEngine.scanText('const x = 1;')).toEqual([]);
  });

  it('flags loose equality as an error', () => {
    const diags = DiagnosticEngine.scanText('if (a == b) {}');
    expect(diags.some((d) => d.code === 'devforge.eqeqeq' && d.severity === 'error')).toBe(true);
  });

  it('flags eval() as an error', () => {
    const diags = DiagnosticEngine.scanText('eval(code)');
    expect(diags.some((d) => d.code === 'devforge.no-eval' && d.severity === 'error')).toBe(true);
  });

  it('flags console logging as a warning', () => {
    const diags = DiagnosticEngine.scanText('console.log("x")');
    expect(diags.some((d) => d.code === 'devforge.no-console' && d.severity === 'warning')).toBe(true);
  });

  it('flags innerHTML assignment as a warning', () => {
    const diags = DiagnosticEngine.scanText('el.innerHTML = html');
    expect(diags.some((d) => d.code === 'devforge.no-innerhtml' && d.severity === 'warning')).toBe(true);
  });

  it('flags TODO markers as info', () => {
    const diags = DiagnosticEngine.scanText('// TODO: later');
    expect(diags.some((d) => d.code === 'devforge.todo' && d.severity === 'info')).toBe(true);
  });

  it('reports line and character positions', () => {
    const diags = DiagnosticEngine.scanText('a\nconsole.log("x")');
    const consoleDiag = diags.find((d) => d.code === 'devforge.no-console');
    expect(consoleDiag?.line).toBe(1);
  });

  it('sorts diagnostics by position', () => {
    const diags = DiagnosticEngine.scanText('console.log("x"); if (a == b) {}');
    const positions = diags.map((d) => d.line * 1_000_000 + d.character);
    expect([...positions].sort((x, y) => x - y)).toEqual(positions);
  });

  it('records end positions', () => {
    const diags = DiagnosticEngine.scanText('a == b');
    const diag = diags.find((d) => d.code === 'devforge.eqeqeq') as RuleDiagnostic;
    expect(diag.endCharacter).toBeGreaterThan(diag.character);
  });

  it('toLsp maps severities to LSP values', () => {
    const engine = new DiagnosticEngine();
    const error = engine.toLsp({ line: 0, character: 0, endLine: 0, endCharacter: 1, severity: 'error', message: 'e', code: 'x' }, 'file:///a.ts', 'a');
    expect(error.severity).toBe(DiagnosticSeverity.Error);
    const warn = engine.toLsp({ line: 0, character: 0, endLine: 0, endCharacter: 1, severity: 'warning', message: 'w', code: 'x' }, 'file:///a.ts', 'a');
    expect(warn.severity).toBe(DiagnosticSeverity.Warning);
    const info = engine.toLsp({ line: 0, character: 0, endLine: 0, endCharacter: 1, severity: 'info', message: 'i', code: 'x' }, 'file:///a.ts', 'a');
    expect(info.severity).toBe(DiagnosticSeverity.Information);
  });

  it('toLsp sets source and code', () => {
    const engine = new DiagnosticEngine();
    const lsp = engine.toLsp({ line: 0, character: 0, endLine: 0, endCharacter: 1, severity: 'error', message: 'm', code: 'devforge.x' }, 'file:///a.ts', 'a');
    expect(lsp.source).toBe('devforge');
    expect(lsp.code).toBe('devforge.x');
    expect(lsp.range).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 1 } });
  });
});
