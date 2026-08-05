/**
 * @devforge/cli — CLI Context (M1).
 *
 * The fully-initialized context passed to command handlers.
 */

import type { DevForgeConfig } from '../config/config.js';
import type { RepositoryContext } from '../services/workspace.js';
import type { BrainService } from '../services/brain.js';
import type { PlannerService } from '../services/planner.js';
import type { ExecutorService } from '../services/executor.js';
import type { WorkspaceService } from '../services/workspace.js';
import { defaultVerificationTargets } from '@devforge/execution';

/** CLI global options. */
export interface CliOptions {
  /** Output as JSON instead of human-readable text. */
  json: boolean;
  /** Enable debug logging and stack traces. */
  debug: boolean;
  /** Auto-approve confirmation steps for autonomous execution. */
  autoApprove: boolean;
}

/** Fully-initialized CLI context. */
export interface CliContext {
  /** Working directory where the command was invoked. */
  cwd: string;
  /** Resolved and validated configuration. */
  config: DevForgeConfig;
  /** Discovered repository context. */
  repository: RepositoryContext;
  /** Service bundle. */
  services: {
    workspace: WorkspaceService;
    brain: BrainService;
    planner: PlannerService;
    executor: ExecutorService;
  };
  /** Global CLI options. */
  options: CliOptions;
}

/** Build a CliContext from configuration and discovered repository. */
export async function buildContext(
  cwd: string,
  config: DevForgeConfig,
  repository: RepositoryContext,
  options: CliOptions,
): Promise<CliContext> {
  const { createProvider, createBrainService } = await import('../services/brain.js');
  const { createPlannerService } = await import('../services/planner.js');
  const { createExecutorService } = await import('../services/executor.js');
  const { createWorkspaceService } = await import('../services/workspace.js');

  const provider = createProvider({
    kind: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs,
    temperature: config.temperature,
  });

  const workspaceService = createWorkspaceService(repository);
  const brain = await createBrainService(config, repository.root);
  const planner = createPlannerService(provider, config.temperature ?? 0.2);
  
  // Build verification targets from repository context
  const verificationTargets = buildVerificationTargets(repository);
  
  const executor = await createExecutorService(provider, repository.root, {
    maxRepairAttempts: config.maxRepairAttempts ?? 3,
    temperature: config.temperature ?? 0.2,
    verificationTargets,
    autoApprove: options.autoApprove,
  });

  return {
    cwd,
    config,
    repository,
    services: {
      workspace: workspaceService,
      brain,
      planner,
      executor,
    },
    options,
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