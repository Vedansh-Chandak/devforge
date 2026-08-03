import { describe, it, expect } from 'vitest';
import type { ModelRequest, ModelResponse } from '@devforge/model-provider';
import { Planner, buildDeterministicPlan, estimateComplexity, estimateRisk, parsePlanJson } from '../planner.js';
import { parseRequest } from '../parser.js';
import { validatePlan } from '../validator.js';
import { PLANNER_SYSTEM_MESSAGE } from '../prompts.js';
import type { ExecutionPlan, PlanStep } from '../types.js';

const VALID_PLAN: ExecutionPlan = {
  goal: 'Add a login endpoint',
  summary: 'Implementation plan — 2 steps',
  complexity: 'MEDIUM',
  risk: 'HIGH',
  requiresConfirmation: true,
  steps: [
    {
      id: 'step-1',
      title: 'Search the repository',
      description: 'Locate the auth code',
      type: 'SEARCH',
      dependsOn: [],
      estimatedCost: 1,
      requiresConfirmation: false,
    },
    {
      id: 'step-2',
      title: 'Edit target files',
      description: 'Add the login endpoint',
      type: 'EDIT',
      dependsOn: ['step-1'],
      estimatedCost: 3,
      requiresConfirmation: true,
    },
  ],
  assumptions: ['No changes are made by planning.'],
  expectedOutputs: ['A validated plan.'],
};

function validPlanJson(): string {
  return JSON.stringify(VALID_PLAN);
}

function scriptedGenerator(contents: readonly string[]): {
  generate: (request: ModelRequest) => Promise<ModelResponse>;
  requests: ModelRequest[];
} {
  const requests: ModelRequest[] = [];
  let calls = 0;
  return {
    generate: async (request) => {
      requests.push(request);
      const content = contents[calls] ?? 'fallback';
      calls++;
      return { content, model: 'scripted', finishReason: 'stop' as const };
    },
    get requests() {
      return requests;
    },
  };
}

describe('deterministic planning (no model)', () => {
  it('plans a simple search request', async () => {
    const planner = new Planner();
    const result = await planner.plan('Search for the authentication module');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.goal).toBe('Search for the authentication module');
    expect(result.plan.steps.map((s) => s.type)).toEqual(['SEARCH', 'READ', 'ANALYZE']);
    expect(result.plan.complexity).toBe('LOW');
    expect(result.plan.risk).toBe('LOW');
    expect(result.plan.requiresConfirmation).toBe(false);
  });

  it('plans a multi-step refactor request', async () => {
    const planner = new Planner();
    const result = await planner.plan('Refactor the login module');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.steps).toHaveLength(5);
    expect(result.plan.complexity).toBe('HIGH');
    expect(result.plan.risk).toBe('HIGH');
    expect(result.plan.requiresConfirmation).toBe(true);
  });

  it('plans a complex implementation request', async () => {
    const planner = new Planner();
    const result = await planner.plan('Implement a new feature for exporting reports');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.steps).toHaveLength(7);
    expect(result.plan.complexity).toBe('HIGH');
    expect(result.plan.steps.some((s) => s.type === 'CREATE')).toBe(true);
  });

  it('plans a destructive request with CRITICAL risk and confirmation', async () => {
    const planner = new Planner();
    const result = await planner.plan('Delete the obsolete migration files');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.risk).toBe('CRITICAL');
    expect(result.plan.requiresConfirmation).toBe(true);
    const deleteStep = result.plan.steps.find((s) => s.type === 'DELETE');
    expect(deleteStep?.requiresConfirmation).toBe(true);
  });

  it('produces deterministically ordered dependencies', async () => {
    const planner = new Planner();
    const result = await planner.plan('Refactor the login module');
    if (!result.ok) return;

    const steps = result.plan.steps;
    expect(steps[0]!.dependsOn).toEqual([]);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!.dependsOn).toEqual([`step-${i}`]);
    }
  });

  it('returns only validated plans', async () => {
    const planner = new Planner();
    const result = await planner.plan('Explain how does authentication work');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validatePlan(result.plan).valid).toBe(true);
  });

  it('is deterministic: identical requests produce identical plans', async () => {
    const planner = new Planner();
    const a = await planner.plan('Implement a login endpoint');
    const b = await planner.plan('Implement a login endpoint');
    expect(a).toEqual(b);
    if (!a.ok || !b.ok) return;
    expect(a.plan).toEqual(b.plan);
  });
});

