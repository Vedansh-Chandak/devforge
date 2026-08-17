/**
 * Deterministic Planning Engine (DF-012).
 *
 * Converts a natural-language developer request into a validated
 * ExecutionPlan. Planning only — this module never executes anything.
 *
 * Flow:
 *   parseRequest (parser.ts)
 *     → buildPlannerPrompt (prompts.ts)
 *     → model generate (injectable) OR buildDeterministicPlan
 *     → validatePlan (validator.ts)
 *     → on invalid: one corrective retry, then PlanningError.
 */

import type { ModelRequest, ModelResponse } from '@devforge/model-provider';
import { parseRequest } from './parser.js';
import type { ParsedRequest, RequestIntent } from './parser.js';
import {
  buildCorrectionPrompt,
  buildPlannerPrompt,
  DEFAULT_MAX_PROMPT_CHARS,
} from './prompts.js';
import { validatePlan } from './validator.js';
import type {
  ExecutionPlan,
  PlanComplexity,
  PlanResult,
  PlanRisk,
  PlanStep,
  PlanStepType,
} from './types.js';

/** Step types that modify the workspace. */
const WRITE_STEP_TYPES: ReadonlySet<PlanStepType> = new Set([
  'EDIT',
  'CREATE',
  'DELETE',
  'COMMAND',
]);

/** Deterministic metadata for each step type. */
const STEP_TYPE_META: Readonly<
  Record<PlanStepType, { readonly title: string; readonly cost: number; readonly verb: string }>
> = {
  SEARCH: { title: 'Search the repository', cost: 1, verb: 'search the repository' },
  READ: { title: 'Read relevant files', cost: 1, verb: 'read relevant files' },
  ANALYZE: { title: 'Analyze the findings', cost: 2, verb: 'analyze the findings' },
  PLAN: { title: 'Plan the changes', cost: 1, verb: 'plan the changes' },
  EDIT: { title: 'Edit target files', cost: 3, verb: 'edit the target files' },
  CREATE: { title: 'Create new files', cost: 3, verb: 'create the new files' },
  DELETE: { title: 'Delete target files', cost: 2, verb: 'delete the target files' },
  VERIFY: { title: 'Verify the result', cost: 2, verb: 'verify the result' },
  COMMAND: { title: 'Run a command', cost: 2, verb: 'run the required command' },
};

/** Deterministic step sequence for each intent. */
const INTENT_STEP_TYPES: Readonly<Record<RequestIntent, readonly PlanStepType[]>> = {
  implement: ['SEARCH', 'READ', 'ANALYZE', 'PLAN', 'CREATE', 'EDIT', 'VERIFY'],
  refactor: ['SEARCH', 'READ', 'ANALYZE', 'EDIT', 'VERIFY'],
  fix: ['SEARCH', 'READ', 'ANALYZE', 'EDIT', 'VERIFY'],
  search: ['SEARCH', 'READ', 'ANALYZE'],
  explain: ['SEARCH', 'READ', 'ANALYZE'],
  destructive: ['SEARCH', 'READ', 'ANALYZE', 'DELETE', 'VERIFY'],
  unknown: ['SEARCH', 'READ', 'ANALYZE', 'PLAN'],
};

/** Deterministic summary label per intent. */
const INTENT_SUMMARY: Readonly<Record<RequestIntent, string>> = {
  implement: 'Implementation plan',
  refactor: 'Refactoring plan',
  fix: 'Fix plan',
  search: 'Search and analysis plan',
  explain: 'Explanation and analysis plan',
  destructive: 'Destructive change plan',
  unknown: 'General analysis plan',
};

/** Planner configuration. */
export interface PlannerConfig {
  /**
   * Model generation function. When omitted, the planner produces a
   * fully deterministic heuristic plan with no model calls.
   */
  readonly generate?: (request: ModelRequest) => Promise<ModelResponse>;
  /** Character budget for the planning user message. */
  readonly maxPromptChars?: number;
  /** Number of corrective retries after invalid model output (default 1). */
  readonly maxRetries?: number;
  /** Hard timeout in milliseconds for a single planning attempt (0 = none). */
  readonly timeoutMs?: number;
}

/** Options for a single planning call. */
export interface PlanOptions {
  /** External cancellation signal. Aborting returns a `CANCELLED` result. */
  readonly signal?: AbortSignal;
}

/** Estimate plan complexity from its steps. Pure and deterministic. */
export function estimateComplexity(steps: readonly PlanStep[]): PlanComplexity {
  if (steps.length >= 5) {
    return 'HIGH';
  }
  if (steps.some((step) => WRITE_STEP_TYPES.has(step.type))) {
    return 'MEDIUM';
  }
  return 'LOW';
}

/** Estimate plan risk from its steps. Pure and deterministic. */
export function estimateRisk(steps: readonly PlanStep[]): PlanRisk {
  if (steps.some((step) => step.type === 'DELETE' || step.type === 'COMMAND')) {
    return 'CRITICAL';
  }
  if (steps.some((step) => step.type === 'EDIT' || step.type === 'CREATE')) {
    return 'HIGH';
  }
  return 'LOW';
}

/**
 * Build a deterministic ExecutionPlan purely from the parsed request.
 * No model, no side effects, no execution. Same input → same plan.
 */
