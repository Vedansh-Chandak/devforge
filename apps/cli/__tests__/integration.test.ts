/**
 * DF-017.2 — CLI Integration Tests.
 *
 * Exercises the full CLI orchestration through its command handlers and real
 * service wiring, using dependency injection with fake (scripted) model
 * providers. No real LLM is ever contacted and nothing touches the network.
 *
 * Coverage targets:
 *   Brain invoked · Planner invoked · Executor invoked · ModelProvider invoked
 *   · Workspace ops · CommandRunner · GitService · Progress/events · JSON output
 *   · Human output · Error mapping · Confirmation · Failed verification ·
 *   Successful repair · Cancellation · Dry-run (plan-only) mode.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCommandRunner, createExecutor, ExecutorCancellationError, ExecutorVerificationError } from '@devforge/execution';
import { EXECUTION_EVENT_TYPES } from '@devforge/execution';
import type { ExecutionReport, GitDiff } from '@devforge/execution';
import type { ExecutionPlan } from '@devforge/planner';

import { discoverRepository } from '../src/services/workspace.js';
import { createPlannerService } from '../src/services/planner.js';
import { createExecutorService } from '../src/services/executor.js';
import { createRouterFromConfig } from '../src/services/brain.js';
import { createBrainService } from '../src/services/brain.js';
import { ConfigError, formatError, CliError } from '../src/errors.js';
import { renderExecutionReport } from '../src/services/output.js';

import { handleAsk } from '../src/commands/ask.js';
import { handlePlan } from '../src/commands/plan.js';
import { handleRun } from '../src/commands/run.js';
import { handleReview } from '../src/commands/review.js';
import { handleFix } from '../src/commands/fix.js';
import { handleExplain } from '../src/commands/explain.js';
import { handleStatus } from '../src/commands/status.js';
import { handleDoctor } from '../src/commands/doctor.js';
import { handleConfig } from '../src/commands/config.js';
import type { ConfigPayload } from '../src/commands/config.js';

import { buildPlan, createTempMockRepo, ScriptedProvider } from './helpers.js';
import type { ExecutionServices, ExecutionContext, LightCliContext } from '../src/services/session.js';

// Silence the shared pino logger used by brain/runtime so it never writes
// structured logs to stdout during the real-service wiring tests.
vi.mock('@devforge/logger', () => ({
  logger: {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
  },
}));

beforeEach(() => {
  process.env.DF_DISABLE_TELEMETRY = '1';
});

function makeConfig() {
  return {
    provider: 'fake' as const,
    logLevel: 'info' as const,
    temperature: 0.2,
  };
}

/** A role-mapped fake config with distinct per-role model ids (DF-027). */
function makeRoleConfig() {
  return {
    provider: 'fake' as const,
    logLevel: 'info' as const,
    temperature: 0.2,
    roleModels: {
      reasoning: 'openai/gpt-oss-120b:free',
      coding: 'cohere/north-mini-code:free',
      fast: 'openai/gpt-oss-20b:free',
    },
  };
}

