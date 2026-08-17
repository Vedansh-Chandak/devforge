/**
 * @devforge/cli — CLI Session Service (DF-017.1).
 *
 * Builds the CLI context passed to command handlers. Context creation is split
 * into two tiers so that commands which do not require AI or execution never
 * initialize the full runtime stack:
 *
 *   - createLightContext():  configuration, repository discovery, environment
 *                            checks, logger, output, progress.
 *   - createExecutionContext(): everything in the light context PLUS provider,
 *                            brain, planner, executor, workspace, git, runner.
 *
 * Execution context delegates to the light context first, so no initialization
 * logic is duplicated.
 */

import type { DevForgeConfig, CliOptions } from '../types.js';
import type { RepositoryContext, WorkspaceService } from './workspace.js';
import type { BrainService } from './brain.js';
import type { PlannerService } from './planner.js';
import type { ExecutorService } from './executor.js';
import type { HealthCheck } from './environment.js';
import { logger } from '../utils/logger.js';
import * as output from './output.js';
import * as progress from './progress.js';
import { defaultVerificationTargets } from '@devforge/execution';

/** Services available in the lightweight (non-AI/execution) context. */
export interface LightServices {
  readonly workspace: WorkspaceService;
  readonly logger: typeof logger;
  readonly output: typeof output;
  readonly progress: typeof progress;
  readonly environment: readonly HealthCheck[];
}

/** Lightweight context used by config/status/doctor/help/version. */
export interface LightCliContext {
  /** Working directory where the command was invoked. */
  cwd: string;
  /** Resolved and validated configuration. */
  config: DevForgeConfig;
  /** Discovered repository context. */
  repository: RepositoryContext;
  /** Lightweight service bundle (no brain/planner/executor). */
  services: LightServices;
  /** Global CLI options. */
  options: CliOptions;
  /** Cancellation signal (aborted on SIGINT). */
  signal?: AbortSignal;
}

/** AI/execution services available only to heavy commands. */
export interface ExecutionServices {
  readonly workspace: WorkspaceService;
  readonly logger: typeof logger;
  readonly output: typeof output;
  readonly progress: typeof progress;
  readonly brain: BrainService;
  readonly planner: PlannerService;
  readonly executor: ExecutorService;
}

/** Fully-initialized context for commands that need brain/planner/executor. */
export interface ExecutionContext {
  cwd: string;
  config: DevForgeConfig;
  repository: RepositoryContext;
  services: ExecutionServices;
  options: CliOptions;
  /** Cancellation signal (aborted on SIGINT). */
  signal?: AbortSignal;
}

/** Union accepted by the command router (either tier of context). */
export type CommandSessionContext = LightCliContext | ExecutionContext;

/**
 * Create a lightweight CLI context: configuration, repository discovery,
 * environment checks, logger, output, and progress. No AI or execution services
 * are initialized, keeping `config`/`status`/`doctor` fast and side-effect free
 * on the expensive stack.
 */
export async function createLightContext(
  cwd: string,
  options: CliOptions,
  signal?: AbortSignal,
): Promise<LightCliContext> {
  const { loadConfig } = await import('./config-loader.js');
  const { discoverRepository, createWorkspaceService } = await import('./workspace.js');
  const { runEnvironmentChecks } = await import('./environment.js');

  const { config } = await loadConfig(cwd);
  logger.setLevel(config.logLevel);

  const repository = await discoverRepository(config.workspace ?? cwd);
  const environment = runEnvironmentChecks(repository, config);

  const workspaceService = createWorkspaceService(repository);

  return {
    cwd,
    config,
    repository,
    options,
    signal,
    services: {
      workspace: workspaceService,
      logger,
      output,
      progress,
      environment,
    },
  };
}

/**
 * Create a full execution context: everything in the light context PLUS the
 * model provider, brain, planner, executor, workspace, git service, and command
 * runner. Used by ask/plan/run/review/fix/explain.
 */
export async function createExecutionContext(
  cwd: string,
  options: CliOptions,
  signal?: AbortSignal,
): Promise<ExecutionContext> {
  const light = await createLightContext(cwd, options, signal);

  const { createProvider, createBrainService } = await import('./brain.js');
  const { createPlannerService } = await import('./planner.js');
  const { createExecutorService } = await import('./executor.js');

  const provider = createProvider({
    kind: light.config.provider,
    model: light.config.model,
    baseUrl: light.config.baseUrl,
    apiKey: light.config.apiKey,
    timeoutMs: light.config.timeoutMs,
    temperature: light.config.temperature,
  });

  const workspaceService = light.services.workspace;
  const brain = await createBrainService(light.config, light.repository.root, signal);
  const planner = createPlannerService(provider, light.config.temperature ?? 0.2);

  // Build verification targets from repository context
  const verificationTargets = buildVerificationTargets(light.repository);

  const executor = await createExecutorService(provider, light.repository.root, {
    maxRepairAttempts: light.config.maxRepairAttempts ?? 3,
    temperature: light.config.temperature ?? 0.2,
    verificationTargets,
    autoApprove: options.autoApprove,
  }, signal);

  return {
    cwd: light.cwd,
    config: light.config,
    repository: light.repository,
    options: light.options,
    signal,
    services: {
      workspace: workspaceService,
      logger,
      output,
      progress,
      brain,
      planner,
      executor,
    },
  };
}

/** Build verification targets from repository context (build/test/lint commands). */
function buildVerificationTargets(repo: RepositoryContext): readonly import('@devforge/execution').VerificationTarget[] {
  const targets: import('@devforge/execution').VerificationTarget[] = [];
  const allowedCommands = ['pnpm', 'npm', 'yarn', 'vitest', 'jest', 'mocha', 'node', 'tsc', 'eslint', 'prettier', 'git', 'turbo'] as const;

  // Typecheck target (always if tsconfig exists)
  if (repo.tsconfig) {
    targets.push({
      id: 'typecheck',
      command: 'tsc',
      args: ['--noEmit'],
      cwd: repo.root,
      timeoutMs: 60_000,
      maxOutputBytes: 1024 * 1024,
    });
  }

  // Test target (if test command exists and is a supported command)
  if (repo.testCommand) {
    const parts = repo.testCommand.split(' ');
    const cmd = parts[0];
    const args = parts.slice(1);
    if (allowedCommands.includes(cmd as typeof allowedCommands[number])) {
      targets.push({
        id: 'test',
        command: cmd as import('@devforge/execution').Command,
        args,
        cwd: repo.root,
        timeoutMs: 120_000,
        maxOutputBytes: 1024 * 1024,
      });
    }
  }

  // Lint target (if lint command exists and is a supported command)
  if (repo.lintCommand) {
    const parts = repo.lintCommand.split(' ');
    const cmd = parts[0];
    const args = parts.slice(1);
    if (allowedCommands.includes(cmd as typeof allowedCommands[number])) {
      targets.push({
        id: 'lint',
        command: cmd as import('@devforge/execution').Command,
        args,
        cwd: repo.root,
        timeoutMs: 60_000,
        maxOutputBytes: 1024 * 1024,
      });
    }
  }

  // Fallback to default if nothing detected
  if (targets.length === 0) {
    return defaultVerificationTargets(repo.root);
  }

  return targets;
}