/**
 * Validation Harness — runs golden questions through the real pipeline
 * and checks deterministic expectations.
 *
 * Uses askWithDiagnostics() from @devforge/core to observe the real
 * production pipeline without duplicating logic.
 */

import type { DevForgeApplication, DevForgeDiagnosticsResult } from '@devforge/core';
import type { GoldenQuestion, GoldenExpectation } from './golden-questions.js';
import type {
  ValidationCaseResult,
  ValidationReport,
  ValidationSummary,
  FailureStage,
  ValidationBaseline,
} from './types.js';

/**
 * Run a single golden question through the application and validate results.
 */
export async function validateCase(
  app: DevForgeApplication,
  question: GoldenQuestion,
): Promise<ValidationCaseResult> {
  const start = Date.now();
  const { expectation } = question;

  // Execute through the real pipeline with diagnostics
  const diag: DevForgeDiagnosticsResult = await app.askWithDiagnostics(question.question);
  const result = diag.result;
  const d = diag.diagnostics;

  // Get the prompt text for checking
  const promptText = extractPromptText(diag);

  // 1. Intent check
  const intentMatched = d.intent === expectation.intent;

  // 2. Retrieval check — symbols found by Runtime
  const foundSymbols = extractFoundSymbols(diag);
  const retrievalMatched = expectation.expectedContextSymbols
    ? expectation.expectedContextSymbols.some((s) => foundSymbols.includes(s))
    : true;

  // 3. Context check — symbols in the prompt
  const contextSymbolsInPrompt = expectation.expectedContextSymbols
    ? expectation.expectedContextSymbols.filter((s) => promptText.includes(s))
    : [];
  const contextMatched = expectation.expectedContextSymbols
    ? contextSymbolsInPrompt.length > 0
    : true;

  // 4. Prompt check — expected substrings
  const foundPrompt = expectation.expectedPromptContains
    ? expectation.expectedPromptContains.filter((s) => promptText.includes(s))
    : [];
  const promptMatched = expectation.expectedPromptContains
    ? foundPrompt.length > 0
    : true;

  // 5. Pipeline success
  const pipelineSuccess = result.status !== 'provider_error';

  // Classify failure stage
  const failureStage = classifyFailure(
    intentMatched,
    retrievalMatched,
    contextMatched,
    promptMatched,
    pipelineSuccess,
  );

  const duration = Date.now() - start;

  return {
    questionId: question.id,
    question: question.question,
    intent: {
      expected: expectation.intent,
      actual: d.intent,
      matched: intentMatched,
    },
    retrieval: {
      expectedSymbols: expectation.expectedContextSymbols ?? [],
      foundSymbols,
      matched: retrievalMatched,
    },
    context: {
      expectedSymbols: expectation.expectedContextSymbols ?? [],
      foundInPrompt: contextSymbolsInPrompt,
      matched: contextMatched,
    },
    prompt: {
      expectedContains: expectation.expectedPromptContains ?? [],
      found: foundPrompt,
      matched: promptMatched,
    },
    pipeline: {
      success: pipelineSuccess,
      status: result.status,
    },
    failureStage,
    duration,
    diagnostics: {
      contextChars: d.context.contextChars,
      truncated: d.context.truncated,
      symbolCount: d.context.symbolCount,
      dependencyCount: d.context.dependencyCount,
    },
  };
}

/**
 * Run all golden questions and produce a validation report.
 */
export async function runValidation(
  app: DevForgeApplication,
  questions: GoldenQuestion[],
  repository: string,
): Promise<ValidationReport> {
  const cases: ValidationCaseResult[] = [];

  for (const q of questions) {
    const caseResult = await validateCase(app, q);
    cases.push(caseResult);
  }

  const summary = computeSummary(cases);
  const failures = extractFailures(cases);

  return {
    repository,
    timestamp: new Date().toISOString(),
    summary,
    cases,
    failures,
  };
}

/**
 * Compute summary metrics from case results.
 */
export function computeSummary(cases: ValidationCaseResult[]): ValidationSummary {
  return {
    totalQuestions: cases.length,
    intentCorrect: cases.filter((c) => c.intent.matched).length,
    retrievalMatched: cases.filter((c) => c.retrieval.matched).length,
    contextMatched: cases.filter((c) => c.context.matched).length,
    promptMatched: cases.filter((c) => c.prompt.matched).length,
    pipelineSuccess: cases.filter((c) => c.pipeline.success).length,
  };
}

/**
 * Extract failures from case results.
 */
export function extractFailures(cases: ValidationCaseResult[]): ValidationReport['failures'] {
  return cases
    .filter((c) => c.failureStage !== null)
    .map((c) => ({
      questionId: c.questionId,
      question: c.question,
      stage: c.failureStage!,
      expected: getExpectedDescription(c),
      actual: getActualDescription(c),
    }));
}

/**
 * Classify which stage failed first.
 */
export function classifyFailure(
  intentMatched: boolean,
  retrievalMatched: boolean,
  contextMatched: boolean,
  promptMatched: boolean,
  pipelineSuccess: boolean,
): FailureStage | null {
  if (!pipelineSuccess) return 'PROVIDER_FAILURE';
  if (!intentMatched) return 'INTENT_FAILURE';
  if (!retrievalMatched) return 'RETRIEVAL_FAILURE';
  if (!contextMatched) return 'CONTEXT_FAILURE';
  if (!promptMatched) return 'PROMPT_FAILURE';
  return null;
}

/**
 * Generate a human-readable report string.
 */
