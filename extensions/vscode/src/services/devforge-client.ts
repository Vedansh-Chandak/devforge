/**
 * @devforge/vscode-extension — DevForge Client (DF-020).
 *
 * The single integration point between the extension host and the DevForge
 * engine. The client never re-implements Brain/Planner/Executor/Workspace or
 * CLI logic — it delegates to the `@devforge/cli` public API (context builders,
 * command handlers, renderers) through a {@link CliAdapter}. Tests inject a
 * fake adapter for fully deterministic "mocked DevForge integration".
 *
 * Architecture:  VS Code → Extension Host → DevForge Client → CLI / API → Brain
 */

import type {
  CliOptions,
  ExecutionContext,
  LightCliContext,
  RepositoryContext,
} from '@devforge/cli';
import type { CodingReport, ExecutionReport, GitDiff } from '@devforge/execution';
import type { PlanResult } from '@devforge/planner';
import {
  CommandResult,
  DevForgeCommand,
  ExtensionConfiguration,
  DEVFORGE_COMMANDS,
  isHeavyCommand,
  planResultToQueryResult,
  PlanQueryResult,
} from '../types.js';
import { stripAnsi } from '../utils.js';
import { DevForgeClientError } from '../errors.js';

import type { EnvOverrides } from './configuration.js';

/** Environment variable names the extension can forward to the engine. */
export { ENV_KEYS } from './configuration.js';
export type { EnvOverrides } from './configuration.js';

/** Shape of an error thrown by the CLI layer (duck-typed from CliError). */
export interface CliLikeError {
  readonly code?: string;
  readonly message: string;
}

/** Health check emitted by the doctor flow. */
export interface HealthCheckLike {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly fix?: string;
}

/**
 * Adapter over the `@devforge/cli` public API. Kept behind an interface so the
 * client is testable without the real engine.
 */
export interface CliAdapter {
  createLightContext(cwd: string, options: CliOptions, env?: EnvOverrides): Promise<LightCliContext>;
  createExecutionContext(cwd: string, options: CliOptions, env?: EnvOverrides): Promise<ExecutionContext>;
  handleAsk(ctx: ExecutionContext, question: string): Promise<string | object>;
  handlePlan(ctx: ExecutionContext, goal: string): Promise<string | object>;
  handleFix(ctx: ExecutionContext, goal: string): Promise<string | object>;
  handleReview(ctx: ExecutionContext): Promise<string | object>;
  handleRun(ctx: ExecutionContext, goal: string): Promise<string | object>;
  handleExplain(ctx: ExecutionContext, topic: string): Promise<string | object>;
  handleStatus(ctx: LightCliContext): Promise<string | object>;
  handleDoctor(ctx: LightCliContext): Promise<string | object>;
  runHealthChecks(ctx: LightCliContext): Promise<{ readonly checks: readonly HealthCheckLike[]; readonly allOk: boolean }>;
  renderPlanResult(result: PlanResult): Promise<string>;
  renderCodingReport(report: CodingReport): Promise<string>;
  renderExecutionReport(report: ExecutionReport): Promise<string>;
}

/** Client construction options. */
export interface DevForgeClientOptions {
  /** Adapter used to reach the CLI/engine. */
  readonly adapter: CliAdapter;
  /** Workspace root the client operates on. */
  readonly workspaceRoot: string;
  /** Resolves the current extension configuration for each request. */
  readonly getConfig: () => ExtensionConfiguration;
  /** Resolves CLI options for each request. */
  readonly getCliOptions?: () => CliOptions;
  /** Resolves environment overrides for each request. */
  readonly getEnvOverrides?: () => EnvOverrides;
  /** Optional progress callback (command id, started). */
  readonly onProgress?: (command: DevForgeCommand, state: 'start' | 'end') => void;
}

/**
 * The DevForge client. Lazily builds the light or full execution context,
 * serializes context creation (the CLI config loader reads process.env), and
 * executes commands through the CLI handlers.
 */
