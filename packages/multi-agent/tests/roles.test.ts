import { describe, expect, it } from 'vitest';
import { createPlannerAgent, defaultPlannerBackend } from '../src/roles/planner-agent.js';
import { createCoderAgent, defaultCoderBackend, slug, fnName } from '../src/roles/coder-agent.js';
import { createReviewerAgent, defaultReviewerBackend, reviewArtifacts } from '../src/roles/reviewer-agent.js';
import { createTesterAgent, defaultTesterBackend, testPathFor } from '../src/roles/tester-agent.js';
import { createRepairAgent, defaultRepairBackend, repairError } from '../src/roles/repair-agent.js';
import { createDocumentationAgent, defaultDocsBackend, docSlug, title } from '../src/roles/documentation-agent.js';
import { makeContext } from './helpers/mock.js';
import type { Task } from '../src/types.js';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Add auth flow',
    description: 'Add JWT auth',
    kind: 'IMPLEMENT',
    role: 'CODER',
    dependsOn: [],
    requiresConfirmation: false,
    timeoutMs: 1000,
    maxRetries: 1,
    ...overrides,
  };
}

describe('coder agent', () => {
  it('produces an implementation artifact at the target path', async () => {
    const result = await createCoderAgent().run(task({ target: 'src/auth.ts' }), makeContext());
    expect(result.role).toBe('CODER');
    expect(result.ok).toBe(true);
    expect(result.status).toBe('SUCCEEDED');
    expect(result.artifacts[0]).toMatchObject({ path: 'src/auth.ts', kind: 'FILE' });
    expect(result.artifacts[0]!.content).toContain('t1');
  });

  it('derives a slugged path when no target is given', async () => {
    const output = await defaultCoderBackend(task({ title: 'Add API Routes' }));
    expect(output.artifacts[0]!.path).toBe('src/add-api-routes.ts');
  });

  it('uses a custom backend when provided', async () => {
    const result = await createCoderAgent(() => ({
      ok: true,
      artifacts: [{ path: 'x.ts', kind: 'FILE', content: 'custom', id: 'x:impl' }],
      messages: ['custom'],
    })).run(task(), makeContext());
    expect(result.artifacts[0]!.content).toBe('custom');
    expect(result.messages).toEqual(['custom']);
  });

  it('propagates failure output', async () => {
    const result = await createCoderAgent(() => ({
      ok: false,
      artifacts: [],
      messages: [],
      error: { code: 'MA_X', message: 'nope', retryable: false },
    })).run(task(), makeContext());
    expect(result.ok).toBe(false);
    expect(result.status).toBe('FAILED');
    expect(result.error?.code).toBe('MA_X');
  });
});

describe('slug / fnName', () => {
  it('slugifies lowercase words', () => {
    expect(slug('Add API Routes')).toBe('add-api-routes');
  });

  it('strips punctuation', () => {
    expect(slug('Fix: bug & crash!')).toBe('fix-bug-crash');
  });

  it('falls back to a default slug for empty input', () => {
    expect(slug('@#$')).toBe('code');
  });

  it('derives a camelCase function name', () => {
    expect(fnName('Add auth flow')).toBe('addAuthFlow');
  });

  it('strips non-alphanumerics from fn names', () => {
    expect(fnName('Handle (edge) cases')).toBe('handleEdgeCases');
  });

  it('falls back for empty fn names', () => {
    expect(fnName('###')).toBe('implementation');
  });
});

describe('planner agent', () => {
  it('produces a deterministic PLAN artifact', async () => {
    const result = await createPlannerAgent().run(
      task({ kind: 'PLAN', role: 'PLANNER' }),
      makeContext(),
    );
    expect(result.role).toBe('PLANNER');
    expect(result.ok).toBe(true);
    expect(result.artifacts[0]!.kind).toBe('PLAN');
    expect(result.artifacts[0]!.path).toBe('plan/t1.json');
  });

  it('reuses the existing planner via buildPlanFor', async () => {
    const output = await defaultPlannerBackend(task({ description: 'add api' }));
    expect(output.messages[0]).toMatch(/plan for/);
  });

  it('includes step count in the plan content', async () => {
    const output = await defaultPlannerBackend(task({ description: 'add api' }));
    expect(output.artifacts[0]!.content).toMatch(/steps: \d+/);
  });
});

describe('tester agent', () => {
  it('produces a TEST artifact mapped from a source path', async () => {
    const result = await createTesterAgent().run(
      task({ kind: 'TEST', role: 'TESTER', target: 'src/auth.ts' }),
      makeContext(),
    );
    expect(result.role).toBe('TESTER');
    expect(result.artifacts[0]!.path).toBe('tests/auth.test.ts');
    expect(result.artifacts[0]!.kind).toBe('TEST');
    expect(result.artifacts[0]!.content).toContain("describe('Add auth flow'");
  });

  it('derives a test path from a slugged default', () => {
    expect(testPathFor('src/foo.ts')).toBe('tests/foo.test.ts');
  });

  it('leaves non-ts paths unchanged except suffix mapping', () => {
    expect(testPathFor('src/foo.js')).toBe('tests/foo.js');
  });
});

