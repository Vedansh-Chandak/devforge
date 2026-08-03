/**
 * @devforge/execution — Model Integration Types (DF-016C).
 *
 * Shared types for provider-backed CodingModel and ReasoningModel.
 * These types bridge the executor interfaces and the ModelProvider abstraction.
 */

import type { ModelProvider, ModelMessage, ModelRequest, ModelResponse } from '@devforge/model-provider';
import type { CodePatch, DiagnosticCategory } from '../executor/patch-model.js';
import type { CodingModelRequest } from '../executor/coding-model.js';
import type {
  FailureAnalysis,
  RepairDecision,
  FailureAnalysisInput,
  RepairDecisionInput,
} from '../executor/reasoning-model.js';
import type { Diagnostics } from '../executor/diagnostics.js';

/** Configuration for model generation (provider-agnostic). */
export interface ModelSettings {
  /** Sampling temperature (0.0-2.0). */
  readonly temperature?: number;
  /** Maximum output tokens. */
  readonly maxTokens?: number;
  /** System prompt to prepend to all requests. */
  readonly systemPrompt?: string;
  /** Hint for model selection (not passed to provider directly). */
  readonly modelHint?: string;
}

/** Options for creating a provider-backed model. */
export interface ProviderModelOptions {
  /** The ModelProvider instance to use. */
  readonly provider: ModelProvider;
  /** Generation settings (merged with defaults). */
  readonly settings?: ModelSettings;
  /** Optional abort signal for cancellation. */
  readonly signal?: AbortSignal;
}

/** Unified result from analysis + decision. */
export interface ReasoningResult {
  readonly analysis: FailureAnalysis;
  readonly decision: RepairDecision;
}

/** Result of a parse attempt (never throws). */
export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ParseFailure };

/** Structured parse failure with recovery metadata. */
export interface ParseFailure {
  readonly code: ParseErrorCode;
  readonly message: string;
  /** Original raw output that failed to parse. */
  readonly rawOutput: string;
  /** Whether the parser attempted recovery. */
  readonly recoveryAttempted: boolean;
  /** Partial value if recovery partially succeeded. */
  readonly partialValue?: unknown;
}

/** Parse error codes for typed handling. */
export type ParseErrorCode =
  | 'NO_TAGS_FOUND'
  | 'MALFORMED_JSON'
  | 'INVALID_SCHEMA'
  | 'EMPTY_OUTPUT'
  | 'TAG_MISMATCH'
  | 'UNEXPECTED_FORMAT';

/** Re-export key types for convenience. */
export type {
  ModelProvider,
  ModelMessage,
  ModelRequest,
  ModelResponse,
  CodePatch,
  DiagnosticCategory,
  FailureAnalysis,
  RepairDecision,
  Diagnostics,
  CodingModelRequest,
  FailureAnalysisInput,
  RepairDecisionInput,
};