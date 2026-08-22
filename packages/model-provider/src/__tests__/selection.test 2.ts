import { describe, it, expect } from 'vitest';
import {
  selectModel,
  selectModelName,
  resolveRoleModel,
} from '../selection.js';
import type { ModelSelection, RoleModelMap } from '../selection.js';

const MODELS: readonly ModelSelection[] = [
  { id: 'deep-reasoner', roles: ['reasoning'] },
  { id: 'coder', roles: ['coding'] },
  { id: 'fast-one', roles: ['fast'] },
  { id: 'hybrid', roles: ['coding', 'reasoning'] },
];

describe('selectModel', () => {
  it('selects a reasoning model by role', () => {
    expect(selectModel(MODELS, 'reasoning')?.id).toBe('deep-reasoner');
  });

  it('selects a coding model by role', () => {
    expect(selectModel(MODELS, 'coding')?.id).toBe('coder');
  });

  it('selects a fast model by role', () => {
    expect(selectModel(MODELS, 'fast')?.id).toBe('fast-one');
  });

  it('returns a multi-role model when it is the only match', () => {
    const only: readonly ModelSelection[] = [{ id: 'hybrid', roles: ['coding', 'reasoning'] }];
    expect(selectModel(only, 'coding')?.id).toBe('hybrid');
    expect(selectModel(only, 'reasoning')?.id).toBe('hybrid');
  });

  it('breaks equal-priority ties by declaration order', () => {
    const list: readonly ModelSelection[] = [
      { id: 'hybrid', roles: ['coding', 'reasoning'] },
      { id: 'coder', roles: ['coding'] },
    ];
    expect(selectModel(list, 'coding')?.id).toBe('hybrid');
  });

  it('breaks priority ties by declaration order (stable)', () => {
    const list: readonly ModelSelection[] = [
      { id: 'first', roles: ['coding'], priority: 0 },
      { id: 'second', roles: ['coding'], priority: 0 },
    ];
    expect(selectModel(list, 'coding')?.id).toBe('first');
  });

  it('prefers lower priority numbers', () => {
    const list: readonly ModelSelection[] = [
      { id: 'backup', roles: ['fast'], priority: 5 },
      { id: 'primary', roles: ['fast'], priority: 1 },
    ];
    expect(selectModel(list, 'fast')?.id).toBe('primary');
  });

  it('is deterministic across repeated calls', () => {
    const results = Array.from({ length: 10 }, () => selectModel(MODELS, 'coding')?.id);
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe('coder');
  });

  it('returns undefined when no model matches the role', () => {
    const noFast = MODELS.filter((m) => !m.roles.includes('fast'));
    expect(selectModel(noFast, 'fast')).toBeUndefined();
  });

  it('returns undefined for an empty selection list', () => {
    expect(selectModel([], 'coding')).toBeUndefined();
  });
});

describe('selectModelName', () => {
  it('returns the selected model id', () => {
    expect(selectModelName(MODELS, 'reasoning', 'fallback-model')).toBe('deep-reasoner');
  });

  it('falls back when no model matches', () => {
    const noFast = MODELS.filter((m) => !m.roles.includes('fast'));
    expect(selectModelName(noFast, 'fast', 'fallback-model')).toBe('fallback-model');
  });

  it('returns undefined when no match and no fallback given', () => {
    const noFast = MODELS.filter((m) => !m.roles.includes('fast'));
    expect(selectModelName(noFast, 'fast')).toBeUndefined();
  });
});

describe('resolveRoleModel', () => {
  it('resolves a model id from a role map', () => {
    const map: RoleModelMap = { reasoning: 'r1', coding: 'c1', fast: 'f1' };
    expect(resolveRoleModel(map, 'reasoning')).toBe('r1');
    expect(resolveRoleModel(map, 'coding')).toBe('c1');
    expect(resolveRoleModel(map, 'fast')).toBe('f1');
  });

  it('returns undefined for a missing role key', () => {
    expect(resolveRoleModel({ coding: 'c1' }, 'reasoning')).toBeUndefined();
  });
});
