import { describe, expect, it } from 'vitest';
import { decomposeRequest, titleToPath, titleCase, toTask } from '../src/selection/task-decomposer.js';
import { MultiAgentDecompositionError } from '../src/errors.js';

describe('decomposeRequest', () => {
  it('returns a deterministic decomposition for JWT auth', () => {
    const tasks = decomposeRequest('Implement JWT auth');
    expect(tasks.map((t) => t.title)).toEqual([
      'Plan Implement JWT auth',
      'Implement authentication',
      'Implement JWT signing and verification',
      'Add tests for task-2',
      'Document task-2',
      'Review implementation',
    ]);
  });

  it('maps keyword rules to ordered subtasks', () => {
    const tasks = decomposeRequest('Implement JWT auth with middleware and routes');
    expect(tasks.map((t) => t.title)).toEqual([
      'Plan Implement JWT auth with middleware and routes',
      'Add middleware',
      'Update routes',
      'Implement authentication',
      'Implement JWT signing and verification',
      'Add tests for task-2',
      'Document task-2',
      'Review implementation',
    ]);
  });

  it('splits requests into deterministic subtasks', () => {
    const a = decomposeRequest('Implement JWT auth');
    const b = decomposeRequest('Implement JWT auth');
    expect(a).toEqual(b);
  });

  it('produces strictly increasing task ids', () => {
    const tasks = decomposeRequest('add endpoints and tests and docs');
    expect(tasks.map((t) => t.id)).toEqual(
      tasks.map((_, i) => `task-${i + 1}`),
    );
  });

  it('chains test and doc tasks after implementation', () => {
    const tasks = decomposeRequest('add api');
    const impl = tasks.find((t) => t.kind === 'IMPLEMENT')!;
    const test = tasks.find((t) => t.kind === 'TEST')!;
    const doc = tasks.find((t) => t.kind === 'DOCUMENT')!;
    expect(test.dependsOn).toContain(impl.id);
    expect(doc.dependsOn).toContain(impl.id);
  });

  it('includes a leading plan by default', () => {
    const tasks = decomposeRequest('add api');
    expect(tasks[0].kind).toBe('PLAN');
  });

  it('can omit the plan', () => {
    const tasks = decomposeRequest('add api', { includePlan: false });
    expect(tasks.some((t) => t.kind === 'PLAN')).toBe(false);
  });

  it('can omit tests', () => {
    const tasks = decomposeRequest('add api', { includeTests: false });
    expect(tasks.some((t) => t.kind === 'TEST')).toBe(false);
  });

  it('can omit docs', () => {
    const tasks = decomposeRequest('add api', { includeDocs: false });
    expect(tasks.some((t) => t.kind === 'DOCUMENT')).toBe(false);
  });

  it('can omit review', () => {
    const tasks = decomposeRequest('add api', { includeReview: false });
    expect(tasks.some((t) => t.kind === 'REVIEW')).toBe(false);
  });

  it('always produces an implementation task', () => {
    const tasks = decomposeRequest('add api');
    expect(tasks.some((t) => t.kind === 'IMPLEMENT')).toBe(true);
  });

  it('maps keyword rules to implementations in table order', () => {
    const tasks = decomposeRequest('add database routes and readme');
    const impls = tasks.filter((t) => t.kind === 'IMPLEMENT').map((t) => t.title);
    const docs = tasks.filter((t) => t.kind === 'DOCUMENT').map((t) => t.title);
    expect(impls).toContain('Update routes');
    expect(impls).toContain('Update database access');
    expect(docs).toContain('Update README');
  });

  it('handles multi-word targets through a path stub', () => {
    const tasks = decomposeRequest('add middleware');
    const middleware = tasks.find((t) => t.title === 'Add middleware')!;
    expect(middleware.target).toBe('src/add-middleware.ts');
  });

  it('assigns description metadata', () => {
    const tasks = decomposeRequest('add auth');
    expect(tasks.every((t) => t.description.length > 0)).toBe(true);
  });

  it('rejects empty requests', () => {
    expect(() => decomposeRequest('')).toThrow(MultiAgentDecompositionError);
  });

  it('rejects whitespace-only requests', () => {
    expect(() => decomposeRequest('   ')).toThrow(MultiAgentDecompositionError);
  });

  it('is idempotent under options merge', () => {
    const tasks = decomposeRequest('auth', { idPrefix: 'x', timeoutMs: 5 });
    expect(tasks[0].id).toBe('x-1');
  });

  it('never references itself as a dependency', () => {
    const tasks = decomposeRequest('add routes');
    for (const task of tasks) {
      expect(task.dependsOn).not.toContain(task.id);
    }
  });

  it('orders document after tests in the chain', () => {
    const tasks = decomposeRequest('add api');
    const testIdx = tasks.findIndex((t) => t.kind === 'TEST');
    const docIdx = tasks.findIndex((t) => t.kind === 'DOCUMENT');
    expect(testIdx).toBeLessThan(docIdx);
  });

  it('drops punctuation when building targets', () => {
    expect(titleToPath('JWT auth (v2)!')).toBe('src/jwt-auth-v2.ts');
  });

  it('handles empty title for path stubs', () => {
    expect(titleToPath('')).toBe('src/.ts');
  });
});

describe('titleCase', () => {
  it('capitalizes the first word', () => {
    expect(titleCase('jwt auth')).toBe('Jwt auth');
  });

  it('collapses whitespace', () => {
    expect(titleCase('  add   auth  ')).toBe('Add auth');
  });

  it('falls back for empty input', () => {
    expect(titleCase('')).toBe('feature');
  });
});

describe('toTask', () => {
  it('materialises a full task from a decomPOSED subtask', () => {
    const part = {
      id: 'task-1',
      title: 'Add middleware',
      description: 'desc',
      kind: 'IMPLEMENT' as const,
      dependsOn: ['task-0'],
      target: 'src/middleware.ts',
    };
    const task = toTask(part, 'CODER', { timeoutMs: 42, maxRetries: 3 });
    expect(task.role).toBe('CODER');
    expect(task.timeoutMs).toBe(42);
    expect(task.maxRetries).toBe(3);
    expect(task.dependsOn).toEqual(['task-0']);
    expect(task.requiresConfirmation).toBe(false);
  });
});