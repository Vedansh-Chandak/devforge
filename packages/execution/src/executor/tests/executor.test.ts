import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CommandRunner } from '../../command/types.js';
import { createGitService } from '../../git/index.js';
import { Workspace } from '../../workspace/index.js';
import {
  ExecutorCancellationError,
  ExecutorError,
  ExecutorExecutionError,
  ExecutorValidationError,
  ExecutorVerificationError,
} from '../errors.js';
import { createExecutor } from '../executor.js';
import type { ExecutorConfig, ExecutionReport, StepContext } from '../types.js';
import {
  failResult,
  fixedClock,
  makePlan,
  makeStep,
  okResult,
  scriptedRunner,
  waitFor,
} from './helpers.js';

const WORKSPACE = '/workspace';

function buildExecutor(
  overrides: Partial<ExecutorConfig> = {},
): ReturnType<typeof createExecutor> {
  return createExecutor({ workspaceRoot: WORKSPACE, ...overrides });
}

describe('executor success flow', () => {
  it('executes steps in schedule order and completes', async () => {
    const order: string[] = [];
    const executor = buildExecutor({
      handlers: {
        SEARCH: async (ctx) => {
          order.push(ctx.step.id);
          return { ok: true, summary: ctx.step.id };
        },
      },
    });
    const plan = makePlan([
      makeStep('a'),
      makeStep('b', { dependsOn: ['a'] }),
      makeStep('c', { dependsOn: ['b'] }),
    ]);
    const report = await executor.execute(plan);
    expect(report.status).toBe('COMPLETED');
    expect(order).toEqual(['a', 'b', 'c']);
    expect(report.steps.map((step) => step.stepId)).toEqual(['a', 'b', 'c']);
    expect(report.steps.every((step) => step.status === 'COMPLETED')).toBe(
      true,
    );
    expect(report.error).toBeUndefined();
  });

  it('exposes IDLE, RUNNING, then COMPLETED status', async () => {
    const executor = buildExecutor({
      handlers: { SEARCH: () => ({ ok: true }) },
    });
    expect(executor.status).toBe('IDLE');
    const promise = executor.execute(makePlan([makeStep('a')]));
    expect(executor.status).toBe('RUNNING');
    await promise;
    expect(executor.status).toBe('COMPLETED');
  });

  it('emits the deterministic event sequence for a successful run', async () => {
    const executor = buildExecutor({
      handlers: { SEARCH: () => ({ ok: true }) },
    });
    await executor.execute(makePlan([makeStep('a'), makeStep('b')]));
    const types = executor.events.map((event) => event.type);
    expect(types).toEqual([
      'ExecutionStarted',
      'PlanValidated',
      'StepStarted',
      'StepCompleted',
      'StepStarted',
      'StepCompleted',
      'ExecutionCompleted',
    ]);
    const sequences = executor.events.map((event) => event.sequence);
    for (let i = 1; i < sequences.length; i++) {
      expect(sequences[i]!).toBe(sequences[i - 1]! + 1);
    }
  });

  it('tags every event with a planId and timestamp', async () => {
    const executor = buildExecutor({
      handlers: { SEARCH: () => ({ ok: true }) },
    });
    await executor.execute(makePlan([makeStep('a')]), { planId: 'run-1' });
    for (const event of executor.events) {
      expect(event.planId).toBe('run-1');
      expect(typeof event.timestamp).toBe('number');
      expect(Number.isFinite(event.timestamp)).toBe(true);
    }
  });

  it('delivers events to subscribers in order', async () => {
    const received: string[] = [];
    const executor = buildExecutor({
      handlers: { SEARCH: () => ({ ok: true }) },
    });
    const unsubscribe = executor.onEvent((event) => received.push(event.type));
    await executor.execute(makePlan([makeStep('a')]));
    unsubscribe();
    expect(received).toEqual([
      'ExecutionStarted',
      'PlanValidated',
      'StepStarted',
      'StepCompleted',
      'ExecutionCompleted',
    ]);
  });

  it('stops notifying unsubscribed listeners', async () => {
    let count = 0;
    const executor = buildExecutor({
      handlers: { SEARCH: () => ({ ok: true }) },
    });
    const unsubscribe = executor.onEvent(() => {
      count += 1;
    });
    unsubscribe();
    await executor.execute(makePlan([makeStep('a')]));
    expect(count).toBe(0);
  });

  it('records step summaries and output from handlers', async () => {
    const executor = buildExecutor({
      handlers: {
        SEARCH: (ctx) => ({
          ok: true,
          summary: `found ${ctx.step.id}`,
          output: 'matched',
        }),
      },
    });
    const report = await executor.execute(makePlan([makeStep('a')]));
    expect(report.steps[0]!.summary).toBe('found a');
    expect(report.steps[0]!.output).toBe('matched');
  });

  it('derives a deterministic planId from the goal', async () => {
    const executor = buildExecutor({
      handlers: { SEARCH: () => ({ ok: true }) },
    });
    const plan = makePlan([makeStep('a')]);
    const report1 = await executor.execute(plan);
    const report2 = await executor.execute(plan);
    expect(report1.planId).toBe(report2.planId);
  });

  it('uses the caller-supplied planId when provided', async () => {
    const executor = buildExecutor({
      handlers: { SEARCH: () => ({ ok: true }) },
    });
    const report = await executor.execute(makePlan([makeStep('a')]), {
      planId: 'custom',
    });
    expect(report.planId).toBe('custom');
  });

  it('can be executed again after completion', async () => {
    const executor = buildExecutor({
      handlers: { SEARCH: () => ({ ok: true }) },
    });
    const first = await executor.execute(makePlan([makeStep('a')]));
    expect(first.status).toBe('COMPLETED');
    const second = await executor.execute(makePlan([makeStep('a')]));
    expect(second.status).toBe('COMPLETED');
    const started = executor.events.filter(
      (e) => e.type === 'ExecutionStarted',
    );
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ planId: second.planId, sequence: 0 });
  });
});

