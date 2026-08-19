import { describe, it, expect } from 'vitest';
import { Planner } from '../planner.js';
import { createModelRouter } from '@devforge/model-provider';
import type { ModelRequest, ModelResponse } from '@devforge/model-provider';

function validPlanResponse(content?: string): ModelResponse {
  return {
    content:
      content ??
      JSON.stringify({
        goal: 'Wire the planner router',
        summary: 'Wire the planner through a router',
        complexity: 'LOW',
        risk: 'HIGH',
        requiresConfirmation: true,
        steps: [
          {
            id: 'step-1',
            title: 'Search',
            description: 'Search the repo',
            type: 'SEARCH',
            dependsOn: [],
            estimatedCost: 1,
            requiresConfirmation: false,
          },
          {
            id: 'step-2',
            title: 'Edit',
            description: 'Edit the files',
            type: 'EDIT',
            dependsOn: ['step-1'],
            estimatedCost: 3,
            requiresConfirmation: true,
          },
        ],
        assumptions: ['A'],
        expectedOutputs: ['E'],
      }),
    model: 'routed-model',
    finishReason: 'stop',
  };
}

/**
 * Standard consumer wiring used across @devforge/cli services (DF-027): the
 * generate function is bound to the router's role-selected provider, so the
 * planner never names a concrete provider adapter.
 */
function wiringGenerate(role: 'reasoning' | 'coding' | 'fast') {
  const router = createModelRouter({
    defaultConfig: { provider: 'fake' },
    roleConfigs: {
      reasoning: { provider: 'fake', fakeResponse: { content: validPlanResponse().content, model: 'routed-reasoning' } },
      coding: { provider: 'fake', fakeResponse: { content: validPlanResponse().content, model: 'routed-coding' } },
      fast: { provider: 'fake', fakeResponse: { content: validPlanResponse().content, model: 'routed-fast' } },
    },
  });
  const provider = router.select(role);
  return async (request: ModelRequest): Promise<ModelResponse> => provider.generate(request);
}

describe('Planner router wiring (DF-027)', () => {
  it('plans through the reasoning role when wired to a router', async () => {
    const planner = new Planner({ generate: wiringGenerate('reasoning') });
    const result = await planner.plan('Refactor the planner module');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.role).toBe('reasoning');
      expect(result.model).toBe('routed-reasoning');
    }
  });

  it('supports the coding role for planner-heavy pipelines', async () => {
    const planner = new Planner({ generate: wiringGenerate('coding'), role: 'coding' });
    const result = await planner.plan('Refactor the planner module');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.role).toBe('coding');
      expect(result.model).toBe('routed-coding');
    }
  });

  it('honors the fast role via per-call override when wired to fast', async () => {
    const planner = new Planner({ generate: wiringGenerate('fast') });
    const result = await planner.plan('Refactor the planner module', { role: 'fast' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.role).toBe('fast');
      expect(result.model).toBe('routed-fast');
    }
  });

  it('produces a deterministic plan without any model source', async () => {
    const planner = new Planner();
    const result = await planner.plan('Refactor the planner module');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.steps.length).toBeGreaterThan(0);
      // Deterministic: identical output for identical input.
      const second = await new Planner().plan('Refactor the planner module');
      expect(result).toEqual(second);
    }
  });
});