export function buildDeterministicPlan(parsed: ParsedRequest): ExecutionPlan {
  const goal = parsed.normalized.length > 0 ? parsed.normalized : 'Untitled developer request';
  const shortGoal = goal.length > 80 ? `${goal.slice(0, 79)}…` : goal;
  const types = INTENT_STEP_TYPES[parsed.intent];

  const steps: PlanStep[] = types.map((type, index) => {
    const id = `step-${index + 1}`;
    const meta = STEP_TYPE_META[type];
    return {
      id,
      title: meta.title,
      description: `${meta.title} for: ${shortGoal}`,
      type,
      dependsOn: index === 0 ? [] : [`step-${index}`],
      estimatedCost: meta.cost,
      requiresConfirmation: WRITE_STEP_TYPES.has(type),
    };
  });

  const complexity = estimateComplexity(steps);
  const risk = estimateRisk(steps);
  const lastStep = steps[steps.length - 1]!;

  const assumptions: string[] = [
    `Request interpreted as: ${shortGoal}`,
    'Planning makes no changes to the workspace.',
  ];
  if (parsed.intent === 'destructive') {
    assumptions.push('Destructive operations require explicit confirmation before execution.');
  }

  const expectedOutputs: string[] = [
    `A validated execution plan with ${steps.length} ordered steps.`,
    `Completion outcome: ${STEP_TYPE_META[lastStep.type].verb}.`,
  ];

  return {
    goal,
    summary: `${INTENT_SUMMARY[parsed.intent]} — ${steps.length} steps for: ${shortGoal}`,
    complexity,
    risk,
    requiresConfirmation: risk !== 'LOW' || parsed.intent === 'destructive',
    steps,
    assumptions,
    expectedOutputs,
  };
}

/**
 * Extract a candidate plan object from model output.
 * Tries raw JSON, then fenced JSON, then the first balanced {...} block.
 * Returns null when no JSON can be found.
 */
export function parsePlanJson(content: string): unknown {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // fall through to fenced/brace extraction
  }

  const fence = /```(?:json)?\s*\n([\s\S]*?)\n?\s*```/i.exec(trimmed);
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1].trim()) as unknown;
    } catch {
      // fall through to brace extraction
    }
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Resolve with the promise, or reject once `signal` aborts — even if the
 * underlying operation never settles. Used to bound model calls that may
 * ignore their own AbortSignal.
 */
function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** Deterministic Planning Engine. */
export class Planner {
  private readonly generate: ((request: ModelRequest) => Promise<ModelResponse>) | undefined;
  private readonly maxPromptChars: number;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  constructor(config?: PlannerConfig) {
    this.generate = config?.generate;
    this.maxPromptChars = config?.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;
    this.maxRetries = config?.maxRetries ?? 1;
    this.timeoutMs = config?.timeoutMs ?? 0;
  }

  /**
   * Convert a natural-language request into a validated ExecutionPlan.
   * Never executes anything.
   */
  async plan(input: string, options?: PlanOptions): Promise<PlanResult> {
    if (options?.signal?.aborted) {
      return this.cancelledResult();
    }
    const parsed = parseRequest(input);
    if (!this.generate) {
      return this.planDeterministically(parsed);
    }
    return this.planWithModel(parsed, options);
  }

  private cancelledResult(): PlanResult {
    return {
      ok: false,
      error: {
        code: 'CANCELLED',
        message: 'Planning was cancelled.',
        retryable: false,
      },
    };
  }

  private planDeterministically(parsed: ParsedRequest): PlanResult {
    const plan = buildDeterministicPlan(parsed);
    const validation = validatePlan(plan);
    if (!validation.valid || !validation.plan) {
      return {
        ok: false,
        error: {
          code: 'INVALID_PLAN_OUTPUT',
          message: 'Deterministic planner produced an invalid plan.',
          retryable: false,
        },
      };
    }
    return { ok: true, plan: validation.plan };
  }

  private async planWithModel(parsed: ParsedRequest, options?: PlanOptions): Promise<PlanResult> {
    let prompt = buildPlannerPrompt(parsed, this.maxPromptChars);

    const controller = new AbortController();
    const externalSignal = options?.signal;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (this.timeoutMs > 0) {
      timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    }
    const onExternalAbort = (): void => controller.abort();
    if (externalSignal) {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }

    const cleanup = (): void => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    };

    let previousOutput: string | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (controller.signal.aborted) {
        cleanup();
        return this.cancelledResult();
      }

      let response: ModelResponse;
      try {
        response = await raceWithAbort(
          this.generate!({
            ...prompt.request,
            signal: controller.signal,
          }),
          controller.signal,
        );
      } catch (error) {
        cleanup();
        if (controller.signal.aborted) {
          return this.cancelledResult();
        }
        return {
          ok: false,
          error: {
            code: 'MODEL_ERROR',
            message: error instanceof Error ? error.message : String(error),
            retryable: true,
          },
        };
      }

      previousOutput = response.content;
      const candidate = parsePlanJson(response.content);
      const validation = validatePlan(candidate);

      if (validation.valid && validation.plan) {
        cleanup();
        return { ok: true, plan: validation.plan, model: response.model };
      }

      if (attempt < this.maxRetries) {
        prompt = buildCorrectionPrompt(
          parsed,
          previousOutput,
          validation.errors,
          this.maxPromptChars,
        );
      }
    }

    cleanup();
    return {
      ok: false,
      error: {
        code: 'INVALID_PLAN_OUTPUT',
        message: `Planner output failed validation after ${this.maxRetries + 1} attempt(s).`,
        retryable: true,
      },
    };
  }
}
