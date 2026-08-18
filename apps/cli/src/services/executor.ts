/**
 * @devforge/cli — Executor Service (M1).
 *
 * Creates the full execution stack: Workspace, GitService, CommandRunner,
 * CodingModel/ReasoningModel, PatchEngine, CodingEngine, and the Executor
 * with step handlers for all plan step types.
 */

import {
  Workspace,
  createCommandRunner,
  createGitService,
  WorkspaceOptions,
  CommandRunnerConfig,
  GitServiceConfig,
  ProviderCodingModel,
  ProviderReasoningModel,
  createPatchEngine,
  DefaultPatchEngine,
  createCodingEngine,
  AutonomousCodingEngine,
  createExecutor,
  Executor,
  VerificationTarget,
  defaultVerificationTargets,
  VerificationResult,
  CommandRunner,
  Workspace as WorkspaceClass,
  GitService,
} from '@devforge/execution';
import type { ModelProvider, ModelSelectionRole } from '@devforge/model-provider';
import type { CodePatch, StepHandler, StepContext, StepResult } from '@devforge/execution';
import type { ExecutionPlan, PlanStepType } from '@devforge/planner';
import { logger } from '../utils/logger.js';

/** Configuration for the executor service. */
export interface ExecutorConfig {
  readonly maxRepairAttempts: number;
  readonly temperature: number;
  readonly verificationTargets?: readonly VerificationTarget[];
  /** If true, automatically approve confirmation steps for autonomous execution. */
  readonly autoApprove?: boolean;
}

/**
 * Role→provider resolver (DF-026C). Accepts either a single ModelProvider
 * (legacy behavior: every role uses it) or a ModelRouter (role-routed:
 * coding→CODING, reasoning→REASONING).
 */
export interface RouterLike {
  readonly has: (role: ModelSelectionRole) => boolean;
  readonly select: (role: ModelSelectionRole) => ModelProvider;
}

export type ModelSource = ModelProvider | RouterLike;

function isRouter(source: ModelSource): source is RouterLike {
  return typeof (source as { select?: unknown }).select === 'function';
}

/** Service interface for execution operations. */
export interface ExecutorService {
  readonly executor: Executor;
  readonly codingEngine: AutonomousCodingEngine;
  readonly workspace: WorkspaceClass;
  readonly runner: CommandRunner;
  readonly git: GitService;
  readonly codingModel: ProviderCodingModel;
  readonly reasoningModel: ProviderReasoningModel;
  /** Execute a full plan with step handlers for all step types. */
  executePlan(plan: ExecutionPlan, options?: { signal?: AbortSignal }): Promise<import('@devforge/execution').ExecutionReport>;
  /** Run the autonomous coding engine directly (used by `fix`). */
  fix(goal: string, context?: readonly string[]): Promise<import('@devforge/execution').CodingReport>;
}

/**
 * Create step handlers for all plan step types.
 * - COMMAND: uses built-in runner with commandSteps
 * - VERIFY: uses built-in runVerification
 * - SEARCH/READ/ANALYZE/PLAN: read-only handlers that produce context
 * - EDIT/CREATE/DELETE: mutating handlers that delegate to the coding engine
 */
function createStepHandlers(
  workspace: WorkspaceClass,
  runner: CommandRunner,
  git: GitService,
  codingEngine: AutonomousCodingEngine,
): Partial<Record<PlanStepType, StepHandler>> {
  const handlers: Partial<Record<PlanStepType, StepHandler>> = {};

  // Read-only analysis steps
  const readOnlyHandler: StepHandler = async (ctx): Promise<StepResult> => {
    const { step } = ctx;
    const summary = await runAnalysisStep(step, workspace, runner);
    return { ok: true, summary };
  };

  for (const type of ['SEARCH', 'READ', 'ANALYZE', 'PLAN'] as PlanStepType[]) {
    handlers[type] = readOnlyHandler;
  }

  // Mutating steps: delegate to coding engine
  const mutatingHandler: StepHandler = async (ctx): Promise<StepResult> => {
    const { step } = ctx;
    logger.debug('Executing mutating step via coding engine', { step: step.id, type: step.type });

    // Use the step's title/description as the goal for the coding engine
    const goal = `${step.title}. ${step.description ?? ''}`.trim();
    const report = await codingEngine.run({ goal, context: [] });

    return {
      ok: report.outcome === 'SUCCESS',
      summary: `Coding engine ${report.outcome.toLowerCase()}: ${report.patchesGenerated} patches, ${report.repairAttempts} repairs`,
      detail: report.error?.message,
    };
  };

  for (const type of ['EDIT', 'CREATE', 'DELETE'] as PlanStepType[]) {
    handlers[type] = mutatingHandler;
  }

  return handlers;
}