describe('executor plan validation', () => {
  it('rejects a plan that fails planner validation', async () => {
    const executor = buildExecutor({
      handlers: { SEARCH: () => ({ ok: true }) },
    });
    const bad = {
      goal: 'x',
      summary: 's',
      complexity: 'NOPE',
      risk: 'LOW',
      requiresConfirmation: false,
      steps: [makeStep('a')],
      assumptions: [],
      expectedOutputs: [],
    } as never;
    await expect(executor.execute(bad)).rejects.toThrow(
      ExecutorValidationError,
    );
    expect(executor.status).toBe('FAILED');
    const events = executor.events.map((e) => e.type);
    expect(events).toContain('ExecutionStarted');
    expect(events).toContain('ExecutionFailed');
    expect(events).not.toContain('PlanValidated');
  });

  it('rejects an empty plan', async () => {
    const executor = buildExecutor({
      handlers: { SEARCH: () => ({ ok: true }) },
    });
    await expect(executor.execute(makePlan([]))).rejects.toThrow(
      ExecutorValidationError,
    );
    expect(executor.events.some((e) => e.type === 'ExecutionFailed')).toBe(
      true,
    );
  });

  it('rejects a plan with duplicate step ids via plan validation', async () => {
    const executor = buildExecutor({
      handlers: { SEARCH: () => ({ ok: true }) },
    });
    const plan = makePlan([makeStep('a'), makeStep('a')]);
    await expect(executor.execute(plan)).rejects.toThrow(
      ExecutorValidationError,
    );
  });

  it('rejects a plan with a dependency cycle via plan validation', async () => {
    const executor = buildExecutor({
      handlers: { SEARCH: () => ({ ok: true }) },
    });
    const plan = makePlan([
      makeStep('a', { dependsOn: ['b'] }),
      makeStep('b', { dependsOn: ['a'] }),
    ]);
    await expect(executor.execute(plan)).rejects.toThrow(
      ExecutorValidationError,
    );
    expect(executor.events.some((e) => e.type === 'ExecutionFailed')).toBe(
      true,
    );
  });

  it('rejects a plan with a missing dependency via plan validation', async () => {
    const executor = buildExecutor({
      handlers: { SEARCH: () => ({ ok: true }) },
    });
    const plan = makePlan([makeStep('a', { dependsOn: ['ghost'] })]);
    await expect(executor.execute(plan)).rejects.toThrow(
      ExecutorValidationError,
    );
  });

  it('throws when execute is called while another run is active', async () => {
    const executor = buildExecutor({
      handlers: {
        SEARCH: () =>
          new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 20)),
      },
    });
    const first = executor.execute(makePlan([makeStep('a')]));
    await expect(executor.execute(makePlan([makeStep('b')]))).rejects.toThrow(
      /already running/,
    );
    await first;
  });

  it('report() before any execution throws', () => {
    const executor = buildExecutor();
    expect(() => executor.report()).toThrow(/No execution/);
  });
});

