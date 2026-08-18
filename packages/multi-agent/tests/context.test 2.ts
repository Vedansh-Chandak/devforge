import { describe, expect, it } from 'vitest';
import { ArtifactStore, createContext, isAborted } from '../src/context.js';
import { Conversation } from '../src/conversation.js';
import type { Artifact } from '../src/types.js';

const art = (path: string, content: string, id?: string): Artifact => ({ path, kind: 'FILE', content, id });

describe('ArtifactStore', () => {
  it('starts empty', () => {
    const store = new ArtifactStore();
    expect(store.size).toBe(0);
    expect(store.all()).toEqual([]);
  });

  it('stores and retrieves by key', () => {
    const store = new ArtifactStore();
    store.put(art('a.ts', 'x', 't1:file'));
    expect(store.get('t1:file')?.path).toBe('a.ts');
  });

  it('uses path as fallback key when no id', () => {
    const store = new ArtifactStore();
    store.put(art('a.ts', 'x'));
    expect(store.get('a.ts')?.content).toBe('x');
  });

  it('overwrites on duplicate key', () => {
    const store = new ArtifactStore();
    store.put(art('a.ts', 'v1', 'k'));
    store.put(art('a.ts', 'v2', 'k'));
    expect(store.get('k')?.content).toBe('v2');
    expect(store.size).toBe(1);
  });

  it('lists all artifacts', () => {
    const store = new ArtifactStore();
    store.put(art('a.ts', '1', 'a'));
    store.put(art('b.ts', '2', 'b'));
    expect(store.all()).toHaveLength(2);
  });

  it('filters by path', () => {
    const store = new ArtifactStore();
    store.put(art('a.ts', '1', 'a'));
    store.put(art('a.ts', '2', 'b'));
    store.put(art('b.ts', '3', 'c'));
    expect(store.byPath('a.ts')).toHaveLength(2);
  });

  it('clears', () => {
    const store = new ArtifactStore();
    store.put(art('a.ts', '1', 'a'));
    store.clear();
    expect(store.size).toBe(0);
  });
});

describe('createContext', () => {
  it('fills deterministic defaults', () => {
    const conversation = new Conversation('r');
    const ctx = createContext({ runId: 'r', workspaceRoot: '/w', conversation });
    expect(ctx.runId).toBe('r');
    expect(ctx.workspaceRoot).toBe('/w');
    expect(ctx.conversation).toBe(conversation);
    expect(ctx.artifacts.size).toBe(0);
    expect(ctx.data.size).toBe(0);
    expect(typeof ctx.now).toBe('function');
  });

  it('uses injected clock', () => {
    const conversation = new Conversation('r');
    const ctx = createContext({
      runId: 'r',
      workspaceRoot: '/w',
      conversation,
      now: () => 42,
    });
    expect(ctx.now()).toBe(42);
  });

  it('honours an abort signal', () => {
    const conversation = new Conversation('r');
    const controller = new AbortController();
    const ctx = createContext({
      runId: 'r',
      workspaceRoot: '/w',
      conversation,
      signal: controller.signal,
    });
    expect(isAborted(ctx)).toBe(false);
    controller.abort();
    expect(isAborted(ctx)).toBe(true);
  });

  it('reports not aborted when no signal', () => {
    const conversation = new Conversation('r');
    const ctx = createContext({ runId: 'r', workspaceRoot: '/w', conversation });
    expect(isAborted(ctx)).toBe(false);
  });

  it('exposes scratch data map', () => {
    const conversation = new Conversation('r');
    const ctx = createContext({ runId: 'r', workspaceRoot: '/w', conversation });
    ctx.data.set('key', 7);
    expect(ctx.data.get('key')).toBe(7);
  });

  it('carries optional git/targets passthrough', () => {
    const conversation = new Conversation('r');
    const targets = [{ id: 'typecheck', command: 'tsc', args: ['--noEmit'], cwd: '/' }];
    const ctx = createContext({
      runId: 'r',
      workspaceRoot: '/w',
      conversation,
      targets,
    });
    expect(ctx.targets).toBe(targets);
  });
});