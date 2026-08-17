import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiffStore, DiffProvider } from '../../src/providers/diff-provider.js';
import { DiffError } from '../../src/errors.js';
import * as vscode from '../mocks/vscode.js';
import { GitDiff } from '@devforge/execution';

const SAMPLE_DIFF: GitDiff = {
  empty: false,
  files: [
    {
      oldPath: 'a.ts',
      newPath: 'a.ts',
      hunks: [
        { oldStart: 1, newStart: 1, oldLines: 1, newLines: 1, lines: [{ kind: 'addition', content: '+x' }] },
      ],
    },
  ],
} as GitDiff;

describe('DiffStore', () => {
  it('add registers a document with a stable uri and title text', () => {
    const store = new DiffStore();
    const doc = store.add(SAMPLE_DIFF, 'My title');
    expect(doc.uri).toMatch(/^devforge-diff:\/\/\//);
    expect(doc.files).toEqual(['a.ts']);
    expect(doc.pending).toBe(false);
    expect(doc.text).toContain('diff --git');
  });

  it('defaults pending to false and honors pending + patchId', () => {
    const store = new DiffStore();
    const doc = store.add(SAMPLE_DIFF, 't', { pending: true, patchId: 'p1' });
    expect(doc.pending).toBe(true);
    expect(doc.patchId).toBe('p1');
  });

  it('get returns a registered document by uri', () => {
    const store = new DiffStore();
    const doc = store.add(SAMPLE_DIFF, 't');
    expect(store.get(doc.uri)).toBe(doc);
    expect(store.get('nope')).toBeUndefined();
  });

  it('list returns all registered documents', () => {
    const store = new DiffStore();
    store.add(SAMPLE_DIFF, 'one');
    store.add(SAMPLE_DIFF, 'two');
    expect(store.list()).toHaveLength(2);
  });

  it('remove deletes a document', () => {
    const store = new DiffStore();
    const doc = store.add(SAMPLE_DIFF, 't');
    expect(store.remove(doc.uri)).toBe(true);
    expect(store.size).toBe(0);
    expect(store.remove('missing')).toBe(false);
  });

  it('tracks the size', () => {
    const store = new DiffStore();
    expect(store.size).toBe(0);
    store.add(SAMPLE_DIFF, 't');
    expect(store.size).toBe(1);
  });
});

describe('DiffProvider', () => {
  let reject: ReturnType<typeof vi.fn>;
  let accept: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vscode.__resetMocks();
    reject = vi.fn().mockResolvedValue(undefined);
    accept = vi.fn().mockResolvedValue(undefined);
  });

  function makeProvider(): DiffProvider {
    return new DiffProvider({ vscode: vscode as unknown as typeof import('vscode'), logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }, reject, accept });
  }

  it('register installs a text-document content provider and returns a disposable', () => {
    const provider = makeProvider();
    const disposable = provider.register();
    expect(vscode.__contentProviders.has('devforge-diff')).toBe(true);
    disposable.dispose();
    expect(vscode.__contentProviders.has('devforge-diff')).toBe(false);
  });

  it('content provider returns the diff text for a known uri', () => {
    const provider = makeProvider();
    provider.register();
    const doc = provider.storeRef.add(SAMPLE_DIFF, 't');
    const content = vscode.__contentProviders.get('devforge-diff')!.provideTextDocumentContent(vscode.Uri.parse(doc.uri));
    expect(content).toContain('diff --git');
  });

  it('content provider warns and returns a placeholder for unknown uris', () => {
    const warn = vi.fn();
    const provider = new DiffProvider({ vscode: vscode as unknown as typeof import('vscode'), logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }, reject, accept });
    provider.register();
    const content = vscode.__contentProviders.get('devforge-diff')!.provideTextDocumentContent(vscode.Uri.parse('devforge-diff:///unknown.diff'));
    expect(content).toBe('// No diff content available.');
    expect(warn).toHaveBeenCalled();
  });

  it('show opens the document and records it as current', async () => {
    const provider = makeProvider();
    const doc = await provider.show(SAMPLE_DIFF, 'Preview');
    expect(provider.current).toBe(doc);
    expect(vscode.__openedDocuments).toHaveLength(1);
    expect(vscode.__shownDocuments).toHaveLength(1);
  });

  it('acceptPatch accepts pending diffs', async () => {
    const provider = makeProvider();
    const doc = provider.storeRef.add(SAMPLE_DIFF, 't', { pending: true });
    await expect(provider.acceptPatch(doc)).resolves.toBe(true);
    expect(accept).toHaveBeenCalledWith(doc);
  });

  it('acceptPatch rejects read-only diffs', async () => {
    const provider = makeProvider();
    const doc = provider.storeRef.add(SAMPLE_DIFF, 't', { pending: false });
    await expect(provider.acceptPatch(doc)).rejects.toThrow(DiffError);
    expect(accept).not.toHaveBeenCalled();
  });

  it('rejectPatch rejects pending diffs via the reject hook', async () => {
    const provider = makeProvider();
    const doc = provider.storeRef.add(SAMPLE_DIFF, 't', { pending: true });
    await expect(provider.rejectPatch(doc)).resolves.toBe(true);
    expect(reject).toHaveBeenCalledWith(doc.files);
  });

  it('rejectPatch rejects read-only diffs', async () => {
    const provider = makeProvider();
    const doc = provider.storeRef.add(SAMPLE_DIFF, 't', { pending: false });
    await expect(provider.rejectPatch(doc)).rejects.toThrow(DiffError);
    expect(reject).not.toHaveBeenCalled();
  });
});