/** Build a fully-typed fake services bundle with recording spies. */
function stubServices() {
  const brain = {
    brain: {} as never,
    runtime: {} as never,
    ask: vi.fn().mockResolvedValue({ status: 'answered', answer: 'Fake brain answer' }),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
  const planner = {
    planner: {} as never,
    plan: vi.fn().mockResolvedValue({ ok: true, plan: buildPlan() }),
  };
  const executor = {
    executor: {} as never,
    codingEngine: { run: vi.fn() },
    workspace: { list: vi.fn().mockResolvedValue([]), readFile: vi.fn() },
    runner: { run: vi.fn() },
    git: { diff: vi.fn(), changedFiles: vi.fn() },
    codingModel: {} as never,
    reasoningModel: {} as never,
    executePlan: vi.fn(),
    fix: vi.fn(),
  };
  const services = {
    workspace: {} as never,
    logger: {} as never,
    output: {} as never,
    progress: {} as never,
    brain: brain as unknown as ExecutionServices['brain'],
    planner: planner as unknown as ExecutionServices['planner'],
    executor: executor as unknown as ExecutionServices['executor'],
  };
  return { services, brain, planner, executor };
}

function executionContext(services: ExecutionServices, root: string, json = false): ExecutionContext {
  return {
    cwd: root,
    repository: {
      root,
      workspaceRoot: root,
      gitRoot: null,
      hasGit: false,
      branch: null,
      packageManager: 'pnpm',
      hasPackageJson: true,
      packageJsonName: 'mock-repository',
      isMonorepo: false,
      hasWorkspaces: false,
      tsconfig: true,
      testFramework: 'vitest',
      buildTool: 'tsc',
      buildCommand: 'pnpm run build',
      testCommand: 'pnpm run test',
      lintCommand: 'pnpm run lint',
      isPnpmWorkspace: true,
      isNpmYarnWorkspace: false,
    },
    config: makeConfig() as never,
    options: { json, debug: false, autoApprove: false },
    services,
  };
}

function completedReport(overrides: Partial<ExecutionReport> = {}): ExecutionReport {
  return {
    planId: 'plan-1',
    goal: 'Test plan',
    summary: 'Test plan — done',
    status: 'COMPLETED',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 10,
    steps: [],
    rollback: [],
    eventCount: 0,
    ...overrides,
  };
}

// ─── Real service wiring (DI + scripted fake provider) ─────────────────────

describe('service wiring with a scripted provider', () => {
  it('planner is invoked and produces a valid plan from the fake provider', async () => {
    const provider = new ScriptedProvider();
    const planner = createPlannerService(provider, 0.2);

    const result = await planner.plan('Implement a new service');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.steps.length).toBeGreaterThanOrEqual(1);
    expect(provider.callCount).toBeGreaterThan(0);
  });

  it('brain answers using the fake provider (ModelProvider invoked)', async () => {
    const root = await createTempMockRepo();
    const brain = await createBrainService(makeConfig() as never, root);
    try {
      const answer = await brain.ask('Explain the architecture');
      expect(answer.status).toBe('answered');
    } finally {
      await brain.dispose();
    }
  });

  it('executor runs a plan and emits progress/execution events in a temp git repo', async () => {
    const root = await createTempMockRepo({ git: true });
    const provider = new ScriptedProvider();
    const executor = await createExecutorService(provider, root, {
      maxRepairAttempts: 2,
      temperature: 0.2,
      verificationTargets: [],
    });

    const events: string[] = [];
    executor.executor.onEvent((e) => events.push(e.type));

    const report = await executor.executePlan(buildPlan());
    expect(report.status).toBe('COMPLETED');
    expect(report.steps.length).toBe(1);
    expect(events).toContain(EXECUTION_EVENT_TYPES.EXECUTION_STARTED);
    expect(events).toContain(EXECUTION_EVENT_TYPES.EXECUTION_COMPLETED);

    const diff = await executor.git.diff();
    expect(diff).toBeDefined();
    const files = await executor.workspace.list('');
    expect(files.length).toBeGreaterThan(0);
  });

  it('command runner executes a stock command scoped to the temp repo', async () => {
    const root = await createTempMockRepo({ git: true });
    const runner = createCommandRunner({ workspaceRoot: root } as never);
    const res = await runner.run({ command: 'git', args: ['status', '--porcelain'], cwd: root });
    expect(res.success).toBe(true);
  });

  it('repository discovery understands the mock repository', async () => {
    const root = await createTempMockRepo({ git: true });
    const repo = await discoverRepository(root);
    expect(repo.root).toBe(root);
    expect(repo.hasGit).toBe(true);
    expect(repo.tsconfig).toBe(true);
    expect(repo.packageManager).toBe('pnpm');
    expect(repo.testFramework).toBe('vitest');
    expect(repo.hasPackageJson).toBe(true);
  });
});

// ─── DF-027 role routing at the service-wiring boundary ─────────────────────