export class DevForgeClient {
  readonly workspaceRoot: string;
  private readonly adapter: CliAdapter;
  private readonly getConfig: () => ExtensionConfiguration;
  private readonly getCliOptions: () => CliOptions;
  private readonly getEnvOverrides: () => EnvOverrides;
  private readonly onProgress: (command: DevForgeCommand, state: 'start' | 'end') => void;

  private lightContext: LightCliContext | null = null;
  private executionContext: ExecutionContext | null = null;
  private creationChain: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(options: DevForgeClientOptions) {
    this.adapter = options.adapter;
    this.workspaceRoot = options.workspaceRoot;
    this.getConfig = options.getConfig;
    this.getCliOptions = options.getCliOptions ?? (() => defaultCliOptions());
    this.getEnvOverrides = options.getEnvOverrides ?? (() => ({}));
    this.onProgress = options.onProgress ?? (() => undefined);
  }

  /** Whether the client has been disposed. */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Read the current configuration. */
  config(): ExtensionConfiguration {
    return this.getConfig();
  }

  /**
   * Execute a DevForge command and return a uniform {@link CommandResult}.
   * Never throws for command failures — they surface as `ok: false`.
   */
  run(command: DevForgeCommand, ...args: string[]): Promise<CommandResult> {
    this.assertAlive();
    if (!DEVFORGE_COMMANDS.includes(command)) {
      return Promise.resolve(this.failure(command, args, { code: 'UNKNOWN_COMMAND', message: `Unknown command: ${command}` }, 0));
    }
    return this.creationChain.then(async () => {
      const startedAt = Date.now();
      this.onProgress(command, 'start');
      try {
        const result = await this.execute(command, args);
        return { ...result, durationMs: Date.now() - startedAt };
      } catch (error) {
        return this.failure(command, args, normalizeError(error), Date.now() - startedAt);
      } finally {
        this.onProgress(command, 'end');
      }
    });
  }

  /** Get the current repository context (works for any session tier). */
  async repositoryContext(): Promise<RepositoryContext> {
    const ctx = await this.getLightContext();
    return ctx.repository;
  }

  /** Get the working-tree git diff (requires the full execution context). */
  async diff(): Promise<GitDiff> {
    const ctx = await this.getExecutionContext();
    return ctx.services.executor.git.diff();
  }

  /** Get the list of changed files (requires the full execution context). */
  async changedFiles(): Promise<readonly string[]> {
    const ctx = await this.getExecutionContext();
    return ctx.services.executor.git.changedFiles();
  }

  /**
   * Reject (discard) pending engine changes for the given files by restoring
   * them to HEAD through the engine's git service.
   */
  async rejectDiff(files: readonly string[]): Promise<void> {
    const ctx = await this.getExecutionContext();
    await ctx.services.executor.git.restore(files);
  }

  /** Plan only, returning a structured result for the plan tree view. */
  async planStructured(goal: string): Promise<PlanQueryResult> {
    const ctx = await this.getExecutionContext();
    const result = await ctx.services.planner.plan(goal);
    return planResultToQueryResult(result);
  }

  /** Build the lightweight context (config/discovery/environment only). */
  private async getLightContext(): Promise<LightCliContext> {
    if (!this.lightContext) {
      this.lightContext = await this.serialize(() =>
        this.adapter.createLightContext(this.workspaceRoot, this.getCliOptions(), this.getEnvOverrides()),
      );
    }
    return this.lightContext;
  }

  /** Build the full execution context (brain/planner/executor/workspace). */
  private async getExecutionContext(): Promise<ExecutionContext> {
    if (this.executionContext) return this.executionContext;
    this.executionContext = await this.serialize(() =>
      this.adapter.createExecutionContext(this.workspaceRoot, this.getCliOptions(), this.getEnvOverrides()),
    );
    return this.executionContext;
  }

