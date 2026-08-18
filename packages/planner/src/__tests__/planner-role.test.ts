import { describe, it, expect } from 'vitest';
import { Planner } from '../planner.js';
import { ModelProviderError } from '@devforge/model-provider';
import type { ModelRequest, ModelResponse } from '@devforge/model-provider';

function validPlanResponse(): ModelResponse {
  return {
    content: JSON.stringify({
      goal: 'Refactor the planner module',
      summary: 'Refactoring plan',
      complexity: 'MEDIUM',
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
    model: 'openai/gpt-oss-120b:free',
    finishReason: 'stop',
  };
}

describe('Planner role + provider error propagation (DF-026C)', () => {
  it('tags the deterministic plan with the configured role', async () => {
    const planner = new Planner({ role: 'coding' });
    const result = await planner.plan('Refactor the planner module');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.role).toBe('coding');
    }
  });

  it('defaults the role to reasoning', async () => {
    const planner = new Planner();
    const result = await planner.plan('Refactor the planner module');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.role).toBe('reasoning');
    }
  });

  it('tags model-produced plans with the per-call role', async () => {
    const planner = new Planner({
      generate: async (_request: ModelRequest) => validPlanResponse(),
    });
    const result = await planner.plan('Refactor the planner module', { role: 'fast' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.role).toBe('fast');
      expect(result.model).toBe('openai/gpt-oss-120b:free');
    }
  });

  it('propagates distinguishable provider error codes', async () => {
    const planner = new Planner({
      generate: async () => {
        throw new ModelProviderError('API key invalid', {
          provider: 'openai-compatible',
          code: 'AUTHENTICATION_ERROR',
          retryable: false,
        });
      },
    });
    const result = await planner.plan('Refactor the planner module');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MODEL_ERROR');
      expect(result.error.providerCode).toBe('AUTHENTICATION_ERROR');
      expect(result.error.retryable).toBe(false);
      expect(result.error.message).not.toContain('sk-');
    }
  });

  it('propagates RATE_LIMITED as retryable', async () => {
    const planner = new Planner({
      generate: async () => {
        throw new ModelProviderError('rate limit', {
          provider: 'gemini',
          code: 'RATE_LIMITED',
          retryable: true,
        });
      },
    });
    const result = await planner.plan('Refactor the planner module');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.providerCode).toBe('RATE_LIMITED');
      expect(result.error.retryable).toBe(true);
    }
  });

  it('keeps generic non-provider errors without a providerCode', async () => {
    const planner = new Planner({
      generate: async () => {
        throw new Error('boom');
      },
    });
    const result = await planner.plan('Refactor the planner module');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MODEL_ERROR');
      expect(result.error.providerCode).toBeUndefined();
      expect(result.error.message).toBe('boom');
    }
  });
});