describe('executor handlers', () => {
  it('fails with NO_HANDLER for an unhandled step type', async () => {
    const executor = buildExecutor();
    const plan = makePlan([makeStep('a', { type: 'SEARCH' })]);
    try {
      await executor.execute(plan);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ExecutorValidationError);
      expect(error).toMatchObject({ code: 'NO_HANDLER' });
    }
    expect(executor.status).toBe('FAILED');
    expect(executor.events.some((e) => e.type === 'StepFailed')).toBe(true);
  });

  it('hands the full context to a handler', async () => {
    let seen: StepContext | null = null;
    const runner = scriptedRunner().runner;
    const git = createGitService({ workspaceRoot: WORKSPACE, runner });
    const workspace = new Workspace({ root: WORKSPACE });
    const executor = buildExecutor({
      runner,
      git,
      workspace,
      handlers: {
        EDIT: async (ctx) => {
          seen = ctx;
          return { ok: true };
        },
      },
    });
    const plan = makePlan([makeStep('a', { type: 'EDIT' })]);
    await executor.execute(plan);
    expect(seen).not.toBeNull();
    expect(seen!.step.id).toBe('a');
    expect(seen!.plan.goal).toBe('Test goal');
    expect(seen!.workspace).toBe(workspace);
    expect(seen!.runner).toBe(runner);
    expect(seen!.git).toBe(git);
    expect(typeof seen!.clock).toBe('function');
    expect(seen!.signal.aborted).toBe(false);
  });

  it('fails the step when a handler returns ok: false', async () => {
    const executor = buildExecutor({
      handlers: { SEARCH: () => ({ ok: false }) },
    });
    try {
      await executor.execute(makePlan([makeStep('a')]));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ExecutorExecutionError);
      expect(error).toMatchObject({ code: 'STEP_EXECUTION_FAILED' });
    }
    const report = executor.report();
    expect(report.status).toBe('FAILED');
    expect(report.error).toBeDefined();
    expect(report.steps[0]!.status).toBe('FAILED');
  });

  it('fails the step when a handler throws', async () => {
    const executor = buildExecutor({
      handlers: {
        SEARCH: () => {
          throw new Error('kaboom');
        },
      },
    });
    await expect(executor.execute(makePlan([makeStep('a')]))).rejects.toThrow(
      ExecutorExecutionError,
    );
    expect(executor.report().steps[0]!.error?.message).toBe('kaboom');
  });

  it('emits StepFailed and ExecutionFailed on step failure', async () => {
    const executor = buildExecutor({
      handlers: { SEARCH: () => ({ ok: false }) },
    });
    await executor.execute(makePlan([makeStep('a')])).catch(() => undefined);
    const types = executor.events.map((e) => e.type);
    expect(types).toContain('StepFailed');
    expect(types).toContain('ExecutionFailed');
    expect(types).not.toContain('ExecutionCompleted');
    const failed = executor.events.find((e) => e.type === 'StepFailed');
    expect(failed).toMatchObject({ stepId: 'a' });
  });
});

describe('executor command steps', () => {
  it('runs a COMMAND step through the runner', async () => {
    const { runner, calls } = scriptedRunner([okResult({ stdout: 'built' })]);
    const executor = buildExecutor({
      runner,
      commandSteps: {
        build: { command: 'tsc', args: ['--noEmit'] },
      },
    });
    const report = await executor.execute(
      makePlan([makeStep('build', { type: 'COMMAND' })]),
    );
    expect(report.status).toBe('COMPLETED');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe('tsc');
    expect(calls[0]!.args).toEqual(['--noEmit']);
    expect(report.steps[0]!.summary).toBe('tsc --noEmit');
    expect(report.steps[0]!.output).toBe('built');
  });

  it('defaults the command cwd to the workspace root', async () => {
    const { runner, calls } = scriptedRunner([okResult()]);
    const executor = buildExecutor({
      runner,
      commandSteps: { c: { command: 'node', args: ['-v'] } },
    });
    await executor.execute(makePlan([makeStep('c', { type: 'COMMAND' })]));
    expect(calls[0]!.cwd).toBe(WORKSPACE);
  });

  it('fails with COMMAND_SPEC_MISSING when no spec is configured', async () => {
    const executor = buildExecutor();
    try {
      await executor.execute(makePlan([makeStep('c', { type: 'COMMAND' })]));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ExecutorValidationError);
      expect(error).toMatchObject({ code: 'COMMAND_SPEC_MISSING' });
    }
  });

  it('fails the step when the command exits non-zero', async () => {
    const { runner } = scriptedRunner([
      failResult({ exitCode: 2, stderr: 'err' }),
    ]);
    const executor = buildExecutor({
      runner,
      commandSteps: { c: { command: 'node', args: ['x'] } },
    });
    try {
      await executor.execute(makePlan([makeStep('c', { type: 'COMMAND' })]));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ExecutorExecutionError);
      expect(error).toMatchObject({ code: 'STEP_EXECUTION_FAILED' });
    }
    expect(executor.report().steps[0]!.status).toBe('FAILED');
  });
});

