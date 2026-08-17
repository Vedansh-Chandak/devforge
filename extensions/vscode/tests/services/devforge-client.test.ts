import { describe, it, expect, vi } from 'vitest';
import { DevForgeClient, CliAdapter } from '../../src/services/devforge-client.js';
import { CommandResult, DevForgeCommand } from '../../src/types.js';
import { DevForgeClientError } from '../../src/errors.js';

const FAKE_CONFIG = {
  provider: 'fake' as const,
  model: '',
  baseUrl: '',
  apiKey: '',
  maxAttempts: 3,
  autoRepair: true,
  confirmRiskyChanges: true,
  autoApprove: false,
  logLevel: 'info' as const,
};

function makeAdapter(): CliAdapter {
  const ctx = {
    services: {
      executor: {
        git: {
          diff: vi.fn().mockResolvedValue({ empty: true, files: [] }),
          changedFiles: vi.fn().mockResolvedValue(['a.ts']),
          restore: vi.fn().mockResolvedValue(undefined),
        },
      },
      planner: {
        plan: vi.fn().mockResolvedValue({ ok: false, error: { code: 'NOPE', message: 'no plan', retryable: false } }),
      },
    },
  };
  return {
    createLightContext: vi.fn().mockResolvedValue({ repository: { root: '/ws' } }),
    createExecutionContext: vi.fn().mockResolvedValue(ctx),
    handleAsk: vi.fn().mockResolvedValue('asked'),
    handlePlan: vi.fn().mockResolvedValue('planned'),
    handleFix: vi.fn().mockResolvedValue('fixed'),
    handleReview: vi.fn().mockResolvedValue('reviewed'),
    handleRun: vi.fn().mockResolvedValue('ran'),
    handleExplain: vi.fn().mockResolvedValue('explained'),
    handleStatus: vi.fn().mockResolvedValue('status-ok'),
    handleDoctor: vi.fn().mockResolvedValue('doctor-ok'),
    runHealthChecks: vi.fn().mockResolvedValue({ checks: [], allOk: true }),
    renderPlanResult: vi.fn().mockResolvedValue('plan-render'),
    renderCodingReport: vi.fn().mockResolvedValue('coding-render'),
    renderExecutionReport: vi.fn().mockResolvedValue('execution-render'),
  } as unknown as CliAdapter;
}

function makeClient(adapter: CliAdapter = makeAdapter(), options: Record<string, unknown> = {}): DevForgeClient {
  return new DevForgeClient({
    adapter,
    workspaceRoot: '/ws',
    getConfig: () => FAKE_CONFIG,
    ...options,
  });
}

