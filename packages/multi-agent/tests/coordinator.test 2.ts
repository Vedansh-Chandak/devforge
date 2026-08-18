import { describe, expect, it } from 'vitest';
import { Coordinator, COORDINATOR_DEFAULTS } from '../src/coordinator.js';
import { AgentPool } from '../src/agent-pool.js';
import { fixedVerifier } from '../src/execution/verification.js';
import { scripted } from './helpers/mock.js';
import type { Task } from '../src/types.js';
import type { Verifier } from '../src/execution/verification.js';
import type { AgentRole } from '../src/types.js';

function coordinator(overrides: ConstructorParameters<typeof Coordinator>[0] = {}) {
  const pool = new AgentPool();
  pool.register(scripted.succeed('PLANNER'));
  pool.register(scripted.succeed('CODER'));
  pool.register(scripted.succeed('REVIEWER'));
  pool.register(scripted.succeed('TESTER'));
  pool.register(scripted.succeed('REPAIR'));
  pool.register(scripted.succeed('DOCUMENTATION'));
  return {
    coord: new Coordinator({ maxRepairRounds: 0, ...overrides }, { pool, now: () => 100 }),
    pool,
  };
}

const manualTasks = () => ({
  tasks: [
    {
      id: 'a',
      title: 'A',
      description: 'A',
      kind: 'IMPLEMENT',
      role: 'CODER',
      dependsOn: [],
      requiresConfirmation: false,
      timeoutMs: 0,
      maxRetries: 1,
    } as Task,
    {
      id: 'b',
      title: 'B',
      description: 'B',
      kind: 'TEST',
      role: 'TESTER',
      dependsOn: ['a'],
      requiresConfirmation: false,
      timeoutMs: 0,
      maxRetries: 1,
    } as Task,
  ],
});

describe('Coordinator config', () => {
  it('exposes sensible defaults', () => {
    expect(COORDINATOR_DEFAULTS.maxParallelism).toBe(4);
    expect(COORDINATOR_DEFAULTS.confirmationMode).toBe('AUTO_APPROVE');
    expect(COORDINATOR_DEFAULTS.maxRepairRounds).toBe(2);
    expect(COORDINATOR_DEFAULTS.requireConfirmation).toBe(false);
  });

  it('exposes its agent pool', () => {
    const { coord } = coordinator();
    expect(coord.pool).toBeInstanceOf(AgentPool);
  });

  it('registers six default role agents', () => {
    const coord = new Coordinator();
    coord.withDefaultAgents();
    expect(coord.pool.size).toBe(6);
  });
});

