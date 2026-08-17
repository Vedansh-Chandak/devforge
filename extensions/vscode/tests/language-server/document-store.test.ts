import { describe, it, expect } from 'vitest';
import { DocumentStore, applyChange } from '../../src/language-server.js';

describe('DocumentStore', () => {
  it('starts empty', () => {
    const store = new DocumentStore();
    expect(store.size).toBe(0);
    expect(store.all()).toEqual([]);
  });

  it('open registers a document with full text', () => {
    const store = new DocumentStore();
    const doc = store.open('file:///a.ts', 'typescript', 'hello', 3);
    expect(doc).toMatchObject({ uri: 'file:///a.ts', languageId: 'typescript', text: 'hello', version: 3 });
    expect(store.get('file:///a.ts')).toBe(doc);
  });

  it('open defaults the version to 1', () => {
    const store = new DocumentStore();
    expect(store.open('file:///a.ts', 'typescript', 'x').version).toBe(1);
  });

  it('close removes a document and reports existence', () => {
    const store = new DocumentStore();
    store.open('file:///a.ts', 'typescript', 'x');
    expect(store.close('file:///a.ts')).toBe(true);
    expect(store.close('file:///a.ts')).toBe(false);
    expect(store.size).toBe(0);
  });

  it('all returns every tracked document', () => {
    const store = new DocumentStore();
    store.open('file:///a.ts', 'typescript', 'x');
    store.open('file:///b.ts', 'javascript', 'y');
    expect(store.all().map((d) => d.uri).sort()).toEqual(['file:///a.ts', 'file:///b.ts']);
  });

  it('update applies a full-text replacement', () => {
    const store = new DocumentStore();
    store.open('file:///a.ts', 'typescript', 'old text', 1);
    const updated = store.update('file:///a.ts', [{ text: 'new text' }], 2);
    expect(updated?.text).toBe('new text');
    expect(updated?.version).toBe(2);
  });

  it('update applies an incremental change within a range', () => {
    const store = new DocumentStore();
    store.open('file:///a.ts', 'typescript', 'abcdef', 1);
    const updated = store.update(
      'file:///a.ts',
      [{ text: 'X', range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } } }],
      2,
    );
    expect(updated?.text).toBe('aXdef');
  });

  it('update returns undefined for an unknown uri', () => {
    const store = new DocumentStore();
    expect(store.update('file:///missing.ts', [{ text: 'x' }], 1)).toBeUndefined();
  });

  it('offsetOf resolves a position to an absolute offset', () => {
    expect(DocumentStore.offsetOf('ab\ncd', 1, 1)).toBe(4);
  });

  it('offsetOf clamps the line to the document bounds', () => {
    expect(DocumentStore.offsetOf('ab\ncd', 99, 0)).toBe(3);
  });

  it('positionOf resolves an offset to a line/character', () => {
    expect(DocumentStore.positionOf('ab\ncd', 4)).toEqual({ line: 1, character: 1 });
  });

  it('positionOf clamps an oversized offset', () => {
    expect(DocumentStore.positionOf('ab', 99)).toEqual({ line: 0, character: 2 });
  });
});

describe('applyChange', () => {
  it('replaces the full text when no range is given', () => {
    expect(applyChange('old', { text: 'new' })).toBe('new');
  });

  it('splices text within a range', () => {
    const change = {
      text: 'X',
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } },
    };
    expect(applyChange('hello', change)).toBe('Xllo');
  });

  it('handles multi-line ranges', () => {
    const change = {
      text: 'replacement',
      range: { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } },
    };
    expect(applyChange('a\nb\nc', change)).toBe('replacementc');
  });
});
