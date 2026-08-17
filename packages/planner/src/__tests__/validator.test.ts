import { describe, it, expect } from 'vitest';
import { validatePlan } from '../validator.js';
import { buildDeterministicPlan } from '../planner.js';
import { parseRequest } from '../parser.js';
import type { ExecutionPlan } from '../types.js';

const VALID_PLAN: ExecutionPlan = {
  goal: 'Add a login endpoint',
  summary: 'Implementation plan',
  complexity: 'MEDIUM',
  risk: 'HIGH',
  requiresConfirmation: true,
  steps: [
    {
      id: 'step-1',
      title: 'Search',
      description: 'Search for the login code',
      type: 'SEARCH',
      dependsOn: [],
      estimatedCost: 1,
      requiresConfirmation: false,
    },
    {
      id: 'step-2',
      title: 'Edit',
      description: 'Edit the login endpoint',
      type: 'EDIT',
      dependsOn: ['step-1'],
      estimatedCost: 3,
      requiresConfirmation: true,
    },
  ],
  assumptions: ['No changes are made by planning.'],
  expectedOutputs: ['A validated plan.'],
};

describe('validator', () => {
  it('accepts a well-formed plan', () => {
    const result = validatePlan(VALID_PLAN);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.plan).toEqual(VALID_PLAN);
  });

  it('accepts the deterministic heuristic plan', () => {
    const plan = buildDeterministicPlan(parseRequest('Implement a login endpoint'));
    const result = validatePlan(plan);
    expect(result.valid).toBe(true);
  });

  it('rejects non-object input', () => {
    expect(validatePlan(null).valid).toBe(false);
    expect(validatePlan('plan').valid).toBe(false);
    expect(validatePlan(42).valid).toBe(false);
  });

  it('rejects a missing or empty goal', () => {
    const invalid = { ...VALID_PLAN, goal: '' };
    const result = validatePlan(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.join()).toMatch(/goal/);
  });

  it('rejects an unknown complexity or risk', () => {
    expect(validatePlan({ ...VALID_PLAN, complexity: 'EXTREME' }).valid).toBe(false);
    expect(validatePlan({ ...VALID_PLAN, risk: 'EXTREME' }).valid).toBe(false);
  });

  it('rejects an invalid step type', () => {
    const invalid = {
      ...VALID_PLAN,
      steps: [{ ...VALID_PLAN.steps[0]!, type: 'EXECUTE' }],
    };
    const result = validatePlan(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.join()).toMatch(/type/);
  });

  it('rejects non-negative requirement for estimatedCost', () => {
    const invalid = {
      ...VALID_PLAN,
      steps: [{ ...VALID_PLAN.steps[0]!, estimatedCost: -1 }],
    };
    expect(validatePlan(invalid).valid).toBe(false);
  });

  it('rejects duplicate step ids', () => {
    const invalid = {
      ...VALID_PLAN,
      steps: [VALID_PLAN.steps[0], { ...VALID_PLAN.steps[1]!, id: 'step-1' }],
    };
    const result = validatePlan(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.join()).toMatch(/duplicated/);
  });

  it('rejects dependsOn referencing an unknown step', () => {
    const invalid = {
      ...VALID_PLAN,
      steps: [{ ...VALID_PLAN.steps[1]!, dependsOn: ['step-99'] }],
    };
    const result = validatePlan(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.join()).toMatch(/unknown step/);
  });

  it('rejects dependency cycles', () => {
    const invalid = {
      ...VALID_PLAN,
      steps: [
        { ...VALID_PLAN.steps[0]!, dependsOn: ['step-2'] },
        { ...VALID_PLAN.steps[1]!, id: 'step-2', dependsOn: ['step-1'] },
      ],
    };
    const result = validatePlan(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.join()).toMatch(/cycle/);
  });

  it('rejects empty or non-array steps', () => {
    expect(validatePlan({ ...VALID_PLAN, steps: [] }).valid).toBe(false);
    expect(validatePlan({ ...VALID_PLAN, steps: 'nope' }).valid).toBe(false);
  });

  it('rejects non-string assumptions and expectedOutputs', () => {
    expect(validatePlan({ ...VALID_PLAN, assumptions: [42] }).valid).toBe(false);
    expect(validatePlan({ ...VALID_PLAN, expectedOutputs: 'nope' }).valid).toBe(false);
  });

  it('returns deterministic error ordering', () => {
    const first = validatePlan({ goal: '', complexity: 'EXTREME' });
    const second = validatePlan({ goal: '', complexity: 'EXTREME' });
    expect(first.errors).toEqual(second.errors);
  });
});
