import { describe, it, expect } from 'vitest';
import { CodeActionProvider, RuleDiagnostic } from '../../src/language-server.js';
import { CodeActionKind } from 'vscode-languageserver/node';

function eqeqeqDiagnostic(character = 2): RuleDiagnostic {
  return {
    line: 0,
    character,
    endLine: 0,
    endCharacter: character + 2,
    severity: 'error',
    message: 'Use strict equality.',
    code: 'devforge.eqeqeq',
  };
}

function consoleDiagnostic(character = 0): RuleDiagnostic {
  return {
    line: 0,
    character,
    endLine: 0,
    endCharacter: character + 15,
    severity: 'warning',
    message: 'Console logging found.',
    code: 'devforge.no-console',
  };
}

describe('CodeActionProvider', () => {
  it('returns no fixes for unknown diagnostics', () => {
    const diag: RuleDiagnostic = { line: 0, character: 0, endLine: 0, endCharacter: 1, severity: 'error', message: 'x', code: 'devforge.other' };
    expect(CodeActionProvider.fixesFor(diag, 'x')).toEqual([]);
  });

  it('replaces == with ===', () => {
    const fixes = CodeActionProvider.fixesFor(eqeqeqDiagnostic(), 'a == b');
    expect(fixes).toHaveLength(1);
    expect(fixes[0]?.kind).toBe(CodeActionKind.QuickFix);
    expect(fixes[0]?.title).toContain('===');
    expect(fixes[0]?.edit.newText).toBe('===');
  });

  it('replaces != with !==', () => {
    const diag = eqeqeqDiagnostic();
    const fixes = CodeActionProvider.fixesFor(diag, 'a != b');
    expect(fixes[0]?.edit.newText).toBe('!==');
  });

  it('anchors the edit at the diagnostic range', () => {
    const fixes = CodeActionProvider.fixesFor(eqeqeqDiagnostic(2), 'a == b');
    expect(fixes[0]?.edit.range).toEqual({
      start: { line: 0, character: 2 },
      end: { line: 0, character: 4 },
    });
  });

  it('removes console calls', () => {
    const fixes = CodeActionProvider.fixesFor(consoleDiagnostic(), 'console.log("x")');
    expect(fixes[0]?.title).toBe('Remove console call');
    expect(fixes[0]?.edit.newText).toBe('');
  });

  it('fixFor instance delegates to the static implementation', () => {
    const provider = new CodeActionProvider();
    const fixes = provider.fixFor(eqeqeqDiagnostic(), 'a == b');
    expect(fixes[0]?.edit.newText).toBe('===');
  });
});