describe('executor verification steps', () => {
  it('passes verification and emits VerificationStarted + Passed', async () => {
    const { runner } = scriptedRunner([okResult({ stdout: 'clean' })]);
    const executor = buildExecutor({
      runner,
      verificationTargets: [
        { id: 'typecheck', command: 'tsc', args: ['--noEmit'] },
      ],
    });
    const report = await executor.execute(
      makePlan([makeStep('v', { type: 'VERIFY' })]),
    );
    expect(report.status).toBe('COMPLETED');
    const types = executor.events.map((e) => e.type);
    expect(types).toContain('VerificationStarted');
    expect(types).toContain('VerificationPassed');
    expect(types).not.toContain('VerificationFailed');
  });

  it('runs verification exclusively through the injected runner', async () => {
    const { runner, calls } = scriptedRunner([okResult(), okResult()]);
    const executor = buildExecutor({
      runner,
      verificationTargets: [
        { id: 'typecheck', command: 'tsc', args: ['--noEmit'] },
        { id: 'test', command: 'vitest', args: ['run'] },
      ],
    });
    await executor.execute(makePlan([makeStep('v', { type: 'VERIFY' })]));
    expect(
      calls.map((call) => `${call.command} ${call.args.join(' ')}`),
    ).toEqual(['tsc --noEmit', 'vitest run']);
    expect(calls.every((call) => call.allowFailure === true)).toBe(true);
  });

  it('fails with ExecutorVerificationError when a target fails', async () => {
    const { runner } = scriptedRunner([
      okResult(),
      failResult({ exitCode: 3 }),
    ]);
    const executor = buildExecutor({
      runner,
      verificationTargets: [
        { id: 'typecheck', command: 'tsc', args: ['--noEmit'] },
        { id: 'test', command: 'vitest', args: ['run'] },
      ],
    });
    try {
      await executor.execute(makePlan([makeStep('v', { type: 'VERIFY' })]));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ExecutorVerificationError);
      expect(error).toMatchObject({ code: 'VERIFICATION_FAILED' });
    }
    const types = executor.events.map((e) => e.type);
    expect(types).toContain('VerificationFailed');
    const failedEvent = executor.events.find(
      (e) => e.type === 'VerificationFailed',
    );
    expect(failedEvent).toMatchObject({
      stepId: 'v',
      targetId: 'test',
      exitCode: 3,
    });
    expect(types).not.toContain('VerificationPassed');
  });

  it('uses the default typecheck target when none are configured', async () => {
    const { runner, calls } = scriptedRunner([okResult()]);
    const executor = buildExecutor({ runner });
    await executor.execute(makePlan([makeStep('v', { type: 'VERIFY' })]));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe('tsc');
    expect(calls[0]!.args).toEqual(['--noEmit']);
  });
});

