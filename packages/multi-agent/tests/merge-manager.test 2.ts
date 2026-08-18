import { describe, expect, it } from 'vitest';
import {
  MergeManager,
  mergeResults,
  mergeableArtifacts,
} from '../src/execution/merge-manager.js';
import { ConflictResolver } from '../src/execution/conflict-resolver.js';
import type { TaskResult } from '../src/types.js';

function result(
  taskId: string,
  artifacts: Array<Record<string, unknown>>,
  status: TaskResult['status'] = 'SUCCEEDED',
): TaskResult {
  return {
    taskId,
    role: 'CODER',
    kind: 'IMPLEMENT',
    ok: status === 'SUCCEEDED',
    status,
    artifacts: artifacts as TaskResult['artifacts'],
    messages: [],
    attempts: 1,
    durationMs: 0,
    error: null,
  };
}

const file = (path: string, content: string, id: string) => ({
  path,
  kind: 'FILE',
  content,
  id: `${id}:impl`,
});

describe('mergeableArtifacts', () => {
  it('only collects artifacts from succeeded tasks', () => {
    const arts = mergeableArtifacts([
      result('a', [file('a.ts', '1', 'a')]),
      result('b', [file('b.ts', '2', 'b')], 'FAILED'),
      result('c', [file('c.ts', '3', 'c')]),
    ]);
    expect(arts.map((a) => a.path)).toEqual(['a.ts', 'c.ts']);
  });

  it('skips non-mergeable artifact kinds', () => {
    const arts = mergeableArtifacts([
      result('a', [
        file('a.ts', '1', 'a'),
        { path: 'n.md', kind: 'NOTE', content: 'x', id: 'a:note' },
        { path: 'p.json', kind: 'PLAN', content: 'x', id: 'a:plan' },
        { path: 'r.md', kind: 'REPORT', content: 'x', id: 'a:report' },
      ]),
    ]);
    expect(arts.map((a) => a.path)).toEqual(['a.ts']);
  });

  it('returns an empty list for no results', () => {
    expect(mergeableArtifacts([])).toEqual([]);
  });
});

