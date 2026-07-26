/**
 * Validation harness types — failure classification, report format, baseline.
 */

/** Failure classification categories */
export type FailureStage =
  | 'INTENT_FAILURE'
  | 'QUERY_EXTRACTION_FAILURE'
  | 'RETRIEVAL_FAILURE'
  | 'CONTEXT_FAILURE'
  | 'PROMPT_FAILURE'
  | 'PROVIDER_FAILURE'
  | 'ANSWER_GROUNDING_FAILURE'
  | 'UNKNOWN_FAILURE';

/** Result of validating a single golden question */
export interface ValidationCaseResult {
  questionId: string;
  question: string;
  intent: {
    expected: string;
    actual: string;
    matched: boolean;
  };
  retrieval: {
    expectedSymbols: string[];
    foundSymbols: string[];
    matched: boolean;
  };
  context: {
    expectedSymbols: string[];
    foundInPrompt: string[];
    matched: boolean;
  };
  prompt: {
    expectedContains: string[];
    found: string[];
    matched: boolean;
  };
  pipeline: {
    success: boolean;
    status: string;
  };
  failureStage: FailureStage | null;
  duration: number;
  diagnostics?: {
    contextChars: number;
    truncated: boolean;
    symbolCount: number;
    dependencyCount: number;
  };
}

/** Summary metrics */
export interface ValidationSummary {
  totalQuestions: number;
  intentCorrect: number;
  retrievalMatched: number;
  contextMatched: number;
  promptMatched: number;
  pipelineSuccess: number;
}

/** Full validation report */
export interface ValidationReport {
  repository: string;
  timestamp: string;
  summary: ValidationSummary;
  cases: ValidationCaseResult[];
  failures: Array<{
    questionId: string;
    question: string;
    stage: FailureStage;
    expected: string;
    actual: string;
  }>;
}

/** Baseline format for regression detection */
export interface ValidationBaseline {
  timestamp: string;
  repository: string;
  summary: ValidationSummary;
  caseIntents: Record<string, string>;
  caseRetrievalSymbols: Record<string, string[]>;
  caseContextSymbols: Record<string, string[]>;
}