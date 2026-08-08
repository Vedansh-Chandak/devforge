import { describe, expect, it } from 'vitest';
import type { CodePatch } from '@devforge/execution';
import { hashText } from '@devforge/execution';
import { Planner } from '@devforge/planner';
import { AutonomousAgent } from '../agent.js';
import type { AgentEnvironment, AutonomousAgentConfig } from '../agent.js';
import type { AgentResult } from '../types.js';
import { AutonomousValidationError } from '../errors.js';
import {
  constantRunner,
  createPatch,
  failResult,
  fileExists,
  fixedClock,
  modifyPatch,
  okResult,
  readFile,
  scriptedRunner,
  sequencePatchEngine,
  tempWorkspace,
} from './helpers.js';

function buildAgent(
  overrides: {
    goal?: string;
    environment?: AgentEnvironment;
    patches?: readonly (readonly CodePatch[])[];
    results?: readonly ReturnType<typeof okResult>[];
    config?: Partial<AutonomousAgentConfig>;
    files?: Readonly<Record<string, string>>;
  } = {},
): AutonomousAgent {
  const root = overrides.environment?.workspaceRoot ?? tempWorkspace(overrides.files);
  const runner =
    overrides.environment?.runner ?? constantRunner(overrides.results?.[0] ?? okResult());
  const environment: AgentEnvironment = {
    workspaceRoot: root,
    runner,
    targets: overrides.environment?.targets ?? [
      { id: 'typecheck', command: 'tsc', args: ['--noEmit'], cwd: root },
    ],
    ...overrides.environment,
  };
  const patches = overrides.patches ?? [[createPatch('src/feature.ts', 'export const f = 1;')]];
  return new AutonomousAgent({
    goal: overrides.goal ?? 'add a feature',
    environment,
    patchEngine: sequencePatchEngine(patches),
    ...overrides.config,
  });
}

describe('AutonomousAgent validation', () => {
  it('throws when no environment is provided', () => {
    expect(() => new AutonomousAgent({ goal: 'g' } as AutonomousAgentConfig)).toThrow(
      AutonomousValidationError,
    );
  });

  it('throws when the environment has no workspace root', () => {
    expect(
      () => new AutonomousAgent({ goal: 'g', environment: {} as AgentEnvironment }),
    ).toThrow(AutonomousValidationError);
  });

  it('reports PATCH_GENERATION_FAILED when a patchEngine is missing', async () => {
    const agent = new AutonomousAgent({
      goal: 'g',
      environment: { workspaceRoot: tempWorkspace() },
    } as unknown as AutonomousAgentConfig);
    const result = await agent.run();
    expect(result.terminationReason).toBe('PATCH_GENERATION_FAILED');
    expect(result.error?.message).toContain('patchEngine');
  });

  it('refuses to run twice', async () => {
    const agent = buildAgent();
    await agent.run();
    await expect(agent.run()).rejects.toThrow('already been run');
  });

  it('throws on report() before running', () => {
    const agent = buildAgent();
    expect(() => agent.report()).toThrow(AutonomousValidationError);
  });
});

describe('AutonomousAgent success flow', () => {
  it('completes with SUCCESS when the first verification passes', async () => {
    const root = tempWorkspace();
    const agent = buildAgent({
      environment: { workspaceRoot: root, runner: constantRunner(okResult()) },
      patches: [[createPatch('src/feature.ts', 'export const f = 1;')]],
    });
    const result = await agent.run();
    expect(result.outcome).toBe('SUCCESS');
    expect(result.terminationReason).toBe('VERIFICATION_PASSED');
    expect(result.status).toBe('COMPLETED');
    expect(result.error).toBeNull();
    expect(fileExists(root, 'src/feature.ts')).toBe(true);
    expect(readFile(root, 'src/feature.ts')).toBe('export const f = 1;');
  });

  it('applies the generated patch to the workspace', async () => {
    const root = tempWorkspace();
    const agent = buildAgent({ environment: { workspaceRoot: root } });
    await agent.run();
    expect(fileExists(root, 'src/feature.ts')).toBe(true);
  });

  it('exposes the goal on the result', async () => {
    const agent = buildAgent({ goal: 'write a widget' });
    const result = await agent.run();
    expect(result.goal).toBe('write a widget');
  });

  it('clears rollback snapshots on success', async () => {
    const agent = buildAgent();
    const result = await agent.run();
    expect(result.rollbacks).toBe(0);
  });

  it('emits events during the run', async () => {
    const events: string[] = [];
    const agent = buildAgent({ config: { onEvent: (event) => events.push(event.status) } });
    await agent.run();
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((status) => status.includes('GENERATING'))).toBe(true);
  });

  it('records the attempt in history', async () => {
    const agent = buildAgent();
    const result = await agent.run();
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.verificationOk).toBe(true);
  });
});