describe('Coordinator.run', () => {
  it('ends with a SUCCESS outcome when tasks and verification pass', async () => {
    const { coord } = coordinator();
    const result = await coord.run('add auth', {
      tasks: manualTasks().tasks,
      verifier: fixedVerifier(true),
    });
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe('SUCCESS');
    expect(result.tasks.every((t) => t.status === 'SUCCEEDED')).toBe(true);
  });

  it('produces a run report with a timeline and metrics', async () => {
    const { coord } = coordinator();
    const result = await coord.run('add auth', {
      tasks: manualTasks().tasks,
      verifier: fixedVerifier(true),
    });
    expect(result.report.runId).toBe('run-1');
    expect(result.report.timeline.some((t) => t.type === 'RUN_STARTED')).toBe(true);
    expect(result.report.timeline.some((t) => t.type === 'RUN_COMPLETED')).toBe(true);
    expect(result.report.graph).toHaveLength(2);
    expect(result.report.verification?.ok).toBe(true);
  });

  it('fails when verification fails and repair is disabled', async () => {
    const { coord } = coordinator({ maxRepairRounds: 0 });
    const result = await coord.run('add auth', {
      tasks: manualTasks().tasks,
      verifier: fixedVerifier(false, 'build'),
    });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('FAILED');
  });

  it('triggers a repair round when verification first fails then passes', async () => {
    let call = 0;
    const verifier: Verifier = {
      async verify(ctx, options = {}) {
        call += 1;
        if (call === 1) {
          ctx.conversation.post({
            type: 'VERIFICATION_FAILED',
            at: ctx.now(),
            payload: { failedTargetId: 'build', durationMs: 0 },
            summary: 'verification failed',
          });
          return {
            ok: false,
            targets: ['build'],
            failedTargetId: 'build',
            durationMs: 0,
            attempts: options.attempts ?? 1,
            cancelled: false,
          };
        }
        ctx.conversation.post({
          type: 'VERIFICATION_PASSED',
          at: ctx.now(),
          payload: { durationMs: 0 },
          summary: 'verification passed',
        });
        return {
          ok: true,
          targets: ['build'],
          failedTargetId: null,
          durationMs: 0,
          attempts: options.attempts ?? 1,
          cancelled: false,
        };
      },
    };

    const pool = new AgentPool();
    for (const agent of ['PLANNER', 'CODER', 'REVIEWER', 'TESTER', 'REPAIR', 'DOCUMENTATION'] as const) {
      pool.register(scripted.succeed(agent));
    }
    const coord = new Coordinator({ maxRepairRounds: 2 }, { pool, verifier });
    const result = await coord.run('add auth', { tasks: manualTasks().tasks });
    expect(result.ok).toBe(true);
    expect(result.report.repair.repairRequests).toBe(1);
    expect(result.report.repair.repairTaskIds).toEqual(['repair-1']);
  });

  it('skips a task whose dependency failed', async () => {
    const pool = new AgentPool();
    pool.register(scripted.fail('CODER', 'MA_X'));
    pool.register(scripted.succeed('TESTER'));
    for (const agent of ['PLANNER', 'REVIEWER', 'REPAIR', 'DOCUMENTATION'] as const) {
      pool.register(scripted.succeed(agent));
    }
    const coord = new Coordinator({ maxRepairRounds: 0 }, { pool });
    const result = await coord.run('go', {
      tasks: manualTasks().tasks,
      verifier: fixedVerifier(true),
    });
    const byId = new Map(result.tasks.map((t) => [t.taskId, t]));
    expect(byId.get('a')?.status).toBe('FAILED');
    expect(byId.get('b')?.status).toBe('SKIPPED');
  });

  it('rejects tasks that require confirmation when denied', async () => {
    const { coord } = coordinator();
    const a = manualTasks().tasks[0]!;
    const tasks: Task[] = [{ ...a, requiresConfirmation: true }];
    const result = await coord.run('go', {
      tasks,
      verifier: fixedVerifier(true),
      confirmationMode: 'REQUIRE_APPROVAL',
      confirm: () => false,
    });
    expect(result.tasks[0]?.status).toBe('SKIPPED');
    expect(result.tasks[0]?.error?.code).toBe('MA_CONFIRMATION_REJECTED');
  });

  it('approves tasks that require confirmation when allowed', async () => {
    const { coord } = coordinator();
    const a = manualTasks().tasks[0]!;
    const tasks: Task[] = [{ ...a, requiresConfirmation: true }];
    const result = await coord.run('go', {
      tasks,
      verifier: fixedVerifier(true),
      confirmationMode: 'REQUIRE_APPROVAL',
      confirm: () => true,
    });
    expect(result.tasks[0]?.status).toBe('SUCCEEDED');
  });

  it('decomposes the goal when no tasks are supplied', async () => {
    const { coord } = coordinator();
    const result = await coord.run('add api', { verifier: fixedVerifier(true) });
    expect(result.tasks.length).toBeGreaterThan(0);
    expect(result.tasks.filter((t) => t.status === 'SUCCEEDED').length).toBeGreaterThan(0);
  });

  it('cancels the run when the cancel signal is already aborted', async () => {
    const { coord } = coordinator();
    const controller = new AbortController();
    controller.abort();
    const result = await coord.run('go', {
      tasks: manualTasks().tasks,
      verifier: fixedVerifier(true),
      cancelSignal: controller.signal,
    });
    expect(result.cancelled).toBe(true);
    expect(result.outcome).toBe('CANCELLED');
  });

  it('is deterministic across identical runs', async () => {
    const run = async () => {
      const { coord } = coordinator();
      return coord.run('add auth', { tasks: manualTasks().tasks, verifier: fixedVerifier(true) });
    };
    const first = await run();
    const second = await run();
    expect(first.tasks.map((t) => t.taskId)).toEqual(second.tasks.map((t) => t.taskId));
    expect(first.report).toEqual(second.report);
  });

  it('reports a FAILED outcome when a task fails', async () => {
    const pool = new AgentPool();
    pool.register(scripted.succeed('PLANNER'));
    pool.register(scripted.fail('CODER', 'MA_SCRIPTED', 'cannot code', false));
    pool.register(scripted.succeed('REVIEWER'));
    pool.register(scripted.succeed('TESTER'));
    pool.register(scripted.succeed('REPAIR'));
    pool.register(scripted.succeed('DOCUMENTATION'));
    const coord = new Coordinator({ maxRepairRounds: 0 }, { pool, now: () => 100 });
    const result = await coord.run('go', {
      tasks: manualTasks().tasks,
      verifier: fixedVerifier(false),
    });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('FAILED');
    expect(result.tasks.find((t) => t.taskId === 'a')?.status).toBe('FAILED');
    expect(result.tasks.find((t) => t.taskId === 'b')?.status).toBe('SKIPPED');
  });

  it('reports the failed task error details', async () => {
    const pool = new AgentPool();
    pool.register(scripted.succeed('PLANNER'));
    pool.register(scripted.fail('CODER', 'MA_SCRIPTED', 'cannot code', true));
    pool.register(scripted.succeed('REVIEWER'));
    pool.register(scripted.succeed('TESTER'));
    pool.register(scripted.succeed('REPAIR'));
    pool.register(scripted.succeed('DOCUMENTATION'));
    const coord = new Coordinator({ maxRepairRounds: 0 }, { pool, now: () => 100 });
    const result = await coord.run('go', {
      tasks: manualTasks().tasks,
      verifier: fixedVerifier(true),
    });
    const failed = result.tasks.find((t) => t.taskId === 'a');
    expect(failed?.error?.code).toBe('MA_SCRIPTED');
    expect(failed?.error?.message).toBe('cannot code');
    expect(failed?.error?.retryable).toBe(true);
  });

  it('fails fast when a required role has no registered agent', async () => {
    const pool = new AgentPool();
    pool.register(scripted.succeed('CODER'));
    const coord = new Coordinator({ maxRepairRounds: 0 }, { pool, now: () => 100 });
    await expect(
      coord.run('go', { tasks: manualTasks().tasks, verifier: fixedVerifier(true) }),
    ).rejects.toThrow(/CODER|role|agent/i);
  });

  it('honors the confirmationMode REJECT decision', async () => {
    const { coord } = coordinator({ confirmationMode: 'REJECT' });
    const a = manualTasks().tasks[0]!;
    const tasks: Task[] = [{ ...a, requiresConfirmation: true }];
    const result = await coord.run('go', {
      tasks,
      verifier: fixedVerifier(false),
    });
    expect(result.tasks[0]?.status).toBe('SKIPPED');
    expect(result.tasks[0]?.error?.code).toBe('MA_CONFIRMATION_REJECTED');
  });

  it('runs repair rounds when verification fails then passes', async () => {
    const { coord } = coordinator({ maxRepairRounds: 2 });
    let verifies = 0;
    const verifier: Verifier = {
      async verify() {
        verifies += 1;
        return {
          ok: verifies >= 2,
          targets: ['build'],
          failedTargetId: verifies < 2 ? 'build' : null,
          durationMs: 0,
          attempts: verifies,
          cancelled: false,
        };
      },
    };
    const result = await coord.run('go', {
      tasks: manualTasks().tasks,
      verifier,
    });
    expect(verifies).toBe(2);
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe('SUCCESS');
    expect(result.report.repair.repairRequests).toBe(1);
    expect(result.report.repair.repairTaskIds).toEqual(['repair-1']);
  });

  it('exhausts maxRepairRounds and reports FAILED', async () => {
    const { coord } = coordinator({ maxRepairRounds: 3 });
    const verifier: Verifier = {
      async verify() {
        return {
          ok: false,
          targets: ['build'],
          failedTargetId: 'build',
          durationMs: 0,
          attempts: 0,
          cancelled: false,
        };
      },
    };
    const result = await coord.run('go', {
      tasks: manualTasks().tasks,
      verifier,
    });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('FAILED');
    expect(result.report.repair.repairRequests).toBe(3);
    expect(result.report.repair.repairTaskIds).toEqual(['repair-1', 'repair-2', 'repair-3']);
    expect(result.report.repair.repaired).toBe(3);
    expect(result.report.repair.unresolved).toEqual([]);
  });

  it('records verification attempts across repair rounds', async () => {
    const { coord } = coordinator({ maxRepairRounds: 1 });
    let calls = 0;
    const verifier: Verifier = {
      async verify() {
        calls += 1;
        return {
          ok: calls >= 2,
          targets: ['t'],
          failedTargetId: null,
          durationMs: 0,
          attempts: calls,
          cancelled: false,
        };
      },
    };
    const result = await coord.run('go', {
      tasks: manualTasks().tasks,
      verifier,
    });
    expect(result.report.verification?.attempts).toBe(2);
  });

  it('appends repair tasks to the task results', async () => {
    const { coord } = coordinator({ maxRepairRounds: 1 });
    let calls = 0;
    const verifier: Verifier = {
      async verify() {
        calls += 1;
        return {
          ok: calls >= 2,
          targets: ['build'],
          failedTargetId: null,
          durationMs: 0,
          attempts: calls,
          cancelled: false,
        };
      },
    };
    const result = await coord.run('go', {
      tasks: manualTasks().tasks,
      verifier,
    });
    const ids = result.tasks.map((t) => t.taskId);
    expect(ids).toEqual(['a', 'b', 'repair-1']);
    const repair = result.tasks.find((t) => t.taskId === 'repair-1');
    expect(repair?.role).toBe('REPAIR');
    expect(repair?.kind).toBe('REPAIR');
  });

  it('skips repair when verification passes on the first attempt', async () => {
    const { coord } = coordinator({ maxRepairRounds: 2 });
    const verifier: Verifier = {
      async verify() {
        return {
          ok: true,
          targets: ['build'],
          failedTargetId: null,
          durationMs: 0,
          attempts: 1,
          cancelled: false,
        };
      },
    };
    const result = await coord.run('go', {
      tasks: manualTasks().tasks,
      verifier,
    });
    expect(result.report.repair.repairRequests).toBe(0);
    expect(result.report.verification?.ok).toBe(true);
  });
});