  /** Serialize context creation so env overrides never interleave. */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.creationChain.then(fn);
    this.creationChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Execute a single command against the appropriate context. */
  private async execute(command: DevForgeCommand, args: readonly string[]): Promise<CommandResult> {
    const startedAt = Date.now();
    if (isHeavyCommand(command)) {
      const ctx = await this.getExecutionContext();
      return this.runHeavy(ctx, command, args);
    }
    const ctx = await this.getLightContext();
    return this.runLight(ctx, command);
  }

  private async runHeavy(ctx: ExecutionContext, command: DevForgeCommand, args: readonly string[]): Promise<CommandResult> {
    const config = this.getConfig();
    switch (command) {
      case 'ask': {
        const report = (await this.adapter.handleAsk(ctx, arg(args, 0))) as ExecutionReport;
        return this.success(command, args, stripAnsi(await this.adapter.renderExecutionReport(report)), report);
      }
      case 'plan': {
        const planResult = await ctx.services.planner.plan(arg(args, 0));
        return this.success(command, args, stripAnsi(await this.adapter.renderPlanResult(planResult)), planResult);
      }
      case 'fix': {
        const report = (await this.adapter.handleFix(ctx, arg(args, 0))) as CodingReport;
        return this.success(command, args, stripAnsi(await this.adapter.renderCodingReport(report)), report);
      }
      case 'review': {
        const [diff, changedFiles] = await Promise.all([
          ctx.services.executor.git.diff(),
          ctx.services.executor.git.changedFiles(),
        ]);
        const text = stripAnsi(String(await this.adapter.handleReview(ctx)));
        return this.success(command, args, text, { diff, changedFiles });
      }
      case 'run': {
        const report = (await this.adapter.handleRun(ctx, arg(args, 0))) as ExecutionReport;
        return this.success(command, args, stripAnsi(await this.adapter.renderExecutionReport(report)), report);
      }
      case 'explain': {
        const text = stripAnsi(String(await this.adapter.handleExplain(ctx, arg(args, 0))));
        return this.success(command, args, text, {});
      }
      default:
        return this.failure(command, args, { code: 'UNSUPPORTED', message: `Command requires heavy context: ${command}` }, 0);
    }
  }

  private async runLight(ctx: LightCliContext, command: DevForgeCommand): Promise<CommandResult> {
    switch (command) {
      case 'status': {
        const text = stripAnsi(String(await this.adapter.handleStatus(ctx)));
        return this.success(command, [], text, ctx.repository);
      }
      case 'doctor': {
        const text = stripAnsi(String(await this.adapter.handleDoctor(ctx)));
        return this.success(command, [], text, await this.adapter.runHealthChecks(ctx));
      }
      default:
        return this.failure(command, [], { code: 'UNSUPPORTED', message: `Command requires light context: ${command}` }, 0);
    }
  }

  /** Dispose the underlying engine contexts (brain/runtime). */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    try {
      const brain = this.executionContext?.services.brain;
      if (brain && 'dispose' in brain) {
        await brain.dispose();
      }
    } catch {
      // best-effort disposal
    }
    this.executionContext = null;
    this.lightContext = null;
  }

  private success(command: DevForgeCommand, args: readonly string[], text: string, data: unknown): CommandResult {
    return { command, args, ok: true, text, data, durationMs: 0 };
  }

  private failure(command: DevForgeCommand, args: readonly string[], error: { code: string; message: string }, durationMs: number): CommandResult {
    return {
      command,
      args,
      ok: false,
      text: `**${command} failed**: ${error.message}`,
      data: null,
      durationMs,
      error,
    };
  }

  private assertAlive(): void {
    if (this.disposed) {
      throw new DevForgeClientError('The DevForge client has been disposed.');
    }
  }
}

/** Read a single string argument or throw a usage error. */
function arg(args: readonly string[], index: number): string {
  const value = args[index];
  if (value === undefined || value.trim().length === 0) {
    throw new DevForgeClientError(`Missing required argument at position ${index + 1}.`);
  }
  return value;
}