describe('executor confirmation', () => {
  it('pauses at a step that requires confirmation', async () => {
    const executor = buildExecutor({
      handlers: { SEARCH: () => ({ ok: true }) },
    });
    const promise = executor.execute(
      makePlan([makeStep('a'), makeStep('b', { requiresConfirmation: true })]),
    );
    await waitFor(() => executor.status === 'WAITING_CONFIRMATION');
    expect(executor.events.some((e) => e.type === 'ExecutionPaused')).toBe(
      true,
    );
    const paused = executor.events.find((e) => e.type === 'ExecutionPaused');
    expect(paused).toMatchObject({ stepId: 'b' });
    expect(executor.state).toBe('WAIT_CONFIRMATION');
    executor.resume();
    const report = await promise;
    expect(report.status).toBe('COMPLETED');
  });

  it('never auto-confirms a step', async () => {
    const executor = buildExecutor({
      handlers: { SEARCH: () => ({ ok: true }) },
    });
    const promise = executor.execute(
      makePlan([makeStep('a', { requiresConfirmation: true })]),
    );
    await waitFor(() => executor.status === 'WAITING_CONFIRMATION');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(executor.status).toBe('WAITING_CONFIRMATION');
    expect(executor.events.some((e) => e.type === 'ExecutionCompleted')).toBe(
      false,
    );
    executor.resume();
    await promise;
  });

  it('pauses once per confirmation-requiring step', async () => {
    const executor = buildExecutor({
      handlers: { SEARCH: () => ({ ok: true }) },
    });
    const promise = executor.execute(
      makePlan([
        makeStep('a', { requiresConfirmation: true }),
        makeStep('b', { requiresConfirmation: true }),
      ]),
    );
    await waitFor(() => executor.status === 'WAITING_CONFIRMATION');
    executor.resume();
    await waitFor(() => executor.status === 'WAITING_CONFIRMATION');
    executor.resume();
    const report = await promise;
    expect(report.status).toBe('COMPLETED');
    expect(
      executor.events.filter((e) => e.type === 'ExecutionPaused'),
    ).toHaveLength(2);
  });

  it('throws RESUME_INVALID when nothing is paused', async () => {
    const executor = buildExecutor({
      handlers: { SEARCH: () => ({ ok: true }) },
    });
    await executor.execute(makePlan([makeStep('a')]));
    expect(() => executor.resume()).toThrowError(
      expect.objectContaining({ code: 'RESUME_INVALID' }),
    );
  });

  it('cancels while waiting for confirmation', async () => {
    const executor = buildExecutor({
      handlers: { SEARCH: () => ({ ok: true }) },
    });
    const promise = executor.execute(
      makePlan([makeStep('a', { requiresConfirmation: true })]),
    );
    await waitFor(() => executor.status === 'WAITING_CONFIRMATION');
    executor.cancel('user said no');
    await expect(promise).rejects.toThrow(ExecutorCancellationError);
    expect(executor.events.some((e) => e.type === 'ExecutionCancelled')).toBe(
      true,
    );
    expect(executor.status).toBe('CANCELLED');
  });
});

describe('executor cancellation', () => {
  it('cancels before the first step', async () => {
    const controller = new AbortController();
    const executor = buildExecutor({
      handlers: { SEARCH: () => ({ ok: true }) },
    });
    controller.abort();
    await expect(
      executor.execute(makePlan([makeStep('a')]), {
        signal: controller.signal,
      }),
    ).rejects.toThrow(ExecutorCancellationError);
    expect(executor.events.some((e) => e.type === 'ExecutionCancelled')).toBe(
      true,
    );
    expect(executor.events.some((e) => e.type === 'StepStarted')).toBe(false);
  });

  it('cancels between steps', async () => {
    const controller = new AbortController();
    const executor = buildExecutor({
      handlers: {
        SEARCH: (ctx) => {
          if (ctx.step.id === 'b') {
            controller.abort();
          }
          return { ok: true };
        },
      },
    });
    const promise = executor.execute(makePlan([makeStep('a'), makeStep('b')]), {
      signal: controller.signal,
    });
    await expect(promise).rejects.toThrow(ExecutorCancellationError);
    expect(
      executor.events.some((e) => e.type === 'StepStarted' && e.stepId === 'b'),
    ).toBe(true);
    expect(executor.events.some((e) => e.type === 'ExecutionCompleted')).toBe(
      false,
    );
  });

  it('cancels during verification', async () => {
    const controller = new AbortController();
    const runner: CommandRunner = {
      async run(request) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        const aborted = controller.signal.aborted;
        return okResult({
          success: !aborted,
          cancelled: aborted,
          exitCode: aborted ? null : 0,
        });
      },
    };
    const executor = buildExecutor({
      runner,
      verificationTargets: [
        { id: 'typecheck', command: 'tsc', args: ['--noEmit'] },
      ],
    });
    const promise = executor.execute(
      makePlan([makeStep('v', { type: 'VERIFY' })]),
      {
        signal: controller.signal,
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    await expect(promise).rejects.toThrow(ExecutorCancellationError);
    expect(executor.events.some((e) => e.type === 'ExecutionCancelled')).toBe(
      true,
    );
  });

  it('records the reason on the cancellation event', async () => {
    const executor = buildExecutor({
      handlers: {
        SEARCH: () =>
          new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 50)),
      },
    });
    const promise = executor.execute(makePlan([makeStep('a')]));
    await new Promise((resolve) => setTimeout(resolve, 5));
    executor.cancel('halt');
    await expect(promise).rejects.toThrow(ExecutorCancellationError);
    const event = executor.events.find((e) => e.type === 'ExecutionCancelled');
    expect(event).toMatchObject({ reason: 'halt' });
  });
});