describe('AutonomousAgent repair flow', () => {
  it('recovers through the repair loop when the first attempt fails', async () => {
    const root = tempWorkspace();
    const runner = scriptedRunner([failResult(), okResult()]);
    const agent = buildAgent({
      environment: { workspaceRoot: root, runner: runner.runner },
      patches: [
        [createPatch('src/x1.ts', 'first')],
        [createPatch('src/x2.ts', 'second')],
      ],
    });
    const result = await agent.run();
    expect(result.outcome).toBe('SUCCESS');
    expect(result.repairAttempts).toBeGreaterThanOrEqual(1);
    expect(runner.calls.length).toBe(2);
    expect(fileExists(root, 'src/x2.ts')).toBe(true);
  });

  it('restores the workspace between failed and successful attempts', async () => {
    const root = tempWorkspace();
    const runner = scriptedRunner([failResult(), okResult()]);
    const agent = buildAgent({
      environment: { workspaceRoot: root, runner: runner.runner },
      patches: [
        [createPatch('src/tmp1.ts', 'first')],
        [createPatch('src/tmp2.ts', 'second')],
      ],
    });
    const result = await agent.run();
    expect(result.rollbacks).toBeGreaterThanOrEqual(1);
  });

  it('fails with MAX_ATTEMPTS_REACHED when every attempt fails', async () => {
    const runner = constantRunner(failResult());
    const agent = buildAgent({
      environment: { workspaceRoot: tempWorkspace(), runner },
      patches: [
        [createPatch('src/a1.ts')],
        [createPatch('src/a2.ts')],
        [createPatch('src/a3.ts')],
      ],
      config: { maxAttempts: 2 },
    });
    const result = await agent.run();
    expect(result.outcome).toBe('FAILED');
    expect(result.terminationReason).toBe('MAX_ATTEMPTS_REACHED');
    expect(result.repairAttempts).toBeLessThanOrEqual(2);
  });

  it('stops on DUPLICATE_PATCH when the engine keeps producing the same set', async () => {
    const patch = createPatch('src/same.ts');
    const runner = constantRunner(failResult());
    const agent = buildAgent({
      environment: { workspaceRoot: tempWorkspace(), runner },
      patches: [[patch], [patch]],
      config: { maxAttempts: 3 },
    });
    const result = await agent.run();
    expect(result.terminationReason).toBe('DUPLICATE_PATCH');
    expect(result.outcome).toBe('FAILED');
  });
});

describe('AutonomousAgent confidence gating', () => {
  it('rejects low-confidence patches below the threshold', async () => {
    const agent = buildAgent({
      patches: [[createPatch('src/feature.ts')]],
      config: { confidenceThreshold: 0.99 },
    });
    const result = await agent.run();
    expect(result.outcome).toBe('REJECTED');
    expect(result.terminationReason).toBe('CONFIDENCE_BELOW_THRESHOLD');
    expect(result.confidenceGatePassed).toBe(false);
  });

  it('proceeds when the confirmation handler accepts a gated patch', async () => {
    const root = tempWorkspace();
    const agent = buildAgent({
      environment: { workspaceRoot: root },
      patches: [[createPatch('src/feature.ts')]],
      config: {
        confidenceThreshold: 0.99,
        confirmationHandler: () => true,
      },
    });
    const result = await agent.run();
    expect(result.outcome).toBe('SUCCESS');
    expect(result.confidenceGatePassed).toBe(true);
    expect(fileExists(root, 'src/feature.ts')).toBe(true);
  });

  it('rejects when the confirmation handler refuses', async () => {
    const agent = buildAgent({
      patches: [[createPatch('src/feature.ts')]],
      config: {
        confidenceThreshold: 0.99,
        confirmationHandler: () => false,
      },
    });
    const result = await agent.run();
    expect(result.outcome).toBe('REJECTED');
  });
});

describe('AutonomousAgent cancellation and timeout', () => {
  it('cancels when the external signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort('stop now');
    const agent = buildAgent({
      environment: { workspaceRoot: tempWorkspace() },
      config: { signal: controller.signal },
    });
    const result = await agent.run();
    expect(result.outcome).toBe('CANCELLED');
    expect(result.terminationReason).toBe('USER_CANCELLED');
  });

  it('cancels from within via cancel()', async () => {
    const agent = buildAgent({
      environment: { workspaceRoot: tempWorkspace() },
      patches: [[createPatch('src/feature.ts')]],
    });
    const run = agent.run();
    agent.cancel('no time');
    const result = await run;
    expect(result.outcome).toBe('CANCELLED');
  });

  it('stops with TIMEOUT when the overall budget is exceeded', async () => {
    const slowRunner = {
      run: async (request: { abortSignal?: AbortSignal }) => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return request.abortSignal?.aborted
          ? okResult({ success: false, cancelled: true, timedOut: true, exitCode: null })
          : okResult();
      },
    };
    const agent = buildAgent({
      environment: {
        workspaceRoot: tempWorkspace(),
        runner: slowRunner,
        verificationTimeoutMs: 5,
      },
      config: { overallTimeoutMs: 5 },
    });
    const result = await agent.run();
    expect(result.terminationReason).toBe('TIMEOUT');
    expect(result.outcome).toBe('FAILED');
  });
});

