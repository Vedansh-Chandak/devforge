import { describe, it, expect } from 'vitest';
import { SymbolExtractor, toDocumentSymbols } from '../../src/language-server.js';
import { SymbolKind } from 'vscode-languageserver/node';

describe('SymbolExtractor', () => {
  it('extracts no symbols from empty text', () => {
    expect(SymbolExtractor.extractSymbols('')).toEqual([]);
  });

  it('extracts a class symbol', () => {
    const symbols = SymbolExtractor.extractSymbols('class Foo {}');
    expect(symbols).toHaveLength(1);
    expect(symbols[0]).toMatchObject({ name: 'Foo', kind: SymbolKind.Class, line: 0, character: 0 });
  });

  it('extracts an interface symbol', () => {
    const symbols = SymbolExtractor.extractSymbols('interface Bar {}');
    expect(symbols[0]?.name).toBe('Bar');
    expect(symbols[0]?.kind).toBe(SymbolKind.Interface);
  });

  it('extracts function declarations', () => {
    const symbols = SymbolExtractor.extractSymbols('function baz() {}');
    expect(symbols[0]?.name).toBe('baz');
    expect(symbols[0]?.kind).toBe(SymbolKind.Function);
  });

  it('extracts arrow-style const variables', () => {
    const symbols = SymbolExtractor.extractSymbols('const value = 1;');
    expect(symbols[0]?.name).toBe('value');
    expect(symbols[0]?.kind).toBe(SymbolKind.Variable);
  });

  it('extracts multiple symbols in document order', () => {
    const symbols = SymbolExtractor.extractSymbols('const a = 1;\nfunction b() {}\nclass C {}');
    expect(symbols.map((s) => s.name)).toEqual(['a', 'b', 'C']);
  });

  it('extracts nested class members as children', () => {
    const symbols = SymbolExtractor.extractSymbols('class Foo {\n  const x = 1;\n  bar() {}\n}');
    const foo = symbols.find((s) => s.name === 'Foo');
    expect(foo?.children.length).toBeGreaterThan(0);
  });

  it('does not duplicate symbols at the same position', () => {
    const symbols = SymbolExtractor.extractSymbols('const a = 1;');
    const a = symbols.filter((s) => s.name === 'a');
    expect(a).toHaveLength(1);
  });

  it('records end lines for symbols', () => {
    const symbols = SymbolExtractor.extractSymbols('class Foo {}');
    expect(symbols[0]?.endLine).toBe(0);
  });
});

describe('toDocumentSymbols', () => {
  it('maps extracted symbols to LSP document symbols', () => {
    const symbols = SymbolExtractor.extractSymbols('class Foo {}');
    const docs = toDocumentSymbols(symbols);
    expect(docs[0]).toMatchObject({ name: 'Foo', kind: SymbolKind.Class });
    expect(docs[0]?.range.start).toEqual({ line: 0, character: 0 });
    expect(docs[0]?.range.end.character).toBe(3);
  });

  it('maps nested children recursively', () => {
    const symbols = SymbolExtractor.extractSymbols('class Foo {\n  bar() {}\n}');
    const docs = toDocumentSymbols(symbols);
    expect(docs[0]?.children.length).toBeGreaterThan(0);
  });

  it('returns an empty array for no symbols', () => {
    expect(toDocumentSymbols([])).toEqual([]);
  });
});