describe('role routing through the shared ModelRouter (DF-027)', () => {
  it('creates a single router with distinct providers for every role', () => {
    const router = createRouterFromConfig(makeRoleConfig() as never);
    expect(router.list()).toEqual(['reasoning', 'coding', 'fast']);
    const reasoning = router.resolve('reasoning');
    const coding = router.resolve('coding');
    expect(reasoning.config.model).toBe('openai/gpt-oss-120b:free');
    expect(coding.config.model).toBe('cohere/north-mini-code:free');
    expect(reasoning.provider).not.toBe(coding.provider);
  });

  it('routes the executor coding model to the CODING role and reasoning model to REASONING', async () => {
    const root = await createTempMockRepo();
    const router = createRouterFromConfig(makeRoleConfig() as never);

    const executor = await createExecutorService(router, root, {
      maxRepairAttempts: 2,
      temperature: 0.2,
      verificationTargets: [],
    });

    const codingProvider = executor.codingModel.provider;
    const reasoningProvider = executor.reasoningModel.provider;
    expect(codingProvider).toBe(router.select('coding'));
    expect(reasoningProvider).toBe(router.select('reasoning'));
    expect(codingProvider).not.toBe(reasoningProvider);
    expect(executor.codingModel.name).toBe('fake-provider-coding');
    expect(executor.reasoningModel.name).toBe('fake-provider-reasoning');
  });

  it('planner routes to the reasoning role only when a router is supplied', async () => {
    const router = createRouterFromConfig(makeRoleConfig() as never);
    const planner = createPlannerService(router, 0.2);

    const result = await planner.plan('Implement a new service');
    // The reasoning role's fake provider serves non-plan text; the output fails
    // plan validation. INVALID_PLAN_OUTPUT (not the deterministic fallback)
    // proves the model-backed path exercised the reasoning role.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_PLAN_OUTPUT');
  });

  it('routes the brain to the reasoning role via the shared router', async () => {
    const root = await createTempMockRepo();
    const router = createRouterFromConfig(makeRoleConfig() as never);
    const brain = await createBrainService(makeRoleConfig() as never, root, undefined, {
      router,
    });
    try {
      const answer = await brain.ask('Explain the architecture');
      // Fake provider serves a scripted answer; assertions on routing identity:
      expect(router.select('reasoning').id).toBe('fake-provider');
      expect(router.select('fast').id).toBe('fake-provider');
      expect(answer.status).toBe('answered');
    } finally {
      await brain.dispose();
    }
  });

  it('never degrades a real provider to fake when a role is unconfigured', () => {
    const router = createRouterFromConfig({
      provider: 'openai-compatible' as const,
      model: 'openai/gpt-oss-120b:free',
      baseUrl: 'https://openrouter.ai/api/v1',
      temperature: 0.2,
      logLevel: 'info' as const,
    });
    // Faking is disabled for real provider configs; a role without an explicit
    // override resolves through the default config (a real provider), never a
    // FakeModelProvider.
    const reasoning = router.resolve('reasoning');
    expect(reasoning.source).not.toBe('fake');
    expect(router.select('fast').id).toBe('openai-compatible');
    expect(router.select('fast')).not.toBe(router.select('reasoning'));
  });
});

// ─── Command handler orchestration ─────────────────────────────────────────