describe('AutonomousAgent planning', () => {
  it('plans when a planner is configured', async () => {
    const agent = buildAgent({ config: { planner: new Planner() } });
    const result = await agent.run();
    expect(result.plan).not.toBeNull();
    expect(result.outcome).toBe('SUCCESS');
  });

  it('fails with PLANNING_FAILED when the planner errors', async () => {
    const failingPlanner = {
      plan: async () => ({
        ok: false as const,
        error: { code: 'MODEL_ERROR', message: 'model unavailable', retryable: false },
      }),
    } as unknown as Planner;
    const agent = buildAgent({ config: { planner: failingPlanner } });
    const result = await agent.run();
    expect(result.terminationReason).toBe('PLANNING_FAILED');
    expect(result.outcome).toBe('FAILED');
  });

  it('continues without a planner', async () => {
    const agent = buildAgent();
    const result = await agent.run();
    expect(result.plan).toBeNull();
    expect(result.outcome).toBe('SUCCESS');
  });
});

describe('AutonomousAgent failures', () => {
  it('reports PATCH_GENERATION_FAILED when generation throws', async () => {
    const agent = new AutonomousAgent({
      goal: 'g',
      environment: { workspaceRoot: tempWorkspace() },
      patchEngine: {
        name: 'broken',
        generate: async () => {
          throw new Error('model went dark');
        },
      },
      now: fixedClock(),
    });
    const result = await agent.run();
    expect(result.terminationReason).toBe('PATCH_GENERATION_FAILED');
    expect(result.error?.message).toContain('model went dark');
  });

  it('reports PATCH_GENERATION_FAILED when the engine returns no patches', async () => {
    const agent = buildAgent({ patches: [[]] });
    const result = await agent.run();
    expect(result.terminationReason).toBe('PATCH_GENERATION_FAILED');
  });

  it('does not leave generated files behind after a failed run', async () => {
    const root = tempWorkspace();
    const agent = buildAgent({
      environment: { workspaceRoot: root, runner: constantRunner(failResult()) },
      patches: [[createPatch('src/doomed.ts', 'x')], [createPatch('src/doomed2.ts', 'y')]],
      config: { maxAttempts: 1 },
    });
    await agent.run();
    expect(fileExists(root, 'src/doomed.ts')).toBe(false);
    expect(fileExists(root, 'src/doomed2.ts')).toBe(false);
  });
});

describe('AutonomousAgent modify + hash validation', () => {
  it('applies a modify patch when the expected hash matches', async () => {
    const root = tempWorkspace({ 'src/a.ts': 'export const a = 1;' });
    const agent = buildAgent({
      environment: { workspaceRoot: root },
      patches: [
        [
          modifyPatch(
            'src/a.ts',
            'export const a = 2;',
            hashText('export const a = 1;'),
          ),
        ],
      ],
    });
    const result = await agent.run();
    expect(result.outcome).toBe('SUCCESS');
    expect(readFile(root, 'src/a.ts')).toBe('export const a = 2;');
  });
});

describe('AutonomousAgent result surface', () => {
  it('reports deterministic counters', async () => {
    const agent = buildAgent();
    const result = await agent.run();
    expect(result.patchesGenerated).toBe(1);
    expect(result.tokens).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.startedAt).toBeLessThanOrEqual(result.finishedAt);
  });

  it('exposes status and termination details after a failed run', async () => {
    const agent = buildAgent({
      patches: [[createPatch('src/a.ts')]],
      config: { confidenceThreshold: 0.99 },
    });
    const result = await agent.run();
    expect(result.status).toBe('WAITING_CONFIRMATION');
    expect(result.terminationIndex).toBe(1);
    expect(result.terminationMessage.length).toBeGreaterThan(0);
  });

  it('returns the same cached report on subsequent calls', async () => {
    const agent = buildAgent();
    const first = await agent.run();
    const second = agent.report();
    expect(second).toEqual(first);
  });

  it('reports SUCCESS outcome constant for the happy path', async () => {
    const result: AgentResult = await buildAgent().run();
    expect(result.outcome).toBe('SUCCESS');
  });
});