/** Normalize any thrown value into a { code, message } pair. */
function normalizeError(error: unknown): { code: string; message: string } {
  if (error && typeof error === 'object') {
    const e = error as CliLikeError;
    if (typeof e.message === 'string') {
      return { code: typeof e.code === 'string' ? e.code : 'UNKNOWN', message: e.message };
    }
  }
  if (error instanceof Error) return { code: 'UNKNOWN', message: error.message };
  return { code: 'UNKNOWN', message: String(error) };
}

/** Default CLI options for the client. */
function defaultCliOptions(): CliOptions {
  return { json: true, debug: false, autoApprove: false };
}

/**
 * Real adapter over the `@devforge/cli` public API. Applies extension-level
 * environment overrides around context creation so VS Code settings can
 * override disk configuration without modifying the CLI.
 */
export class RealCliAdapter implements CliAdapter {
  async createLightContext(cwd: string, options: CliOptions, env?: EnvOverrides): Promise<LightCliContext> {
    const { createLightContext } = await import('@devforge/cli');
    return withEnv(env ?? {}, () => createLightContext(cwd, options));
  }

  async createExecutionContext(cwd: string, options: CliOptions, env?: EnvOverrides): Promise<ExecutionContext> {
    const { createExecutionContext } = await import('@devforge/cli');
    return withEnv(env ?? {}, () => createExecutionContext(cwd, options));
  }

  async handleAsk(ctx: ExecutionContext, question: string): Promise<string | object> {
    const { handleAsk } = await import('@devforge/cli');
    return handleAsk(ctx, question);
  }

  async handlePlan(ctx: ExecutionContext, goal: string): Promise<string | object> {
    const { handlePlan } = await import('@devforge/cli');
    return handlePlan(ctx, goal);
  }

  async handleFix(ctx: ExecutionContext, goal: string): Promise<string | object> {
    const { handleFix } = await import('@devforge/cli');
    return handleFix(ctx, goal);
  }

  async handleReview(ctx: ExecutionContext): Promise<string | object> {
    const { handleReview } = await import('@devforge/cli');
    return handleReview(ctx);
  }

  async handleRun(ctx: ExecutionContext, goal: string): Promise<string | object> {
    const { handleRun } = await import('@devforge/cli');
    return handleRun(ctx, goal);
  }

  async handleExplain(ctx: ExecutionContext, topic: string): Promise<string | object> {
    const { handleExplain } = await import('@devforge/cli');
    return handleExplain(ctx, topic);
  }

  async handleStatus(ctx: LightCliContext): Promise<string | object> {
    const { handleStatus } = await import('@devforge/cli');
    return handleStatus(ctx);
  }

  async handleDoctor(ctx: LightCliContext): Promise<string | object> {
    const { handleDoctor } = await import('@devforge/cli');
    return handleDoctor(ctx);
  }

  async runHealthChecks(ctx: LightCliContext): Promise<{ checks: readonly HealthCheckLike[]; allOk: boolean }> {
    const { runHealthChecks } = await import('@devforge/cli');
    return runHealthChecks(ctx);
  }

  async renderPlanResult(result: PlanResult): Promise<string> {
    if (result.ok) {
      const { renderPlan } = await import('@devforge/cli');
      return renderPlan(result.plan, { useColor: false });
    }
    return `Planning failed: [${result.error.code}] ${result.error.message}`;
  }

  async renderCodingReport(report: CodingReport): Promise<string> {
    const { renderCodingReport } = await import('@devforge/cli');
    return renderCodingReport(report);
  }

  async renderExecutionReport(report: ExecutionReport): Promise<string> {
    const { renderExecutionReport } = await import('@devforge/cli');
    return renderExecutionReport(report);
  }
}

/** Temporarily set environment overrides while `fn` runs, restoring after. */
async function withEnv<T>(overrides: EnvOverrides, fn: () => Promise<T>): Promise<T> {
  const keys = Object.keys(overrides);
  const previous = new Map<string, string | undefined>();
  for (const key of keys) {
    previous.set(key, process.env[key]);
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key]!;
    }
  }
  try {
    return await fn();
  } finally {
    for (const key of keys) {
      const prev = previous.get(key);
      if (prev === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prev;
      }
    }
  }
}