describe('command handlers orchestrate services', () => {
  it('ask runs Brain → Planner → Executor and emits human output', async () => {
    const root = await createTempMockRepo();
    const { services, brain, planner, executor } = stubServices();
    executor.executePlan.mockResolvedValue(completedReport());

    const out = (await handleAsk(executionContext(services, root), 'Build a feature')) as string;

    expect(brain.ask).toHaveBeenCalledWith('Build a feature', { signal: undefined });
    expect(planner.plan).toHaveBeenCalledWith('Build a feature', { signal: undefined });
    expect(executor.executePlan).toHaveBeenCalled();
    expect(out).toContain('Fake brain answer');
  });

  it('ask returns a JSON-shaped report when --json is set', async () => {
    const root = await createTempMockRepo();
    const { services, executor } = stubServices();
    executor.executePlan.mockResolvedValue(completedReport({ status: 'FAILED' }));

    const result = (await handleAsk(executionContext(services, root, true), 'Build a feature')) as object;
    const json = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
    expect(json['status']).toBe('FAILED');
  });

  it('plan is a dry-run: the executor is never invoked', async () => {
    const root = await createTempMockRepo();
    const { services, brain, planner, executor } = stubServices();

    const out = (await handlePlan(executionContext(services, root), 'Refactor the module')) as string;

    expect(brain.ask).toHaveBeenCalled();
    expect(planner.plan).toHaveBeenCalledWith('Refactor the module', { signal: undefined });
    expect(executor.executePlan).not.toHaveBeenCalled();
    expect(out).toContain('Test plan');
  });

  it('run invokes Planner then Executor and renders a report', async () => {
    const root = await createTempMockRepo();
    const { services, planner, executor } = stubServices();
    executor.executePlan.mockResolvedValue(completedReport());

    const out = (await handleRun(executionContext(services, root), 'Ship it')) as string;

    expect(planner.plan).toHaveBeenCalledWith('Ship it', { signal: undefined });
    expect(executor.executePlan).toHaveBeenCalled();
    expect(out).toContain('COMPLETED');
  });

  it('run --json returns a JSON report', async () => {
    const root = await createTempMockRepo();
    const { services, executor } = stubServices();
    executor.executePlan.mockResolvedValue(completedReport());

    const result = (await handleRun(executionContext(services, root, true), 'Ship it')) as object;
    expect((result as { status?: string }).status).toBe('COMPLETED');
  });

  it('review invokes GitService and the coding engine', async () => {
    const root = await createTempMockRepo();
    const { services, executor } = stubServices();
    const diff: GitDiff = {
      empty: false,
      text: 'diff --git a/src/index.ts b/src/index.ts',
      files: [
        {
          oldPath: 'src/index.ts',
          newPath: 'src/index.ts',
          status: 'modified',
          isBinary: false,
          headerLines: ['diff --git a/src/index.ts b/src/index.ts', 'index 000..111', '--- a/src/index.ts', '+++ b/src/index.ts'],
          hunks: [
            {
              header: '@@ -1,3 +1,4 @@',
              oldStart: 1,
              oldLines: 3,
              newStart: 1,
              newLines: 4,
              lines: [
                { kind: 'context', content: 'export function double(value: number): number {' },
                { kind: 'addition', content: 'console.log("hello");' },
              ],
            },
          ],
        },
      ],
    };
    executor.git.diff.mockResolvedValue(diff);
    executor.git.changedFiles.mockResolvedValue(['src/index.ts']);
    executor.codingEngine.run.mockResolvedValue({
      outcome: 'SUCCESS',
      transactions: [{ order: 1, kind: 'initial', patchesApplied: 0, status: 'COMMITTED' }],
      patchesGenerated: 0,
      patchCalls: 1,
      repairAttempts: 0,
      modelCalls: 1,
      verificationRuns: 0,
      diagnostics: [],
      rollbackCount: 0,
      events: [],
      executionTimeMs: 5,
    });

    const out = (await handleReview(executionContext(services, root))) as string;

    expect(executor.git.diff).toHaveBeenCalled();
    expect(executor.git.changedFiles).toHaveBeenCalled();
    expect(executor.codingEngine.run).toHaveBeenCalled();
    expect(out).toContain('Code Review');
  });

  it('review reports no pending changes when the tree is clean', async () => {
    const root = await createTempMockRepo();
    const { services, executor } = stubServices();
    executor.git.changedFiles.mockResolvedValue([]);

    const out = (await handleReview(executionContext(services, root))) as string;
    expect(out).toContain('No pending changes');
    expect(executor.codingEngine.run).not.toHaveBeenCalled();
  });

  it('fix invokes the coding engine and renders a repair report', async () => {
    const root = await createTempMockRepo();
    const { services, executor } = stubServices();
    executor.fix.mockResolvedValue({
      outcome: 'SUCCESS',
      transactions: [],
      patchesGenerated: 2,
      patchCalls: 1,
      repairAttempts: 1,
      modelCalls: 2,
      verificationRuns: 2,
      diagnostics: [],
      rollbackCount: 0,
      events: [],
      executionTimeMs: 120,
    });

    const out = (await handleFix(executionContext(services, root), 'Fix the bug')) as string;

    expect(executor.fix).toHaveBeenCalledWith('Fix the bug');
    expect(out).toContain('Fix outcome');
    expect(out).toContain('Repair attempts');
  });

  it('fix --json returns a JSON coding report', async () => {
    const root = await createTempMockRepo();
    const { services, executor } = stubServices();
    executor.fix.mockResolvedValue({
      outcome: 'SUCCESS',
      transactions: [],
      patchesGenerated: 2,
      patchCalls: 1,
      repairAttempts: 1,
      modelCalls: 2,
      verificationRuns: 2,
      diagnostics: [],
      rollbackCount: 0,
      events: [],
      executionTimeMs: 120,
    });

    const result = (await handleFix(executionContext(services, root, true), 'Fix the bug')) as object;
    expect((result as { patchesGenerated?: number }).patchesGenerated).toBe(2);
  });

  it('fix --debug still runs the coding engine (no early return)', async () => {
    const root = await createTempMockRepo();
    const { services, executor } = stubServices();
    executor.fix.mockResolvedValue({
      outcome: 'SUCCESS',
      transactions: [],
      patchesGenerated: 3,
      patchCalls: 1,
      repairAttempts: 0,
      modelCalls: 1,
      verificationRuns: 1,
      diagnostics: [],
      rollbackCount: 0,
      events: [],
      executionTimeMs: 90,
    });

    const ctx = executionContext(services, root, false) as { options: { debug: boolean } };
    ctx.options.debug = true;
    const out = (await handleFix(ctx as never, 'Fix the bug')) as string;

    expect(executor.fix).toHaveBeenCalledWith('Fix the bug');
    expect(out).toContain('Fix outcome');
    expect(out).toContain('Patches: 3');
  });

  it('explain builds repository context and produces a markdown explanation', async () => {
    const root = await createTempMockRepo();
    const { services } = stubServices();

    const out = (await handleExplain(executionContext(services, root), 'greeting')) as string;

    expect(out).toContain('# Explanation: greeting');
    expect(out).toContain('Repository:');
  });

  it('status renders workspace + provider key/values', async () => {
    const root = await createTempMockRepo();
    const { services } = stubServices();
    const ctx = executionContext(services, root) as unknown as LightCliContext;
    const out = (await handleStatus(ctx)) as string;

    expect(out).toContain('DevForge Status');
    expect(out).toContain('Workspace');
    expect(out).toContain('Provider');
  });

  it('config renders resolved settings and sources', async () => {
    const root = await createTempMockRepo();
    const { services } = stubServices();
    const ctx = executionContext(services, root) as unknown as LightCliContext;
    const out = (await handleConfig(ctx)) as string;

    expect(out).toContain('DevForge Config');
    expect(out).toContain('Provider');
    expect(out).toContain('.devforge.json');
    // DF-027: resolved role mapping is surfaced, one row per role.
    expect(out).toContain('Resolved model routes');
    expect(out).toContain('Route · reasoning');
    expect(out).toContain('Route · coding');
    expect(out).toContain('Route · fast');
  });

  it('config --json surfaces redacted role routes (no apiKey leak)', async () => {
    const root = await createTempMockRepo();
    const { services } = stubServices();
    const ctx = executionContext(services, root, true) as unknown as LightCliContext;
    ctx.config = {
      provider: 'openai-compatible',
      model: 'openai/gpt-oss-120b:free',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-top-secret-value',
      temperature: 0.2,
      logLevel: 'info',
      roleModels: {
        coding: 'cohere/north-mini-code:free',
        fast: 'openai/gpt-oss-20b:free',
      },
    } as never;

    const payload = (await handleConfig(ctx)) as ConfigPayload;
    expect(payload.apiKey).toBe('***');
    expect(payload.routes).toBeDefined();
    expect(payload.routes!.length).toBe(3);
    const coding = payload.routes!.find((r) => r.role === 'coding');
    expect(coding?.model).toBe('cohere/north-mini-code:free');
    expect(coding?.source).toBe('explicit');
    for (const route of payload.routes!) {
      expect(route.apiKey).not.toBe('sk-top-secret-value');
    }
    // The default route (reasoning) inherits the default provider config.
    const reasoning = payload.routes!.find((r) => r.role === 'reasoning');
    expect(reasoning?.source).toBe('default');
  });

  it('doctor renders environment health checks', async () => {
    const root = await createTempMockRepo();
    const { services } = stubServices();
    const ctx = executionContext(services, root) as unknown as LightCliContext;
    const servicesAny = services as unknown as { environment: readonly { name: string; ok: boolean; detail: string; fix?: string }[] };
    servicesAny.environment = [
      { name: 'workspace', ok: true, detail: 'detected git repo' },
      { name: 'provider', ok: false, detail: 'no credentials', fix: 'Set DEVFORGE_MODEL_API_KEY' },
    ];

    const out = (await handleDoctor(ctx)) as string;
    expect(out).toContain('workspace');
    expect(out).toContain('provider');
    expect(out).toContain('Set DEVFORGE_MODEL_API_KEY');
  });

  it('doctor includes the model-routes role routing check', async () => {
    const root = await createTempMockRepo();
    const { services } = stubServices();
    const ctx = executionContext(services, root) as unknown as LightCliContext;
    const servicesAny = services as unknown as { environment: readonly { name: string; ok: boolean; detail: string; fix?: string }[] };
    servicesAny.environment = [
      { name: 'workspace', ok: true, detail: 'detected git repo' },
      { name: 'model-routes', ok: true, detail: 'roles → providers: reasoning → fake-provider, coding → fake-provider, fast → fake-provider' },
    ];

    const out = (await handleDoctor(ctx)) as string;
    expect(out).toContain('model-routes');
    expect(out).toContain('reasoning → fake-provider');
  });
});

