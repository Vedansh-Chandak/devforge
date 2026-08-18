import { describe, it, expect } from 'vitest';
import {
  ROLE_MODEL_MAP,
  modelRoleFor,
  resolveModelRolesFor,
} from '../src/roles/model-roles.js';

const ALL_ROLES = new Set(['reasoning', 'coding', 'fast']);

describe('agent role → model role mapping (DF-026C)', () => {
  it('maps planner to reasoning', () => {
    expect(modelRoleFor('PLANNER')?.modelRole).toBe('reasoning');
  });

  it('maps coder to coding', () => {
    expect(modelRoleFor('CODER')?.modelRole).toBe('coding');
  });

  it('maps reviewer to reasoning with fast fallback', () => {
    const mapping = modelRoleFor('REVIEWER');
    expect(mapping?.modelRole).toBe('reasoning');
    expect(mapping?.fallbacks).toContain('fast');
  });

  it('maps repair to coding', () => {
    expect(modelRoleFor('REPAIR')?.modelRole).toBe('coding');
  });

  it('covers every known agent role with a valid model role', () => {
    for (const mapping of ROLE_MODEL_MAP) {
      expect(ALL_ROLES.has(mapping.modelRole)).toBe(true);
      for (const fallback of mapping.fallbacks) {
        expect(ALL_ROLES.has(fallback)).toBe(true);
      }
    }
    const roles = ROLE_MODEL_MAP.map((m) => m.role).sort();
    expect(roles).toEqual(['CODER', 'DOCUMENTATION', 'PLANNER', 'REPAIR', 'REVIEWER', 'TESTER']);
  });

  it('returns undefined for unknown roles', () => {
    expect(modelRoleFor('NOPE' as never)).toBeUndefined();
  });

  it('resolves the preferred configured role first', () => {
    const configured = new Set(['coding', 'fast']);
    expect(resolveModelRolesFor('CODER', (r) => configured.has(r))).toEqual(['coding']);
    expect(resolveModelRolesFor('REPAIR', (r) => configured.has(r))).toEqual(['coding']);
  });

  it('falls back when the preferred role is not configured', () => {
    const configured = new Set(['fast']);
    expect(resolveModelRolesFor('REVIEWER', (r) => configured.has(r))).toEqual(['fast']);
  });

  it('returns candidates in preference order when several resolve', () => {
    const all = new Set(['reasoning', 'coding', 'fast']);
    expect(resolveModelRolesFor('CODER', (r) => all.has(r))).toEqual(['coding', 'reasoning']);
  });

  it('returns empty when nothing resolves', () => {
    expect(resolveModelRolesFor('PLANNER', () => false)).toEqual([]);
    expect(resolveModelRolesFor('NOPE' as never, () => true)).toEqual([]);
  });
});