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
export type { ConfigValidationResult } from './services/config-loader.js';

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

// Errors
export { CliError, ConfigError, formatError } from './errors.js';
export type { CliErrorCode } from './errors.js';

// Output / progress
export { Logger, logger } from './utils/logger.js';
export { renderPlan, renderCodingReport, renderExecutionReport, renderStatus, color } from './services/output.js';
export { Spinner, withSpinner } from './services/progress.js';