// ─── Executor engine behaviors (confirmation, cancellation, verification) ───

describe('real executor engine behaviors', () => {
  it('confirmation flow: pauses on a confirmation step then resumes to completion', async () => {
    const root = await createTempMockRepo();
    const plan = buildPlan();
    const confirmed: ExecutionPlan = {
      ...plan,
      steps: [{ ...plan.steps[0]!, requiresConfirmation: true }],
    };

    const executor = createExecutor({
      workspaceRoot: root,
      verificationTargets: [],
      handlers: { SEARCH: async () => ({ ok: true, summary: 'searched' }) },
    });

    const events: string[] = [];
    executor.onEvent((e) => events.push(e.type));

    const pending = executor.execute(confirmed);
    await vi.waitFor(() => {
      expect(executor.status).toBe('WAITING_CONFIRMATION');
    });
    expect(events).toContain(EXECUTION_EVENT_TYPES.EXECUTION_PAUSED);

    executor.resume();
    const report = await pending;
    expect(report.status).toBe('COMPLETED');
  });

  it('cancellation: an aborted run rejects with ExecutorCancellationError', async () => {
    const root = await createTempMockRepo();
    const controller = new AbortController();
    controller.abort('user cancelled');

    const executor = createExecutor({
      workspaceRoot: root,
      verificationTargets: [],
      handlers: { SEARCH: async () => ({ ok: true, summary: 'searched' }) },
    });

    await expect(executor.execute(buildPlan(), { signal: controller.signal })).rejects.toBeInstanceOf(
      ExecutorCancellationError,
    );
  });

  it('failed verification: a failing verification target rejects with ExecutorVerificationError', async () => {
    const root = await createTempMockRepo();
    const plan = buildPlan();
    const verifyingPlan: ExecutionPlan = {
      ...plan,
      steps: [
        { ...plan.steps[0]! },
        { ...plan.steps[0]!, id: 'step-2', type: 'VERIFY', title: 'Verify the result', dependsOn: ['step-1'] },
      ],
    };

    const executor = createExecutor({
      workspaceRoot: root,
      verificationTargets: [
        { id: 'must-fail', command: 'node', args: ['-e', 'process.exit(1)'], cwd: root, timeoutMs: 10_000, maxOutputBytes: 1024 },
      ],
      handlers: { SEARCH: async () => ({ ok: true, summary: 'searched' }) },
    });

    await expect(executor.execute(verifyingPlan)).rejects.toBeInstanceOf(ExecutorVerificationError);
  });

  it('verification passes when targets succeed', async () => {
    const root = await createTempMockRepo();
    const plan = buildPlan();
    const verifyingPlan: ExecutionPlan = {
      ...plan,
      steps: [
        { ...plan.steps[0]! },
        { ...plan.steps[0]!, id: 'step-2', type: 'VERIFY', title: 'Verify the result', dependsOn: ['step-1'] },
      ],
    };

    const executor = createExecutor({
      workspaceRoot: root,
      verificationTargets: [
        { id: 'must-pass', command: 'node', args: ['-e', 'process.exit(0)'], cwd: root, timeoutMs: 10_000, maxOutputBytes: 1024 },
      ],
      handlers: { SEARCH: async () => ({ ok: true, summary: 'searched' }) },
    });

    const report = await executor.execute(verifyingPlan);
    expect(report.status).toBe('COMPLETED');
  });

  it('renders a report for a successful repair cycle', async () => {
    const report = completedReport({ repairAttempts: 1, patchesGenerated: 2 });
    const rendered = renderExecutionReport(report);
    expect(rendered).toContain('COMPLETED');
  });
});