describe('documentation agent', () => {
  it('produces a DOC artifact', async () => {
    const result = await createDocumentationAgent().run(
      task({ kind: 'DOCUMENT', role: 'DOCUMENTATION' }),
      makeContext(),
    );
    expect(result.ok).toBe(true);
    expect(result.artifacts[0]!.kind).toBe('DOC');
    expect(result.artifacts[0]!.path).toBe('docs/add-auth-flow.md');
    expect(result.artifacts[0]!.content).toContain('# Add auth flow');
  });

  it('uses the target directly when provided', async () => {
    const output = await defaultDocsBackend(task({ target: 'docs/main.md' }));
    expect(output.artifacts[0]!.path).toBe('docs/main.md');
  });

  it('docSlug falls back safely', () => {
    expect(docSlug('Hello World')).toBe('hello-world');
    expect(docSlug('!!')).toBe('doc');
  });

  it('title sentence-cases a phrase', () => {
    expect(title('add  auth   flow')).toBe('Add auth flow');
    expect(title('   ')).toBe('Documentation');
  });
});

describe('repair agent', () => {
  it('produces a PATCH artifact with hunks', async () => {
    const result = await createRepairAgent().run(
      task({ kind: 'REPAIR', role: 'REPAIR', target: 'src/auth.ts' }),
      makeContext(),
    );
    expect(result.role).toBe('REPAIR');
    expect(result.ok).toBe(true);
    expect(result.artifacts[0]!.kind).toBe('PATCH');
    expect(result.artifacts[0]!.path).toBe('src/auth.ts');
    expect(result.artifacts[0]!.hunks).toBeDefined();
  });

  it('reads target fallback from title slug', async () => {
    const output = await defaultRepairBackend(task({ title: 'Fix flaky test' }));
    expect(output.artifacts[0]!.path).toBe('src/fix-flaky-test.ts');
  });

  it('repairError builds a non-retryable error', () => {
    const err = repairError('bad');
    expect(err).toEqual({ code: 'MA_REPAIR_FAILED', message: 'bad', retryable: false });
  });
});

describe('reviewer agent', () => {
  it('flags TODO markers as non-blocking when few', () => {
    const notes = reviewArtifacts([
      { path: 'a.ts', kind: 'FILE', content: '// TODO fix\n', id: 'a:impl' },
    ]);
    expect(notes.length).toBeGreaterThanOrEqual(1);
    expect(notes[0]!.blocking).toBe(false);
  });

  it('flags many TODOs as blocking', () => {
    const notes = reviewArtifacts([
      { path: 'a.ts', kind: 'FILE', content: '// TODO\n// TODO\n// TODO\n', id: 'a:impl' },
    ]);
    expect(notes.some((n) => n.blocking && n.comment.includes('TODO'))).toBe(true);
  });

  it('blocks files with no exported symbol', () => {
    const notes = reviewArtifacts([
      { path: 'a.ts', kind: 'FILE', content: 'const x = 1;\n', id: 'a:impl' },
    ]);
    expect(notes.some((n) => n.blocking && n.comment === 'no exported symbol detected')).toBe(true);
  });

  it('passes files with exports and no TODOs', () => {
    const notes = reviewArtifacts([
      { path: 'a.ts', kind: 'FILE', content: 'export function run() {}\n', id: 'a:impl' },
    ]);
    expect(notes).toEqual([]);
  });

  it('ignores non-reviewable artifact kinds', () => {
    const notes = reviewArtifacts([
      { path: 'p.json', kind: 'PLAN', content: '// TODO bad plan', id: 'p:plan' },
    ]);
    expect(notes).toEqual([]);
  });

  it('posts review comments to the conversation', async () => {
    const ctx = makeContext();
    ctx.artifacts.put({
      path: 'a.ts',
      kind: 'FILE',
      content: 'export function run() {}\n// TODO fix\n',
      id: 'a:impl',
    });
    await defaultReviewerBackend(
      task({ kind: 'REVIEW', role: 'REVIEWER', target: 'a.ts' }),
      ctx,
    );
    const comments = ctx.conversation.byType('REVIEW_COMMENT');
    expect(comments.length).toBeGreaterThan(0);
  });

  it('targets specific paths when a target is given', async () => {
    const ctx = makeContext();
    const output = await defaultReviewerBackend(
      task({ kind: 'REVIEW', role: 'REVIEWER', target: 'a.ts' }),
      ctx,
    );
    expect(output.artifacts[0]!.kind).toBe('NOTE');
    expect(output.artifacts[0]!.path).toBe('review/t1.md');
  });

  it('reviewArtifacts is deterministic and empty for empty input', () => {
    expect(reviewArtifacts([])).toEqual([]);
    expect(reviewArtifacts([])).toEqual(reviewArtifacts([]));
  });

  it('reviewArtifacts ignores NOTE and PATCH artifact kinds', () => {
    expect(
      reviewArtifacts([
        { path: 'r.md', kind: 'NOTE', content: 'no export', id: 'r:note' },
        { path: 'p.patch', kind: 'PATCH', content: 'no export', id: 'p:hunk' },
      ]),
    ).toEqual([]);
  });

  it('reviewArtifacts blocks a TEST file with no exported symbol', () => {
    const notes = reviewArtifacts([
      { path: 'a.test.ts', kind: 'TEST', content: "it('works', () => {})\n", id: 't1:test' },
    ]);
    expect(notes.some((n) => n.blocking && n.comment === 'no exported symbol detected')).toBe(true);
  });

  it('reviewArtifacts maps TODO content to an exported-symbol pass', () => {
    const notes = reviewArtifacts([
      {
        path: 'a.ts',
        kind: 'FILE',
        content: '// TODO one\n// TODO two\nexport function run() {}\n',
        id: 'a:impl',
      },
    ]);
    const todos = notes.filter((n) => n.comment.includes('TODO'));
    expect(todos.length).toBe(1);
    expect(todos[0]!.comment).toBe('2 TODO marker(s) present; resolve before merge');
  });
});