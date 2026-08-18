/**
 * @devforge/config — normalized model configuration (DF-026C).
 *
 * Single configuration import surface for the model-provider normalization:
 * provider kinds, env parsing, validation, redaction, and the deterministic
 * {@link ModelRouter}. Provider-specific request formats stay inside
 * `@devforge/model-provider` adapters; application code never sees them.
 */

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
  ModelRouter,
  ModelRouterError,
  isModelRouterError,
  createModelRouter,
  resolveRoleConfig,
} from '@devforge/model-provider';

export type {
  ModelProviderKind,
  ModelConfig,
  PartialModelConfig,
  RoleModelConfigMap,
  ModelEnvConfig,
  ModelConfigIssue,
  ModelConfigValidationResult,
  ModelRouterOptions,
  ResolvedModelRoute,
  ModelRouteSource,
} from '@devforge/model-provider';