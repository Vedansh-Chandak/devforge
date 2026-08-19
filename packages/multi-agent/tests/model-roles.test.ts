import { describe, it, expect } from 'vitest';
import {
  ROLE_MODEL_MAP,
  modelRoleFor,
  resolveModelRolesFor,
  resolveConfiguredModelRole,
} from '../src/roles/model-roles.js';
import { createModelRouter } from '@devforge/model-provider';

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

describe('resolveConfiguredModelRole against a real ModelRouter (DF-027)', () => {
  it('picks the preferred model role when configured', () => {
    const router = createModelRouter({
      defaultConfig: { provider: 'fake' },
    });
    expect(resolveConfiguredModelRole('CODER', router)).toBe('coding');
    expect(resolveConfiguredModelRole('PLANNER', router)).toBe('reasoning');
    expect(resolveConfiguredModelRole('TESTER', router)).toBe('fast');
  });

  it('falls back to the first configured candidate role', () => {
    // Only fast configured → TESTER prefers fast (no fallback needed);
    // REVIEWER (reasoning) falls back to fast.
    const router = createModelRouter({
      roleConfigs: { fast: { provider: 'fake' } },
    });
    expect(resolveConfiguredModelRole('REVIEWER', router)).toBe('fast');
    expect(resolveConfiguredModelRole('TESTER', router)).toBe('fast');
  });

  it('returns undefined when no candidate role resolves', () => {
    // No default config, no fake fallback, only coding configured.
    const router = createModelRouter({
      roleConfigs: { coding: { provider: 'fake' } },
    });
    expect(resolveConfiguredModelRole('PLANNER', router)).toBeUndefined();
    expect(resolveConfiguredModelRole('TESTER', router)).toBeUndefined();
    expect(resolveConfiguredModelRole('NOPE' as never, router)).toBeUndefined();
  });

  it('keeps consumers provider-agnostic (never names concrete adapters)', () => {
    const router = createModelRouter({
      defaultConfig: { provider: 'fake' },
    });
    const role = resolveConfiguredModelRole('CODER', router);
    // The resolver returns a model role; provider selection happens later via
    // router.select(role) — multi-agent never constructs adapters.
    expect(role).toBe('coding');
    expect(router.select(role!).id).toBe('fake-provider');
  });
});