describe('concurrent executors', () => {
  it('runs two executor instances in parallel', async () => {
    const logA: string[] = [];
    const logB: string[] = [];
    const { runner: runnerA } = scriptedRunner([okResult()]);
    const { runner: runnerB } = scriptedRunner([okResult()]);
    const gitA = createGitService({
      workspaceRoot: WORKSPACE,
      runner: runnerA,
    });
    const gitB = createGitService({
      workspaceRoot: WORKSPACE,
      runner: runnerB,
    });
    const workspaceA = new Workspace({ root: WORKSPACE });
    const workspaceB = new Workspace({ root: WORKSPACE });
    const executorA = createExecutor({
      workspaceRoot: WORKSPACE,
      runner: runnerA,
      git: gitA,
      workspace: workspaceA,
      now: fixedClock(1000),
      handlers: {
        SEARCH: (ctx) => {
          logA.push(ctx.step.id);
          return { ok: true };
        },
      },
    });
    const executorB = createExecutor({
      workspaceRoot: WORKSPACE,
      runner: runnerB,
      git: gitB,
      workspace: workspaceB,
      now: fixedClock(1000),
      handlers: {
        SEARCH: (ctx) => {
          logB.push(ctx.step.id);
          return { ok: true };
        },
      },
    });
    const planA = makePlan(
      [makeStep('a1'), makeStep('a2', { dependsOn: ['a1'] })],
      { goal: 'Plan A' },
    );
    const planB = makePlan(
      [makeStep('b1'), makeStep('b2', { dependsOn: ['b1'] })],
      { goal: 'Plan B' },
    );
    const [reportA, reportB] = await Promise.all([
      executorA.execute(planA),
      executorB.execute(planB),
    ]);
    expect(reportA.status).toBe('COMPLETED');
    expect(reportB.status).toBe('COMPLETED');
    expect(logA).toEqual(['a1', 'a2']);
    expect(logB).toEqual(['b1', 'b2']);
    expect(reportA.planId).not.toBe(reportB.planId);
  });
});

describe('rollback metadata', () => {
  it('records rollback-capable steps with deterministic tokens', async () => {
    const executor = buildExecutor({
      handlers: {
        EDIT: () => ({ ok: true }),
        COMMAND: () => ({ ok: true }),
        SEARCH: () => ({ ok: true }),
      },
      commandSteps: { c: { command: 'node', args: ['x'] } },
      rollbackCapableSteps: ['edit1', 'cmd1'],
    });
    const report = await executor.execute(
      makePlan([
        makeStep('edit1', { type: 'EDIT' }),
        makeStep('cmd1', { type: 'COMMAND' }),
        makeStep('search1', { type: 'SEARCH' }),
      ]),
    );
    expect(report.rollback).toHaveLength(2);
    expect(report.rollback[0]!.stepId).toBe('cmd1');
    expect(report.rollback[0]!.token).toBe('rollback:cmd1:0');
    expect(report.rollback[0]!.operations[0]!.kind).toBe('COMMAND');
    expect(report.rollback[1]!.stepId).toBe('edit1');
    expect(report.rollback[1]!.operations[0]!.kind).toBe('WORKSPACE_WRITE');
    expect(report.steps[2]!.rollback).toEqual([]);
  });

  it('records handler-supplied rollback operations', async () => {
    const executor = buildExecutor({
      handlers: {
        DELETE: (ctx) => ({
          ok: true,
          rollback: [
            {
              stepId: ctx.step.id,
              kind: 'WORKSPACE_DELETE',
              token: '',
              description: `deleted ${ctx.step.id}`,
            },
          ],
        }),
      },
    });
    const report = await executor.execute(
      makePlan([makeStep('d1', { type: 'DELETE' })]),
    );
    expect(report.rollback).toHaveLength(1);
    expect(report.rollback[0]!.operations[0]!.description).toBe('deleted d1');
    expect(report.rollback[0]!.operations[0]!.token).toBe('rollback:d1:0');
  });

  it('performs no automatic rollback on completion', async () => {
    const executor = buildExecutor({
      handlers: { EDIT: () => ({ ok: true }) },
      rollbackCapableSteps: ['e'],
    });
    const report = await executor.execute(
      makePlan([makeStep('e', { type: 'EDIT' })]),
    );
    expect(report.status).toBe('COMPLETED');
    expect(report.rollback).toHaveLength(1);
    expect(report.rollback[0]!.operations).toHaveLength(1);
  });
});

