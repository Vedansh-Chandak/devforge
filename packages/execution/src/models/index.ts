/**
 * @devforge/execution — Model Integration (DF-016C).
 *
 * Provider-backed CodingModel and ReasoningModel plus pure prompt building,
 * output parsing, and typed errors.
 */

// Types
export {
  ProviderCodingModel,
  ProviderReasoningModel,
} from './provider-models.js';
export type {
  ProviderCodingModelOptions,
  ProviderReasoningModelOptions,
} from './provider-models.js';

// Types
export type {
  ModelSettings,
  ProviderModelOptions,
  ReasoningResult,
  ParseResult,
  ParseFailure,
  ParseErrorCode,
} from './types.js';
export type {
  ModelProvider,
  ModelMessage,
  ModelRequest,
  ModelResponse,
} from '@devforge/model-provider';

// Errors
export {
  ModelIntegrationError,
  PromptError,
  ParseError,
  PatchParseError,
  ReasoningParseError,
  ProviderError,
  CancellationError,
  isProviderError,
  isParseError,
  isCancellationError,
} from './errors.js';
export type { IntegrationErrorOptions, ParseFailureOptions } from './errors.js';

// Prompt building
export {
  OUTPUT_TAGS,
  buildPatchSystemPrompt,
  buildPatchUserPrompt,
  buildPatchPrompt,
  buildFailureAnalysisSystemPrompt,
  buildFailureAnalysisUserPrompt,
  buildFailureAnalysisPrompt,
  buildRepairDecisionSystemPrompt,
  buildRepairDecisionUserPrompt,
  buildRepairDecisionPrompt,
  buildDocumentationSystemPrompt,
  buildDocumentationUserPrompt,
  buildDocumentationPrompt,
  buildReviewSystemPrompt,
  buildReviewUserPrompt,
  buildReviewPrompt,
  buildModelRequest,
} from './prompt-builder.js';

// Parsing
export { parsePatches } from './patch-parser.js';
export { parseFailureAnalysis, parseRepairDecision } from './reasoning-parser.js';