// ─── Error mapping ─────────────────────────────────────────────────────────

describe('error mapping', () => {
  it('formats a CliError with a stable code', () => {
    const err = new CliError('boom', 'PLANNER_ERROR');
    expect(formatError(err, false)).toContain('[PLANNER_ERROR]');
    expect(formatError(err, false)).toContain('boom');
  });

  it('ConfigError maps to exit code 2', () => {
    const err = new ConfigError('bad config');
    expect(err.exitCode).toBe(2);
    expect(err.code).toBe('CONFIG_ERROR');
  });

  it('formats unknown errors as UNKNOWN', () => {
    expect(formatError(new Error('generic'), false)).toContain('[UNKNOWN]');
    expect(formatError('string-error', false)).toContain('[UNKNOWN]');
  });

  it('debug mode appends a stack trace', () => {
    const err = new Error('trace me');
    expect(formatError(err, true)).toContain('[UNKNOWN]');
    expect(formatError(err, true)).toContain('Error: trace me');
  });
});

// ─── Progress events via real executor events ──────────────────────────────

describe('execution progress events', () => {
  it('emits a deterministic event stream during execution', async () => {
    const root = await createTempMockRepo();
    const executor = createExecutor({
      workspaceRoot: root,
      verificationTargets: [],
      handlers: { SEARCH: async () => ({ ok: true, summary: 'searched' }) },
    });

    const types: string[] = [];
    executor.onEvent((e) => types.push(e.type));

    await executor.execute(buildPlan());

    expect(types[0]).toBe(EXECUTION_EVENT_TYPES.EXECUTION_STARTED);
    expect(types).toContain(EXECUTION_EVENT_TYPES.PLAN_VALIDATED);
    expect(types).toContain(EXECUTION_EVENT_TYPES.STEP_STARTED);
    expect(types).toContain(EXECUTION_EVENT_TYPES.STEP_COMPLETED);
    expect(types).toContain(EXECUTION_EVENT_TYPES.EXECUTION_COMPLETED);
  });
});