describe('DevForgeClient command dispatch', () => {
  const commands: DevForgeCommand[] = ['ask', 'plan', 'fix', 'review', 'run', 'explain', 'status', 'doctor'];

  for (const command of commands) {
    it(`runs ${command} without throwing and reports ok`, async () => {
      const adapter = makeAdapter();
      const client = makeClient(adapter);
      const result = await client.run(command, 'goal');
      expect(result.ok).toBe(true);
      expect(result.command).toBe(command);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  }

  it('rejects an unknown command', async () => {
    const client = makeClient();
    const result = await client.run('nonsense' as DevForgeCommand);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('UNKNOWN_COMMAND');
  });

  it('uses the light context for status/doctor and full context for heavy commands', async () => {
    const adapter = makeAdapter();
    const client = makeClient(adapter);
    await client.run('status');
    await client.run('ask', 'q');
    expect(adapter.createLightContext).toHaveBeenCalled();
    expect(adapter.createExecutionContext).toHaveBeenCalled();
  });

  it('strips ANSI from rendered output', async () => {
    const adapter = makeAdapter();
    vi.mocked(adapter.renderExecutionReport).mockResolvedValue('\x1b[32mgreen\x1b[0m');
    const client = makeClient(adapter);
    const result = await client.run('ask', 'q');
    expect(result.text).toBe('green');
  });

  it('surfaces adapter errors as failed results, not exceptions', async () => {
    const adapter = makeAdapter();
    vi.mocked(adapter.handleStatus).mockRejectedValue(new Error('engine down'));
    const client = makeClient(adapter);
    const result = await client.run('status');
    expect(result.ok).toBe(false);
    expect(result.error?.message).toBe('engine down');
  });

  it('reports progress start/end via onProgress', async () => {
    const adapter = makeAdapter();
    const onProgress = vi.fn();
    const client = makeClient(adapter, { onProgress });
    await client.run('status');
    expect(onProgress).toHaveBeenCalledWith('status', 'start');
    expect(onProgress).toHaveBeenCalledWith('status', 'end');
  });

  it('returns structured plan data for plan', async () => {
    const adapter = makeAdapter();
    const plan = { ok: true, plan: { summary: 's', steps: [], complexity: 'low', risk: 'low', requiresConfirmation: false, assumptions: [], expectedOutputs: [] } };
    const ctx = { services: { planner: { plan: vi.fn().mockResolvedValue(plan) }, executor: { git: {} } } };
    vi.mocked(adapter.createExecutionContext).mockResolvedValue(ctx as never);
    const client = makeClient(adapter);
    const result = await client.run('plan', 'goal');
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(plan);
  });
});

describe('DevForgeClient repository & diff accessors', () => {
  it('repositoryContext resolves from the light context', async () => {
    const adapter = makeAdapter();
    const client = makeClient(adapter);
    const repo = await client.repositoryContext();
    expect(repo).toEqual({ root: '/ws' });
  });

  it('diff delegates to the executor git service', async () => {
    const adapter = makeAdapter();
    const client = makeClient(adapter);
    const diff = await client.diff();
    expect(diff).toEqual({ empty: true, files: [] });
  });

  it('changedFiles delegates to the executor git service', async () => {
    const adapter = makeAdapter();
    const client = makeClient(adapter);
    expect(await client.changedFiles()).toEqual(['a.ts']);
  });

  it('rejectDiff restores the given files', async () => {
    const adapter = makeAdapter();
    const client = makeClient(adapter);
    await client.rejectDiff(['a.ts']);
    const ctx = (await adapter.createExecutionContext('/ws', {}, {})) as { services: { executor: { git: { restore: ReturnType<typeof vi.fn> } } } };
    expect(ctx.services.executor.git.restore).toHaveBeenCalledWith(['a.ts']);
  });

  it('planStructured returns a PlanQueryResult', async () => {
    const adapter = makeAdapter();
    const plan = { ok: true, plan: { summary: 's', steps: [], complexity: 'low', risk: 'low', requiresConfirmation: false, assumptions: [], expectedOutputs: [] } };
    const ctx = { services: { planner: { plan: vi.fn().mockResolvedValue(plan) }, executor: { git: {} } } };
    vi.mocked(adapter.createExecutionContext).mockResolvedValue(ctx as never);
    const client = makeClient(adapter);
    const result = await client.planStructured('goal');
    expect(result.ok).toBe(true);
  });
});

describe('DevForgeClient lifecycle & config', () => {
  it('exposes the workspace root and current config', () => {
    const client = makeClient();
    expect(client.workspaceRoot).toBe('/ws');
    expect(client.config()).toEqual(FAKE_CONFIG);
  });

  it('throws when used after dispose', async () => {
    const client = makeClient();
    await client.dispose();
    expect(client.isDisposed).toBe(true);
    expect(() => client.run('status')).toThrow(DevForgeClientError);
  });

  it('dispose is idempotent', async () => {
    const client = makeClient();
    await client.dispose();
    await client.dispose();
    expect(client.isDisposed).toBe(true);
  });

  it('serializes context creation so it is not recreated', async () => {
    const adapter = makeAdapter();
    const client = makeClient(adapter);
    await client.run('status');
    await client.run('doctor');
    expect(adapter.createLightContext).toHaveBeenCalledTimes(1);
  });

  it('requires a non-empty argument for heavy commands', async () => {
    const adapter = makeAdapter();
    const client = makeClient(adapter);
    const result = await client.run('ask', '   ');
    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/argument/i);
  });

  it('converts thrown strings into UNKNOWN errors', async () => {
    const adapter = makeAdapter();
    vi.mocked(adapter.handleStatus).mockRejectedValue('plain string failure');
    const client = makeClient(adapter);
    const result = await client.run('status');
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('UNKNOWN');
  });
});