describe('mergeResults', () => {
  it('merges disjoint paths', () => {
    const outcome = mergeResults([
      result('a', [file('a.ts', 'A', 'a')]),
      result('b', [file('b.ts', 'B', 'b')]),
    ]);
    expect(outcome.files.get('a.ts')).toBe('A');
    expect(outcome.files.get('b.ts')).toBe('B');
    expect(outcome.filesMerged).toBe(2);
    expect(outcome.conflicts).toEqual([]);
  });

  it('deduplicates identical contents for the same path', () => {
    const outcome = mergeResults([
      result('a', [file('a.ts', 'same', 'a')]),
      result('b', [file('a.ts', 'same', 'b')]),
    ]);
    expect(outcome.files.get('a.ts')).toBe('same');
    expect(outcome.deduped).toBe(1);
    expect(outcome.conflicts).toEqual([]);
  });

  it('flags distinct contents for the same path as a conflict', () => {
    const outcome = mergeResults([
      result('a', [file('a.ts', 'one', 'a')]),
      result('b', [file('a.ts', 'two', 'b')]),
    ]);
    expect(outcome.conflicts).toHaveLength(1);
    expect(outcome.conflicts[0]!.path).toBe('a.ts');
    expect(outcome.conflicts[0]!.taskIds).toEqual(['a', 'b']);
    // default KEEP_FIRST → first contributor wins
    expect(outcome.files.get('a.ts')).toBe('one');
  });

  it('reports unresolved conflicts as not resolved when content is null', () => {
    const resolver = new ConflictResolver({ fallback: 'MANUAL' });
    const outcome = mergeResults(
      [result('a', [file('a.ts', 'one', 'a')]), result('b', [file('a.ts', 'two', 'b')])],
      { resolver },
    );
    expect(outcome.conflicts[0]!.resolved).toBe(false);
    expect(outcome.files.has('a.ts')).toBe(false);
  });

  it('respects manualPaths by forcing unresolved conflicts', () => {
    const outcome = mergeResults(
      [result('a', [file('a.ts', 'one', 'a')]), result('b', [file('a.ts', 'two', 'b')])],
      { manualPaths: ['a.ts'] },
    );
    expect(outcome.conflicts[0]!.strategy).toBe('MANUAL');
    expect(outcome.conflicts[0]!.resolved).toBe(false);
  });

  it('concatenates overlapping doc/test contributions via default strategy', () => {
    const outcome = mergeResults([
      result('a', [{ path: 'doc.md', kind: 'DOC', content: 'd1', id: 'a:doc' }]),
      result('b', [{ path: 'doc.md', kind: 'DOC', content: 'd2', id: 'b:doc' }]),
    ]);
    expect(outcome.files.get('doc.md')).toBe('d1\n\nd2');
  });

  it('detects patch-overlap conflicts even with identical content', () => {
    const outcome = mergeResults([
      result('a', [{ path: 'a.ts', kind: 'PATCH', content: 'x', id: 'a:patch', hunks: [{ startLine: 1, lineCount: 3 }] }]),
      result('b', [{ path: 'a.ts', kind: 'PATCH', content: 'x', id: 'b:patch', hunks: [{ startLine: 1, lineCount: 3 }] }]),
    ]);
    expect(outcome.conflicts.find((c) => c.path === 'a.ts')?.resolved).toBe(true);
  });

  it('orders conflicts by path deterministically', () => {
    const outcome = mergeResults([
      result('a', [file('z.ts', 'z-a', 'a')]),
      result('b', [file('z.ts', 'z-b', 'b')]),
      result('a2', [file('a.ts', 'a-a', 'a2')]),
      result('b2', [file('a.ts', 'a-b', 'b2')]),
    ]);
    expect(outcome.conflicts.map((c) => c.path)).toEqual(['a.ts', 'z.ts']);
    expect(outcome.files.get('a.ts')).toBe('a-a');
    expect(outcome.files.get('z.ts')).toBe('z-a');
  });

  it('reports taskIds and artifactCount', () => {
    const outcome = mergeResults([
      result('a', [file('a.ts', '1', 'a'), file('b.ts', '2', 'b')]),
      result('c', [file('c.ts', '3', 'c')], 'FAILED'),
    ]);
    expect(outcome.taskIds).toEqual(['a', 'c']);
    expect(outcome.artifactCount).toBe(2);
  });

  it('returns an empty merge for no results', () => {
    const outcome = mergeResults([]);
    expect(outcome.files.size).toBe(0);
    expect(outcome.filesMerged).toBe(0);
    expect(outcome.deduped).toBe(0);
    expect(outcome.artifactCount).toBe(0);
  });

  it('resolves deterministically across invocations', () => {
    const inputs = [result('a', [file('a.ts', '1', 'a')]), result('b', [file('a.ts', '2', 'b')])];
    expect(mergeResults(inputs)).toEqual(mergeResults(inputs));
  });
});

describe('MergeManager', () => {
  it('delegates to mergeResults with configured resolver', () => {
    const manager = new MergeManager({ resolver: new ConflictResolver({ fallback: 'CONCATENATE' }) });
    const outcome = manager.merge([
      result('a', [file('a.ts', 'one', 'a')]),
      result('b', [file('a.ts', 'two', 'b')]),
    ]);
    expect(outcome.files.get('a.ts')).toBe('one\n\ntwo');
  });

  it('honours manualPaths from the constructor', () => {
    const manager = new MergeManager({ manualPaths: ['a.ts'] });
    const outcome = manager.merge([
      result('a', [file('a.ts', 'one', 'a')]),
    ]);
    expect(outcome.conflicts[0]!.resolved).toBe(false);
  });
});