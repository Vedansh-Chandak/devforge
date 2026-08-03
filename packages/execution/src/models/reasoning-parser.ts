/**
 * @devforge/execution — Reasoning Parser (DF-016C).
 *
 * Parses model output into FailureAnalysis and RepairDecision objects
 * with defensive recovery. Mirrors patch-parser semantics: never throws,
 * returns typed ParseResult.
 */

import type { FailureAnalysis, RepairDecision } from '../executor/reasoning-model.js';
import type { ParseResult, ParseFailure, ParseErrorCode } from './types.js';
import { ReasoningParseError } from './errors.js';
import { OUTPUT_TAGS } from './prompt-builder.js';

/** Category values for failure analysis. */
const ANALYSIS_CATEGORIES = ['TYPE_ERROR', 'TEST_FAILURE', 'LINT_ERROR', 'COMMAND_ERROR', 'OTHER'] as const;
type AnalysisCategory = (typeof ANALYSIS_CATEGORIES)[number];

/** Strategy values for repair decisions. */
const DECISION_STRATEGIES = ['REWRITE', 'PATCH', 'CREATE', 'DELETE', 'RESTORE', 'ABORT'] as const;
type DecisionStrategy = (typeof DECISION_STRATEGIES)[number];

/** Scope values for repair decisions. */
const DECISION_SCOPES = ['MINIMAL', 'BROAD'] as const;
type DecisionScope = (typeof DECISION_SCOPES)[number];

/** Parse model output into a FailureAnalysis. Never throws. */
export function parseFailureAnalysis(output: string): ParseResult<FailureAnalysis> {
  const json = extractReasoningJson(output);
  if (!json) {
    return {
      ok: false,
      error: createParseFailure(
        'NO_TAGS_FOUND',
        'No reasoning output found (no tags or parseable JSON)',
        output,
        true,
      ),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return {
      ok: false,
      error: createParseFailure(
        'MALFORMED_JSON',
        `JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
        json,
        true,
      ),
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      error: createParseFailure(
        'INVALID_SCHEMA',
        'Parsed reasoning output is not an object',
        json,
        true,
      ),
    };
  }

  return recordAnalysis(parsed as Record<string, unknown>, json);
}

/** Parse model output into a RepairDecision. Never throws. */
export function parseRepairDecision(output: string): ParseResult<RepairDecision> {
  const json = extractReasoningJson(output);
  if (!json) {
    return {
      ok: false,
      error: createParseFailure(
        'NO_TAGS_FOUND',
        'No reasoning output found (no tags or parseable JSON)',
        output,
        true,
      ),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return {
      ok: false,
      error: createParseFailure(
        'MALFORMED_JSON',
        `JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
        json,
        true,
      ),
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      error: createParseFailure(
        'INVALID_SCHEMA',
        'Parsed reasoning output is not an object',
        json,
        true,
      ),
    };
  }

  return recordDecision(parsed as Record<string, unknown>, json);
}

/** Extract JSON content between reasoning tags, or the raw trimmed output. */
function extractReasoningJson(output: string): string | null {
  const trimmed = output.trim();
  if (trimmed.length === 0) return null;

  const startTag = OUTPUT_TAGS.REASONING_START;
  const endTag = OUTPUT_TAGS.REASONING_END;
  const start = trimmed.indexOf(startTag);
  if (start !== -1) {
    const contentStart = start + startTag.length;
    const end = trimmed.indexOf(endTag, contentStart);
    if (end === -1) return null;
    return trimmed.slice(contentStart, end).trim();
  }

  // No tags found — attempt to extract raw JSON object
  const firstBrace = trimmed.indexOf('{');
  if (firstBrace === -1) return null;
  return trimmed.slice(firstBrace, findClosingObject(trimmed, firstBrace) + 1);
}

/** Find the index of the closing brace for an object at `start`. */
function findClosingObject(str: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < str.length; i++) {
    const ch = str[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return i;
      }
    }
  }
  // Fall back to last brace
  return str.lastIndexOf('}');
}

/** Validate and normalize a FailureAnalysis. */
function recordAnalysis(raw: Record<string, unknown>, source: string): ParseResult<FailureAnalysis> {
  if (typeof raw.diagnosis !== 'string' || raw.diagnosis.length === 0) {
    return fail('INVALID_SCHEMA', 'FailureAnalysis missing non-empty diagnosis', source, raw);
  }

  const category = raw.category;
  if (typeof category !== 'string' || !ANALYSIS_CATEGORIES.includes(category as AnalysisCategory)) {
    return fail('INVALID_SCHEMA', `Invalid failure category: ${String(category)}`, source, raw);
  }

  if (typeof raw.confidence !== 'number' || raw.confidence < 0 || raw.confidence > 1) {
    return fail('INVALID_SCHEMA', 'FailureAnalysis confidence must be a number 0-1', source, raw);
  }

  const suggestedPaths = normalizeStringArray(raw.suggestedPaths);
  const estimatedComplexity = typeof raw.estimatedComplexity === 'number'
    ? raw.estimatedComplexity
    : undefined;
  if (estimatedComplexity === undefined || estimatedComplexity < 1 || estimatedComplexity > 10) {
    return fail('INVALID_SCHEMA', 'estimatedComplexity must be a number 1-10', source, raw);
  }

  return {
    ok: true,
    value: {
      diagnosis: raw.diagnosis,
      category: category as FailureAnalysis['category'],
      confidence: raw.confidence as number,
      suggestedPaths,
      estimatedComplexity,
    },
  };
}

/** Validate and normalize a RepairDecision from raw. */
function recordDecision(raw: Record<string, unknown>, source: string): ParseResult<RepairDecision> {
  const strategy = raw.strategy;
  if (typeof strategy !== 'string' || !DECISION_STRATEGIES.includes(strategy as DecisionStrategy)) {
    return fail('INVALID_SCHEMA', `Invalid repair strategy: ${String(strategy)}`, source, raw);
  }

  if (typeof raw.reason !== 'string' || raw.reason.length === 0) {
    return fail('INVALID_SCHEMA', 'RepairDecision missing required reason', source, raw);
  }

  const scope = raw.scope;
  if (typeof scope !== 'string' || !DECISION_SCOPES.includes(scope as DecisionScope)) {
    return fail('INVALID_SCHEMA', `Invalid repair scope: ${String(scope)}`, source, raw);
  }

  return {
    ok: true,
    value: {
      strategy: strategy as RepairDecision['strategy'],
      reason: raw.reason,
      targetFiles: normalizeStringArray(raw.targetFiles),
      scope: scope as RepairDecision['scope'],
    },
  };
}

/** Normalize an unknown value into a non-empty string array. */
function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/** Build a ParseFailure object. */
function createParseFailure(
  code: ParseErrorCode,
  message: string,
  rawOutput: string,
  recoveryAttempted: boolean,
  partialValue?: unknown,
): ParseFailure {
  return { code, message, rawOutput, recoveryAttempted, partialValue };
}

/** Return an error ParseResult. */
function fail(
  code: ParseErrorCode,
  message: string,
  source: string,
  partialValue: unknown,
): { ok: false; error: ParseFailure } {
  return {
    ok: false,
    error: createParseFailure(code, message, source, true, partialValue),
  };
}