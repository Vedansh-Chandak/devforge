/**
 * Planning prompts (DF-012).
 *
 * Builds prompts that produce an ExecutionPlan. These are planning
 * instructions only — there are no execution prompts here. Execution
 * instructions live in a separate phase and must never be mixed in.
 *
 * The final ModelRequest is deterministic (temperature 0) and bounded by
 * the prompt-composer's truncateContent helper.
 */

import { truncateContent } from '@devforge/prompt-composer';
import type { ModelRequest } from '@devforge/model-provider';
import type { ParsedRequest } from './parser.js';
import {
  PLAN_COMPLEXITIES,
  PLAN_RISKS,
  PLAN_STEP_TYPES,
} from './types.js';

/** Default character budget for the planning user message. */
export const DEFAULT_MAX_PROMPT_CHARS = 10_000;

/** Planning system message. Explicitly planning-only; never executes. */
export const PLANNER_SYSTEM_MESSAGE = `You are DevForge's Planning Engine. You convert a developer's natural-language request into a validated execution plan.

You ONLY plan. You must never execute commands, modify files, or perform any action.

Rules:
- Output a single JSON object conforming exactly to the schema below.
- Do not wrap the JSON in prose, explanations, or markdown fences.
- Every step must have a unique id, a title, a description, a type, dependsOn, estimatedCost and requiresConfirmation.
- dependsOn must reference existing step ids; the graph must be acyclic; ordering must be strictly left-to-right where possible.
- estimatedCost is a deterministic unitless non-negative number (lower is cheaper).
- Choose complexity from: ${PLAN_COMPLEXITIES.join(', ')}.
- Choose risk from: ${PLAN_RISKS.join(', ')}. Risk is CRITICAL for DELETE or COMMAND steps, HIGH for EDIT or CREATE steps.
- Set requiresConfirmation to true whenever risk is HIGH or CRITICAL, or the request is destructive.
- assumptions and expectedOutputs are arrays of strings.

Schema:
{
  "goal": string,
  "summary": string,
  "complexity": "LOW" | "MEDIUM" | "HIGH",
  "risk": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "requiresConfirmation": boolean,
  "steps": [
    {
      "id": string,
      "title": string,
      "description": string,
      "type": "${PLAN_STEP_TYPES.join('" | "')}",
      "dependsOn": string[],
      "estimatedCost": number,
      "requiresConfirmation": boolean
    }
  ],
  "assumptions": string[],
  "expectedOutputs": string[]
}`;

/** System message appended on the single retry after invalid output. */
export const PLANNER_CORRECTION_SYSTEM_MESSAGE = `${PLANNER_SYSTEM_MESSAGE}

Your previous output was rejected by validation. Fix every error listed below and return ONLY corrected JSON.`;

/** Result of building a planning prompt. */
export interface PlannerPromptResult {
  readonly request: ModelRequest;
  readonly truncated: boolean;
}

function buildPlanStepTypeList(): string {
  return PLAN_STEP_TYPES.join(', ');
}

/** Build the planning user message from a parsed request. */
export function buildPlanningUserContent(parsed: ParsedRequest): string {
  const sections: string[] = [];

  sections.push(`Developer request:\n${parsed.normalized}`);

  if (parsed.detectedKeywords.length > 0) {
    sections.push(`Detected intent: ${parsed.intent}`);
    sections.push(`Detected keywords: ${parsed.detectedKeywords.join(', ')}`);
  }

  sections.push(
    `Allowed step types: ${buildPlanStepTypeList()}.`,
  );

  sections.push(
    'Planning only. Do not execute anything.',
  );

  return sections.join('\n\n');
}

/** Build the initial planning ModelRequest. */
export function buildPlannerPrompt(
  parsed: ParsedRequest,
  maxChars: number = DEFAULT_MAX_PROMPT_CHARS,
): PlannerPromptResult {
  const content = buildPlanningUserContent(parsed);
  const { content: bounded, truncated } = truncateContent(content, maxChars);
  return {
    request: {
      messages: [
        { role: 'system', content: PLANNER_SYSTEM_MESSAGE },
        { role: 'user', content: bounded },
      ],
      temperature: 0,
    },
    truncated,
  };
}

/** Build the user message for the corrective retry. */
export function buildCorrectionUserContent(
  parsed: ParsedRequest,
  previousOutput: string,
  errors: readonly string[],
): string {
  const sections: string[] = [];

  sections.push(`Developer request:\n${parsed.normalized}`);
  sections.push('Validation errors from your previous output:');
  for (const error of errors) {
    sections.push(`- ${error}`);
  }
  sections.push(`Your previous output (rejected):\n${previousOutput}`);
  sections.push('Return ONLY corrected JSON conforming to the schema in the system message.');

  return sections.join('\n\n');
}

/** Build the corrective ModelRequest for the single retry. */
export function buildCorrectionPrompt(
  parsed: ParsedRequest,
  previousOutput: string,
  errors: readonly string[],
  maxChars: number = DEFAULT_MAX_PROMPT_CHARS,
): PlannerPromptResult {
  const content = buildCorrectionUserContent(parsed, previousOutput, errors);
  const { content: bounded, truncated } = truncateContent(content, maxChars);
  return {
    request: {
      messages: [
        { role: 'system', content: PLANNER_CORRECTION_SYSTEM_MESSAGE },
        { role: 'user', content: bounded },
      ],
      temperature: 0,
    },
    truncated,
  };
}