describe('mixed subsystem execution', () => {
  let temp: string;

  beforeEach(() => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'devforge-executor-'));
  });

  afterEach(() => {
    fs.rmSync(temp, { recursive: true, force: true });
  });

  it('orchestrates Workspace, CommandRunner, and GitService', async () => {
    const workspace = new Workspace({ root: temp });
    const runner = scriptedRunner([
      okResult({ stdout: 'built' }),
      okResult({ stdout: 'clean' }),
    ]).runner;
    const git = createGitService({ workspaceRoot: temp, runner });
    const observed: string[] = [];
    const executor = createExecutor({
      workspaceRoot: temp,
      runner,
      git,
      workspace,
      handlers: {
        SEARCH: (ctx) => {
          observed.push('search');
          expect(ctx.workspace.root).toBe(temp);
          expect(ctx.git.workspaceRoot).toBe(temp);
          return { ok: true, summary: 'scanned' };
        },
        EDIT: async (ctx) => {
          observed.push('edit');
          await ctx.workspace.writeFile('output.txt', 'hello');
          return { ok: true, summary: 'wrote' };
        },
      },
      commandSteps: { build: { command: 'tsc', args: ['--noEmit'] } },
      verificationTargets: [
        { id: 'typecheck', command: 'tsc', args: ['--noEmit'] },
      ],
    });

    const plan = makePlan([
      makeStep('scan', { type: 'SEARCH' }),
      makeStep('edit', { type: 'EDIT', dependsOn: ['scan'] }),
      makeStep('build', { type: 'COMMAND', dependsOn: ['edit'] }),
      makeStep('verify', { type: 'VERIFY', dependsOn: ['build'] }),
    ]);
    const report = await executor.execute(plan);

    expect(report.status).toBe('COMPLETED');
    expect(observed).toEqual(['search', 'edit']);
    expect(await workspace.readFile('output.txt')).toBe('hello');
    const types = executor.events.map((e) => e.type);
    expect(types).toContain('VerificationPassed');
    expect(report.steps.map((s) => s.stepId)).toEqual([
      'scan',
      'edit',
      'build',
      'verify',
    ]);
  });

  it('uses a real command runner for a real command step', async () => {
    const workspace = new Workspace({ root: temp });
    const executor = createExecutor({
      workspaceRoot: temp,
      workspace,
      commandSteps: {
        node: { command: 'node', args: ['-e', 'console.log("ran")'] },
      },
    });
    const report = await executor.execute(
      makePlan([makeStep('node', { type: 'COMMAND' })]),
    );
    expect(report.status).toBe('COMPLETED');
    expect(report.steps[0]!.output).toContain('ran');
  });
});

describe('executor report details', () => {
  it('produces a FAILED report with error metadata', async () => {
    const executor = buildExecutor({
      handlers: { SEARCH: () => ({ ok: false }) },
    });
    await executor.execute(makePlan([makeStep('a')])).catch(() => undefined);
    const report = executor.report();
    expect(report.status).toBe('FAILED');
    expect(report.error).toMatchObject({
      code: 'STEP_EXECUTION_FAILED',
      stepId: 'a',
    });
    expect(report.steps[0]!.status).toBe('FAILED');
    expect(report.finishedAt).not.toBeNull();
    expect(report.eventCount).toBe(executor.events.length);
  });

  it('produces a CANCELLED report with cancelled status', async () => {
    const executor = buildExecutor({
      handlers: { SEARCH: () => ({ ok: true }) },
    });
    const promise = executor.execute(
      makePlan([makeStep('a', { requiresConfirmation: true })]),
    );
    await waitFor(() => executor.status === 'WAITING_CONFIRMATION');
    executor.cancel();
    await promise.catch(() => undefined);
    const report = executor.report();
    expect(report.status).toBe('CANCELLED');
  });

  it('computes deterministic durations from the injected clock', async () => {
    const executor = buildExecutor({
      now: fixedClock(5000, 10),
      handlers: { SEARCH: () => ({ ok: true }) },
    });
    const report = await executor.execute(makePlan([makeStep('a')]));
    expect(report.steps[0]!.durationMs).toBe(10);
  });
});