export function formatReport(report: ValidationReport): string {
  const lines: string[] = [
    '═══════════════════════════════════════════',
    '  DevForge AI Validation Report',
    '═══════════════════════════════════════════',
    '',
    `Repository: ${report.repository}`,
    `Timestamp:  ${report.timestamp}`,
    `Questions:  ${report.summary.totalQuestions}`,
    '',
    '─── Quality Metrics ───',
    `Intent:       ${report.summary.intentCorrect}/${report.summary.totalQuestions}`,
    `Retrieval:    ${report.summary.retrievalMatched}/${report.summary.totalQuestions}`,
    `Context:      ${report.summary.contextMatched}/${report.summary.totalQuestions}`,
    `Prompt:       ${report.summary.promptMatched}/${report.summary.totalQuestions}`,
    `Pipeline:     ${report.summary.pipelineSuccess}/${report.summary.totalQuestions}`,
    '',
  ];

  if (report.failures.length > 0) {
    lines.push('─── Failures ───');
    for (const f of report.failures) {
      lines.push('');
      lines.push(`Question: "${f.question}"`);
      lines.push(`Stage:    ${f.stage}`);
      lines.push(`Expected: ${f.expected}`);
      lines.push(`Actual:   ${f.actual}`);
    }
  } else {
    lines.push('─── No Failures ───');
  }

  lines.push('', '═══════════════════════════════════════════');
  return lines.join('\n');
}

/**
 * Create a baseline from a validation report.
 */
export function createBaseline(report: ValidationReport): ValidationBaseline {
  const caseIntents: Record<string, string> = {};
  const caseRetrievalSymbols: Record<string, string[]> = {};
  const caseContextSymbols: Record<string, string[]> = {};

  for (const c of report.cases) {
    caseIntents[c.questionId] = c.intent.actual;
    caseRetrievalSymbols[c.questionId] = c.retrieval.foundSymbols;
    caseContextSymbols[c.questionId] = c.context.foundInPrompt;
  }

  return {
    timestamp: report.timestamp,
    repository: report.repository,
    summary: { ...report.summary },
    caseIntents,
    caseRetrievalSymbols,
    caseContextSymbols,
  };
}

/**
 * Compare current report against a baseline for regression detection.
 */
export function detectRegressions(
  current: ValidationReport,
  baseline: ValidationBaseline,
): Array<{ questionId: string; regression: string }> {
  const regressions: Array<{ questionId: string; regression: string }> = [];

  for (const c of current.cases) {
    // Check intent regression
    const baselineIntent = baseline.caseIntents[c.questionId];
    if (baselineIntent && c.intent.actual !== baselineIntent) {
      regressions.push({
        questionId: c.questionId,
        regression: `Intent changed: ${baselineIntent} → ${c.intent.actual}`,
      });
    }

    // Check context regression
    const baselineContext = baseline.caseContextSymbols[c.questionId] ?? [];
    const currentContext = c.context.foundInPrompt;
    const lostContext = baselineContext.filter((s) => !currentContext.includes(s));
    if (lostContext.length > 0) {
      regressions.push({
        questionId: c.questionId,
        regression: `Lost context symbols: ${lostContext.join(', ')}`,
      });
    }
  }

  return regressions;
}

// ── Helpers ──

function extractPromptText(diag: DevForgeDiagnosticsResult): string {
  const parts: string[] = [];
  // Access prompt messages from diagnostics (added by askWithDiagnostics)
  const d = diag.diagnostics as Record<string, unknown>;
  const promptMessages = d.promptMessages as Array<{ role: string; content: string }> | undefined;
  if (promptMessages) {
    for (const msg of promptMessages) {
      parts.push(msg.content);
    }
  }
  return parts.join(' ');
}

function extractFoundSymbols(diag: DevForgeDiagnosticsResult): string[] {
  // From diagnostics, we know symbolCount but not names.
  // For real validation we'd need the context content.
  // Use the provider response as a proxy.
  const symbols: string[] = [];
  if (diag.result.status === 'answered') {
    // Check answer text for symbol names
    const knownSymbols = [
      'DevForgeRuntime', 'DevForgeBrain', 'PromptComposer',
      'buildSymbolGraph', 'buildKnowledgeGraph', 'classifyIntent',
      'indexRepository', 'OpenAICompatibleProvider', 'FakeModelProvider',
      'createDevForge',
    ];
    for (const s of knownSymbols) {
      if (diag.result.answer.includes(s)) {
        symbols.push(s);
      }
    }
  }
  return symbols;
}

function getExpectedDescription(c: ValidationCaseResult): string {
  const parts: string[] = [];
  if (!c.intent.matched) parts.push(`intent=${c.intent.expected}`);
  if (!c.retrieval.matched) parts.push(`retrieval symbols=[${c.retrieval.expectedSymbols.join(', ')}]`);
  if (!c.context.matched) parts.push(`context symbols=[${c.context.expectedSymbols.join(', ')}]`);
  if (!c.prompt.matched) parts.push(`prompt contains=[${c.prompt.expectedContains.join(', ')}]`);
  return parts.join('; ') || 'pipeline success';
}

function getActualDescription(c: ValidationCaseResult): string {
  const parts: string[] = [];
  if (!c.intent.matched) parts.push(`intent=${c.intent.actual}`);
  if (!c.retrieval.matched) parts.push(`found=[${c.retrieval.foundSymbols.join(', ')}]`);
  if (!c.context.matched) parts.push(`inPrompt=[${c.context.foundInPrompt.join(', ')}]`);
  if (!c.prompt.matched) parts.push(`found=[${c.prompt.found.join(', ')}]`);
  if (!c.pipeline.success) parts.push(`status=${c.pipeline.status}`);
  return parts.join('; ') || 'ok';
}