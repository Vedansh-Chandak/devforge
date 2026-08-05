/**
 * @devforge/cli — public exports (M1).
 *
 * Exposes the program builder and bootstrap entry for programmatic use and
 * integration testing.
 */

export { run } from './bootstrap.js';

// Router
export { createProgram } from './routing/router.js';
export type { CommandHandler } from './routing/router.js';
export { buildContext } from './routing/context.js';
export type { CliContext, CliOptions } from './routing/context.js';

// Config
export type { DevForgeConfig, RawDevForgeConfig, ProviderKind, LogLevel } from './config/index.js';
export { validateConfig, loadConfig, DEFAULT_CONFIG, DEFAULT_TEMPERATURE } from './config/index.js';

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
  runHealthChecks,
} from './commands/index.js';

// Utils
export { CliError, ConfigError, formatError } from './utils/errors.js';
export type { CliErrorCode } from './utils/errors.js';
export { Logger, logger } from './utils/logger.js';
export { renderPlan, renderCodingReport, renderExecutionReport, renderStatus, color } from './utils/output.js';