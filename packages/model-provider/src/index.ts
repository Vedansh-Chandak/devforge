export type {
  MessageRole,
  FinishReason,
  ModelMessage,
  ModelRequest,
  ModelUsage,
  ModelResponse,
  ModelProvider,
  ModelSelectionRole,
  ModelCapabilities,
  ModelProviderInfo,
} from './types.js';

export {
  ModelProviderError,
  isModelProviderError,
  createProviderError,
} from './errors.js';

export type { ModelErrorCode } from './errors.js';

export { BaseModelProvider } from './provider.js';

export { FakeModelProvider } from './testing/fake-provider.js';
export type { FakeProviderConfig } from './testing/fake-provider.js';

export { OpenAICompatibleProvider } from './openai-compatible.js';
export type {
  OpenAICompatibleProviderConfig,
  FetchFn,
} from './openai-compatible.js';

export { GeminiProvider } from './gemini.js';
export type { GeminiProviderConfig } from './gemini.js';
export {
  geminiClassifyHttpStatus,
  mapGeminiFinishReason,
  extractGeminiUsage,
  toGeminiContents,
  toGeminiResponseSchema,
} from './gemini.js';

export { AnthropicProvider } from './anthropic.js';
export type { AnthropicProviderConfig } from './anthropic.js';
export {
  mapAnthropicStopReason,
  extractAnthropicUsage,
  toAnthropicMessages,
} from './anthropic.js';

export { createModelProvider, getProviderInfo, listProviderKinds, createModelProviderFromConfig } from './factory.js';
export type {
  ProviderKind,
  ProviderConfigMap,
  ProviderInfo,
} from './factory.js';

export {
  ModelRouter,
  ModelRouterError,
  isModelRouterError,
  createModelRouter,
  resolveRoleConfig,
} from './router.js';
export type {
  ModelRouterOptions,
  ResolvedModelRoute,
  ModelRouteSource,
} from './router.js';

export {
  MODEL_PROVIDER_KINDS,
  MODEL_ROLES,
  isModelProviderKind,
  parseModelConfigEnv,
  mergeModelConfig,
  validateModelConfig,
  redactModelConfig,
  isMissingModel,
  roleLabel,
} from './model-config.js';
export type {
  ModelProviderKind,
  ModelConfig,
  PartialModelConfig,
  RoleModelConfigMap,
  ModelEnvConfig,
  ModelConfigIssue,
  ModelConfigValidationResult,
} from './model-config.js';

export {
  HttpTransport,
  classifyHttpStatus,
  sanitizeUrl,
  isRecord,
  extractErrorMessage,
  extractErrorStatus,
  mapFetchFailure,
} from './transport.js';
export type {
  FetchFn as TransportFetchFn,
  AuthScheme,
  TransportConfig,
  TransportRequest,
  HttpStatusClassification,
} from './transport.js';

export { selectModel, selectModelName, resolveRoleModel } from './selection.js';
export type { ModelSelection, RoleModelMap } from './selection.js';

export {
  retry,
  shouldRetry,
  isRetryableCode,
  DEFAULT_RETRYABLE_CODES,
  normalizePolicy,
  computeBackoff,
  defaultSleep,
} from './retry.js';
export type { RetryPolicy, RetryOptions, NormalizedRetryPolicy } from './retry.js';

export { withTimeout } from './timeout.js';
export type { TimeoutOptions } from './timeout.js';

export { redactSecretText, redactSecrets, MIN_SECRET_LENGTH } from './redact.js';

export {
  validateProviderConfig,
  assertValidProviderConfig,
  isHttpUrl,
} from './validate.js';
export type {
  ProviderConfigShape,
  ConfigIssue,
  ConfigValidationResult,
} from './validate.js';

export {
  parseJsonContent,
  stripCodeFence,
  validateStructuredOutput,
  assertStructuredOutput,
} from './structured.js';
export type {
  JsonPrimitive,
  JsonValue,
  JsonSchemaType,
  JsonPropertySchema,
  JsonObjectSchema,
  StructuredOutputSchema,
  StructuredOutputResult,
  StructuredOutputError,
} from './structured.js';