/**
 * Run an analysis step by gathering context from the repository.
 * Uses the workspace and indexer to provide real data.
 */
async function runAnalysisStep(
  step: import('@devforge/planner').PlanStep,
  workspace: WorkspaceClass,
  runner: CommandRunner,
): Promise<string> {
  switch (step.type) {
    case 'SEARCH': {
      // List files in the workspace
      const files = await workspace.list('');
      return `Found ${files.length} files at root`;
    }
    case 'READ': {
      // Try to read the file mentioned in step description
      const match = step.description?.match(/['"]([^'"]+)['"]/) ?? step.description?.match(/`([^`]+)`/);
      if (match) {
        try {
          const content = await workspace.readFile(match[1]!);
          return `Read ${match[1]} (${content.length} chars)`;
        } catch {
          return `File ${match[1]} not found`;
        }
      }
      return 'READ step: no file specified';
    }
    case 'ANALYZE': {
      // Run a quick typecheck via command runner
      try {
        const result = await runner.run({
          command: 'tsc',
          args: ['--noEmit'],
          cwd: workspace.root,
          timeoutMs: 30_000,
          allowFailure: true,
        });
        return result.success ? 'Typecheck passed' : `Typecheck failed (exit ${result.exitCode})`;
      } catch {
        return 'Analysis command failed';
      }
    }
    case 'PLAN': {
      return 'Planning step acknowledged';
    }
    default:
      return `Completed ${step.type} step`;
  }
}

/**
 * Create the full ExecutorService from a model source and workspace root.
 *
 * @param source - either a single {@link ModelProvider} (every model-backed
 *   component uses it) or a role-resolving {@link ModelRouter} so the coding
 *   engine routes to the `coding` role and the reasoning engine to the
 *   `reasoning` role (DF-026C).
 */
export async function createExecutorService(
  source: ModelSource,
  repoRoot: string,
  config: ExecutorConfig,
  signal?: AbortSignal,
): Promise<ExecutorService> {
  // Core services
  const workspace = new Workspace({ root: repoRoot } as WorkspaceOptions);
  const runner = createCommandRunner({ workspaceRoot: repoRoot } as CommandRunnerConfig);
  const git = createGitService({ workspaceRoot: repoRoot, runner } as GitServiceConfig);

  const codingProvider = isRouter(source) ? source.select('coding') : source;
  const reasoningProvider = isRouter(source) ? source.select('reasoning') : source;

  // Model-backed coding & reasoning
  const codingModel = new ProviderCodingModel({
    provider: codingProvider,
    settings: { temperature: config.temperature },
  });
  const reasoningModel = new ProviderReasoningModel({
    provider: reasoningProvider,
    settings: { temperature: config.temperature },
  });

  // Patch engine and coding engine
  const patchEngine = createPatchEngine({ model: codingModel });
  const verificationTargets = config.verificationTargets ?? defaultVerificationTargets(repoRoot);

  const codingEngine = createCodingEngine({
    workspace,
    runner,
    patchEngine,
    codingModel,
    reasoningModel,
    verificationTargets,
    cwd: repoRoot,
    signal,
    budgets: {
      maxRepairAttempts: config.maxRepairAttempts,
    },
  });

  // Executor with step handlers
  const executor = createExecutor({
    workspaceRoot: repoRoot,
    runner,
    git,
    workspace,
    handlers: createStepHandlers(workspace, runner, git, codingEngine),
    verificationTargets,
  });

  logger.debug('Executor service initialized', {
    maxRepairAttempts: config.maxRepairAttempts,
    temperature: config.temperature,
    verificationTargets: verificationTargets.length,
    autoApprove: config.autoApprove ?? false,
  });

  // Auto-approve function for autonomous execution
  const executePlan = async (
    plan: ExecutionPlan,
    options?: { signal?: AbortSignal },
  ): Promise<import('@devforge/execution').ExecutionReport> => {
    logger.debug('Executing plan', { goal: plan.goal, steps: plan.steps.length });
    
    const executeOptions = { signal: options?.signal ?? signal };
    if (config.autoApprove) {
      // Create a copy of the plan with requiresConfirmation disabled for autonomous execution
      const sanitizedPlan: ExecutionPlan = {
        ...plan,
        requiresConfirmation: false,
        steps: plan.steps.map((step) => ({ ...step, requiresConfirmation: false })),
      };
      return executor.execute(sanitizedPlan, executeOptions);
    }
    
    return executor.execute(plan, executeOptions);
  };

  return {
    executor,
    codingEngine,
    workspace,
    runner,
    git,
    codingModel,
    reasoningModel,
    executePlan,
    async fix(goal: string, context?: readonly string[]) {
      logger.debug('Running fix via coding engine', { goal: goal.slice(0, 100) });
      return codingEngine.run({ goal, context: context ?? [] });
    },
  };
}