/**
 * @devforge/cli — Services subsystem (M1).
 */

export { discoverRepository, createWorkspaceService, type RepositoryContext, type WorkspaceService } from './workspace.js';
export { createProvider, createBrainService, type ProviderFactoryOptions, type BrainService } from './brain.js';
export { createPlannerService, type PlannerService } from './planner.js';
export { createExecutorService, type ExecutorConfig, type ExecutorService } from './executor.js';
export { createProgram, run, type CommandHandler } from './orchestrator.js';
export { createLightContext, createExecutionContext } from './session.js';
export type { LightCliContext, ExecutionContext, ExecutionServices, LightServices, CommandSessionContext } from './session.js';
export { runEnvironmentChecks, isLightweightCommand, type HealthCheck } from './environment.js';
export { loadConfig, loadFromEnv, loadJsonFile, userConfigPath, validateConfig, isProviderKind, type ConfigValidationResult, type CredentialSource } from './config-loader.js';
export {
  resolveModelRoutes,
  summarizeRoleRoutes,
  hasExplicitModelConfig,
  type ResolvedRoutePayload,
  type RoleRouteStatus,
} from './model-routes.js';
export {
  color,
  writeJson,
  renderPlan,
  renderPlanResult,
  renderCodingReport,
  renderExecutionReport,
  renderStatus,
} from './output.js';
export { Spinner, withSpinner } from './progress.js';