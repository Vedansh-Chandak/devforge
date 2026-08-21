/**
 * @devforge/cli — public exports (M1).
 *
 * Exposes the program builder and bootstrap entry for programmatic use and
 * integration testing.
 */

export { run, createProgram } from './services/orchestrator.js';
export type { CommandHandler } from './services/orchestrator.js';
export { createLightContext, createExecutionContext } from './services/session.js';
export type { LightCliContext, ExecutionContext, CommandSessionContext } from './services/session.js';

// Types
export type { DevForgeConfig, RawDevForgeConfig, ProviderKind, LogLevel, CliOptions } from './types.js';
export { DEFAULT_CONFIG, DEFAULT_TEMPERATURE, DEFAULT_MAX_TOKENS } from './types.js';

// Config loader
export { validateConfig, loadConfig, loadFromEnv, loadJsonFile, userConfigPath, isProviderKind } from './services/config-loader.js';
export type { ConfigValidationResult, CredentialSource } from './services/config-loader.js';

// Model route resolution (DF-029B)
export {
  resolveModelRoutes,
  summarizeRoleRoutes,
  hasExplicitModelConfig,
} from './services/model-routes.js';
export type { ResolvedRoutePayload, RoleRouteStatus } from './services/model-routes.js';

// Services
export {
  discoverRepository,
  createProvider,
  createPlannerService,
  createExecutorService,
  createBrainService,
} from './services/index.js';
export type {
  RepositoryContext,
  WorkspaceService,
  ProviderFactoryOptions,
  BrainService,
  PlannerService,
  ExecutorService,
  ExecutorConfig,
} from './services/index.js';

// Commands
export {
  handleAsk,
  handleExplain,
  handleReview,
  handleFix,
  handlePlan,
  handleRun,
  handleStatus,
  handleDoctor,
  handleConfig,
  runHealthChecks,
} from './commands/index.js';
export type { HealthCheck } from './commands/index.js';
export type { ModelConfigurationSummary } from './commands/doctor.js';
export type { ConfigPayload } from './commands/config.js';

// Errors
export { CliError, ConfigError, formatError } from './errors.js';
export type { CliErrorCode } from './errors.js';

// Output / progress
export { Logger, logger } from './utils/logger.js';
export { renderPlan, renderCodingReport, renderExecutionReport, renderStatus, color } from './services/output.js';
export { Spinner, withSpinner } from './services/progress.js';