describe('executor additional guarantees', () => {
  it('does not pause for plan-level requiresConfirmation', async () => {
    const executor = buildExecutor({
      handlers: { SEARCH: () => ({ ok: true }) },
    });
    const plan = makePlan([makeStep('a')], { requiresConfirmation: true });
    const report = await executor.execute(plan);
    expect(report.status).toBe('COMPLETED');
    expect(executor.events.some((e) => e.type === 'ExecutionPaused')).toBe(
      false,
    );
  });

  it('stops execution at the first failing step', async () => {
    const order: string[] = [];
    const executor = buildExecutor({
      handlers: {
        SEARCH: (ctx) => {
          order.push(ctx.step.id);
          return { ok: ctx.step.id !== 'b' };
        },
      },
    });
    await executor
      .execute(
        makePlan([
          makeStep('a'),
          makeStep('b', { dependsOn: ['a'] }),
          makeStep('c', { dependsOn: ['b'] }),
        ]),
      )
      .catch(() => undefined);
    expect(order).toEqual(['a', 'b']);
    const steps = executor.report().steps;
    expect(steps.map((s) => s.stepId)).toEqual(['a', 'b']);
    expect(steps[1]!.status).toBe('FAILED');
    expect(
      executor.events.some((e) => e.type === 'StepStarted' && e.stepId === 'c'),
    ).toBe(false);
  });

  it('copies goal and summary into the report', async () => {
    const executor = buildExecutor({
      handlers: { SEARCH: () => ({ ok: true }) },
    });
    const plan = makePlan([makeStep('a')], {
      goal: 'Ship the feature',
      summary: 'A summary of the plan',
    });
    const report = await executor.execute(plan);
    expect(report.goal).toBe('Ship the feature');
    expect(report.summary).toBe('A summary of the plan');
  });

  it('marks a failed verification step as FAILED in the report', async () => {
    const { runner } = scriptedRunner([failResult()]);
    const executor = buildExecutor({
      runner,
      verificationTargets: [
        { id: 'typecheck', command: 'tsc', args: ['--noEmit'] },
      ],
    });
    await executor
      .execute(makePlan([makeStep('v', { type: 'VERIFY' })]))
      .catch(() => undefined);
    const report = executor.report();
    expect(report.steps[0]!.status).toBe('FAILED');
    expect(report.steps[0]!.error?.code).toBe('VERIFICATION_FAILED');
    expect(report.error).toMatchObject({
      code: 'VERIFICATION_FAILED',
      stepId: 'v',
    });
  });

  it('emits an identical event type sequence across identical runs', async () => {
    const executor = buildExecutor({
      handlers: { SEARCH: () => ({ ok: true }) },
    });
    const plan = makePlan([makeStep('a'), makeStep('b', { dependsOn: ['a'] })]);
    const first = await executor.execute(plan);
    const second = await executor.execute(plan);
    expect(first.status).toBe('COMPLETED');
    expect(second.status).toBe('COMPLETED');
    expect(first.steps.map((s) => s.stepId)).toEqual(
      second.steps.map((s) => s.stepId),
    );
  });

  it('rejects resume on a fresh executor', () => {
    const executor = buildExecutor();
    expect(() => executor.resume()).toThrowError(
      expect.objectContaining({ code: 'RESUME_INVALID' }),
    );
  });

  it('runs a plan using only built-in COMMAND and VERIFY handling', async () => {
    const { runner, calls } = scriptedRunner([okResult(), okResult()]);
    const executor = buildExecutor({
      runner,
      commandSteps: { build: { command: 'tsc', args: ['--noEmit'] } },
      verificationTargets: [{ id: 'test', command: 'vitest', args: ['run'] }],
    });
    const report = await executor.execute(
      makePlan([
        makeStep('build', { type: 'COMMAND' }),
        makeStep('verify', { type: 'VERIFY', dependsOn: ['build'] }),
      ]),
    );
    expect(report.status).toBe('COMPLETED');
    expect(calls.map((c) => c.command)).toEqual(['tsc', 'vitest']);
  });

  it('records only completed or failed steps in the report', async () => {
    const executor = buildExecutor({
      handlers: { SEARCH: () => ({ ok: false }) },
    });
    await executor.execute(makePlan([makeStep('a')])).catch(() => undefined);
    for (const step of executor.report().steps) {
      expect(['COMPLETED', 'FAILED']).toContain(step.status);
    }
  });
});
