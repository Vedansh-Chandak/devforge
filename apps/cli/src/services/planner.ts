

/**
 * @devforge/cli — Planner Service (M1).
 *
 * Creates a Planner instance wired to the model provider, and exposes a
 * plan() method that returns a deterministic or model-backed plan.
 */

import { Planner, parsePlanJson, validatePlan } from '@devforge/planner';
import type { ModelProvider } from '@devforge/model-provider';
import type { ModelRequest, ModelResponse } from '@devforge/model-provider';
import { logger } from '../utils/logger.js';

/** Service interface for planning operations. */
export interface PlannerService {
  readonly planner: Planner;
  /** Generate an execution plan for the given goal. */
  plan(goal: string, options?: { signal?: AbortSignal }): Promise<import('@devforge/planner').PlanResult>;
}

/**
 * Create a PlannerService from a model provider and temperature.
 * The planner's generate function injects temperature into each request.
 *
 * When `DF_PLANNER_DEBUG` env var is set (or `--debug` with log-level trace),
 * detailed diagnostics are emitted to stderr so INVALID_PLAN_OUTPUT root
 * causes are visible without stepping through a debugger.
 */
export function createPlannerService(
  provider: ModelProvider,
  temperature: number,
  options?: { debug?: boolean },
): PlannerService {
  const debug = options?.debug ?? process.env['DF_PLANNER_DEBUG'] === '1';

  /** Wrap generate to capture raw model output for debugging. */
  const generateWithDiagnostics = async (request: ModelRequest): Promise<ModelResponse> => {
    const response = await provider.generate(request);

    if (debug) {
      console.error('[planner-debug] === Planner Diagnostics ===');
      console.error('[planner-debug] Model:', response.model);
      console.error('[planner-debug] Finish reason:', response.finishReason);
      console.error('[planner-debug] Usage:', JSON.stringify(response.usage));

      // Inspect what the parser sees
      const candidate = parsePlanJson(response.content);
      console.error('[planner-debug] Parsed candidate:', candidate !== null ? 'YES' : 'NO (null)');
      if (candidate !== null) {
        console.error('[planner-debug] Candidate type:', typeof candidate);
        if (typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)) {
          const keys = Object.keys(candidate as Record<string, unknown>);
          console.error('[planner-debug] Candidate keys:', keys.join(', '));
        } else if (Array.isArray(candidate)) {
          console.error('[planner-debug] Candidate is array, length:', candidate.length);
        }
      }

      // Inspect validation result
      const validation = validatePlan(candidate);
      console.error('[planner-debug] Validation valid:', validation.valid);
      if (!validation.valid) {
        for (let i = 0; i < validation.errors.length; i++) {
          console.error(`[planner-debug]   error[${i}]: ${validation.errors[i]}`);
        }
      }

      // Show prompt shape
      console.error('[planner-debug] Prompt messages:', request.messages.length);
      for (const msg of request.messages) {
        console.error(`[planner-debug]   [${msg.role}] ${msg.content.length} chars: ${msg.content.slice(0, 200).replaceAll(/\n/g, '\\n')}${msg.content.length > 200 ? '…' : ''}`);
      }

      console.error('[planner-debug] Raw content (first 800 chars):', response.content.slice(0, 800));
      console.error('[planner-debug] === End Diagnostics ===');
    }

    return response;
  };

  const planner = new Planner({
    generate: async (request: ModelRequest): Promise<ModelResponse> => {
      if (request.temperature === undefined) {
        return generateWithDiagnostics({ ...request, temperature });
      }
      return generateWithDiagnostics(request);
    },
    maxRetries: 1,
  });

  logger.debug('Planner service created', { temperature, debugMode: debug });

  return {
    planner,
    async plan(goal: string, options?: { signal?: AbortSignal }) {
      logger.debug('Planning for goal', { goal: goal.slice(0, 100) });
      const result = await planner.plan(goal, options);
      if (debug && !result.ok) {
        console.error('[planner-debug] Final plan result: FAILED');
        console.error('[planner-debug] Error code:', result.error.code);
        console.error('[planner-debug] Error message:', result.error.message);
      } else if (debug) {
        console.error('[planner-debug] Final plan result: OK');
        console.error('[planner-debug] Plan summary:', result.ok ? result.plan.summary : undefined);
      }
      return result;
    },
  };
}