describe('complexity and risk estimation', () => {
  function stepsWithTypes(types: readonly PlanStep['type'][]): PlanStep[] {
    return types.map((type, index) => ({
      id: `step-${index + 1}`,
      title: type,
      description: type,
      type,
      dependsOn: [],
      estimatedCost: 1,
      requiresConfirmation: false,
    }));
  }

  it('classifies read-only plans as LOW', () => {
    expect(estimateComplexity(stepsWithTypes(['SEARCH', 'READ']))).toBe('LOW');
  });

  it('classifies plans with writes as MEDIUM', () => {
    expect(estimateComplexity(stepsWithTypes(['SEARCH', 'EDIT']))).toBe('MEDIUM');
  });

  it('classifies large plans as HIGH', () => {
    expect(estimateComplexity(stepsWithTypes(['SEARCH', 'READ', 'ANALYZE', 'EDIT', 'VERIFY']))).toBe('HIGH');
  });

  it('classifies risk as LOW for read-only plans', () => {
    expect(estimateRisk(stepsWithTypes(['SEARCH', 'READ', 'ANALYZE']))).toBe('LOW');
  });

  it('classifies risk as HIGH for edit/create plans', () => {
    expect(estimateRisk(stepsWithTypes(['SEARCH', 'EDIT']))).toBe('HIGH');
  });

  it('classifies risk as CRITICAL for delete/command plans', () => {
    expect(estimateRisk(stepsWithTypes(['SEARCH', 'DELETE']))).toBe('CRITICAL');
    expect(estimateRisk(stepsWithTypes(['SEARCH', 'COMMAND']))).toBe('CRITICAL');
  });
});

describe('model-based planning', () => {
  it('plans using a model-generated valid plan', async () => {
    const gen = scriptedGenerator([validPlanJson()]);
    const planner = new Planner({ generate: gen.generate });

    const result = await planner.plan('Add a login endpoint');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan).toEqual(VALID_PLAN);
    expect(result.model).toBe('scripted');
    expect(gen.requests).toHaveLength(1);
  });

  it('uses a deterministic planning prompt with temperature 0', async () => {
    const gen = scriptedGenerator([validPlanJson()]);
    const planner = new Planner({ generate: gen.generate });

    await planner.plan('Add a login endpoint');

    const request = gen.requests[0]!;
    expect(request.temperature).toBe(0);
    expect(request.messages[0]!.content).toBe(PLANNER_SYSTEM_MESSAGE);
    expect(request.messages[0]!.role).toBe('system');
    expect(request.messages[1]!.content).toContain('Developer request');
  });

  it('retries once on invalid output and returns the corrected plan', async () => {
    const invalid = JSON.stringify({ ...VALID_PLAN, complexity: 'EXTREME' });
    const gen = scriptedGenerator([invalid, validPlanJson()]);
    const planner = new Planner({ generate: gen.generate });

    const result = await planner.plan('Add a login endpoint');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan).toEqual(VALID_PLAN);
    expect(gen.requests).toHaveLength(2);
    // Retry prompt includes validation errors.
    expect(gen.requests[1]!.messages[1]!.content).toMatch(/Validation errors/);
  });

  it('returns a PlanningError when output is invalid on every attempt', async () => {
    const invalid = JSON.stringify({ ...VALID_PLAN, complexity: 'EXTREME' });
    const gen = scriptedGenerator([invalid, invalid]);
    const planner = new Planner({ generate: gen.generate });

    const result = await planner.plan('Add a login endpoint');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_PLAN_OUTPUT');
    expect(result.error.retryable).toBe(true);
    expect(gen.requests).toHaveLength(2);
  });

  it('returns a PlanningError when the model throws', async () => {
    const planner = new Planner({
      generate: async () => {
        throw new Error('provider exploded');
      },
    });

    const result = await planner.plan('Add a login endpoint');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('MODEL_ERROR');
    expect(result.error.message).toMatch(/provider exploded/);
    expect(result.error.retryable).toBe(true);
  });

  it('is deterministic for identical scripted output', async () => {
    const a = new Planner({ generate: scriptedGenerator([validPlanJson()]).generate });
    const b = new Planner({ generate: scriptedGenerator([validPlanJson()]).generate });
    const ra = await a.plan('Add a login endpoint');
    const rb = await b.plan('Add a login endpoint');
    expect(ra).toEqual(rb);
  });
});

describe('parsePlanJson', () => {
  it('parses raw JSON', () => {
    expect(parsePlanJson(validPlanJson())).toEqual(VALID_PLAN);
  });

  it('parses fenced JSON', () => {
    expect(parsePlanJson(`Here you go:\n\`\`\`json\n${validPlanJson()}\n\`\`\``)).toEqual(VALID_PLAN);
  });

  it('parses an embedded JSON object', () => {
    expect(parsePlanJson(`prefix ${validPlanJson()} suffix`)).toEqual(VALID_PLAN);
  });

  it('returns null for non-JSON output', () => {
    expect(parsePlanJson('not json at all')).toBeNull();
    expect(parsePlanJson('')).toBeNull();
  });
});
