import { describe, expect, it } from 'vitest';
import { Scheduler, buildSchedule } from '../src/scheduler.js';
import { makeContext, ManualClock, makeTask, neverResolves } from './helpers/mock.js';
import type { Task, TaskResult } from '../src/types.js';
import { MultiAgentValidationError } from '../src/errors.js';

const okRun = async (task: Task): Promise<TaskResult> => ({
  taskId: task.id,
  role: task.role,
  kind: task.kind,
  ok: true,
  status: 'SUCCEEDED',
  artifacts: [],
  messages: [],
  attempts: 1,
  durationMs: 0,
  error: null,
});

const failRun = (code: string, retryable: boolean) => async (task: Task): Promise<TaskResult> => ({
  taskId: task.id,
  role: task.role,
  kind: task.kind,
  ok: false,
  status: 'FAILED',
  artifacts: [],
  messages: [],
  attempts: 1,
  durationMs: 0,
  error: { code, message: code, retryable },
});

function scheduler(clock: ManualClock, overrides: Partial<ConstructorParameters<typeof Scheduler>[0]> = {}) {
  return new Scheduler({
    maxParallelism: 4,
    retryDelayMs: 10,
    defaultTaskTimeoutMs: 1000,
    defaultMaxRetries: 1,
    globalTimeoutMs: 10000,
    now: clock.now,
    sleep: clock.sleep,
    ...overrides,
  });
}

describe('buildSchedule', () => {
  it('puts independent tasks in one batch', () => {
    const tasks = [
      makeTask({ id: 'a', dependsOn: [] }),
      makeTask({ id: 'b', dependsOn: [] }),
    ];
    const schedule = buildSchedule(tasks);
    expect(schedule.depth).toBe(1);
    expect(schedule.batches[0]?.tasks.map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  it('creates one batch per dependency level', () => {
    const tasks = [
      makeTask({ id: 'a', dependsOn: [] }),
      makeTask({ id: 'b', dependsOn: ['a'] }),
      makeTask({ id: 'c', dependsOn: ['b'] }),
    ];
    const schedule = buildSchedule(tasks);
    expect(schedule.depth).toBe(3);
    expect(schedule.batches.map((b) => b.tasks.map((t) => t.id))).toEqual([['a'], ['b'], ['c']]);
  });

  it('orders tasks within a batch by id', () => {
    const tasks = [
      makeTask({ id: 'b', dependsOn: [] }),
      makeTask({ id: 'a', dependsOn: [] }),
    ];
    const schedule = buildSchedule(tasks);
    expect(schedule.batches[0]!.tasks.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('exposes a deterministic global order', () => {
    const tasks = [
      makeTask({ id: 'c', dependsOn: ['a'] }),
      makeTask({ id: 'a', dependsOn: [] }),
      makeTask({ id: 'b', dependsOn: ['a'] }),
    ];
    const schedule = buildSchedule(tasks);
    expect(schedule.order).toEqual(['a', 'b', 'c']);
  });

  it('is deterministic across invocations', () => {
    const tasks = [
      makeTask({ id: 'x', dependsOn: [] }),
      makeTask({ id: 'y', dependsOn: ['x'] }),
    ];
    expect(buildSchedule(tasks)).toEqual(buildSchedule(tasks));
  });

  it('handles diamond graphs', () => {
    const tasks = [
      makeTask({ id: 'top', dependsOn: [] }),
      makeTask({ id: 'l', dependsOn: ['top'] }),
      makeTask({ id: 'r', dependsOn: ['top'] }),
      makeTask({ id: 'b', dependsOn: ['l', 'r'] }),
    ];
    const schedule = buildSchedule(tasks);
    expect(schedule.depth).toBe(3);
    expect(schedule.batches[1]!.tasks.map((t) => t.id).sort()).toEqual(['l', 'r']);
  });
});

describe('Scheduler.plan', () => {
  it('delegates to buildSchedule', () => {
    const s = scheduler(new ManualClock());
    const plan = s.plan([makeTask({ id: 'a', dependsOn: [] }), makeTask({ id: 'b', dependsOn: ['a'] })]);
    expect(plan.order).toEqual(['a', 'b']);
  });

  it('rejects a zero parallelism scheduler', () => {
    expect(() => scheduler(new ManualClock(), { maxParallelism: 0 })).toThrow(
      MultiAgentValidationError,
    );
  });
});

describe('Scheduler.execute', () => {
  it('executes sequential dependencies in order', async () => {
    const clock = new ManualClock();
    const ctx = makeContext('r', clock);
    const s = scheduler(clock);
    const tasks = [
      makeTask({ id: 'a', dependsOn: [] }),
      makeTask({ id: 'b', dependsOn: ['a'] }),
    ];
    const calls: string[] = [];
    const outcome = await s.execute(
      tasks,
      async (task) => {
        calls.push(task.id);
        return okRun(task);
      },
      ctx,
    );
    expect(calls).toEqual(['a', 'b']);
    expect(outcome.results.map((r) => r.taskId)).toEqual(['a', 'b']);
    expect(outcome.results.every((r) => r.status === 'SUCCEEDED')).toBe(true);
  });

  it('returns results in deterministic schedule order', async () => {
    const clock = new ManualClock();
    const ctx = makeContext('r', clock);
    const s = scheduler(clock);
    const tasks = [
      makeTask({ id: 'a', dependsOn: [] }),
      makeTask({ id: 'b', dependsOn: [] }),
      makeTask({ id: 'c', dependsOn: [] }),
    ];
    const outcome = await s.execute(tasks, okRun, ctx);
    expect(outcome.results.map((r) => r.taskId)).toEqual(['a', 'b', 'c']);
  });

  it('skips a task whose dependency failed', async () => {
    const clock = new ManualClock();
    const ctx = makeContext('r', clock);
    const s = scheduler(clock);
    const tasks = [
      makeTask({ id: 'a', dependsOn: [] }),
      makeTask({ id: 'b', dependsOn: ['a'] }),
    ];
    let fails = true;
    const outcome = await s.execute(
      tasks,
      async (task) => (fails ? failRun('MA_X', false)(task) : okRun(task)),
      ctx,
    );
    const byId = new Map(outcome.results.map((r) => [r.taskId, r]));
    expect(byId.get('a')?.status).toBe('FAILED');
    expect(byId.get('b')?.status).toBe('SKIPPED');
    expect(outcome.results.map((r) => r.taskId)).toEqual(['a', 'b']);
  });

  it('does not run a dependent task when the dependency is skipped', async () => {
    const clock = new ManualClock();
    const ctx = makeContext('r', clock);
    const s = scheduler(clock);
    const tasks = [
      makeTask({ id: 'a', dependsOn: [] }),
      makeTask({ id: 'b', dependsOn: ['a'] }),
      makeTask({ id: 'c', dependsOn: ['b'] }),
    ];
    const called = new Set<string>();
    await s.execute(
      tasks,
      async (task) => {
        if (task.id === 'a') return failRun('MA_X', false)(task);
        called.add(task.id);
        return okRun(task);
      },
      ctx,
    );
    expect([...called]).toEqual([]);
  });

  it('retries retryable failures up to the budget', async () => {
    const clock = new ManualClock();
    const ctx = makeContext('r', clock);
    const s = scheduler(clock);
    let attempts = 0;
    const outcome = await s.execute(
      [makeTask({ id: 'a', maxRetries: 2 })],
      async (task) => {
        attempts += 1;
        if (attempts < 3) return failRun('MA_FLAKY', true)(task);
        return {
          ...(await okRun(task)),
          attempts,
        };
      },
      ctx,
    );
    expect(attempts).toBe(3);
    expect(outcome.results[0]?.status).toBe('SUCCEEDED');
    expect(outcome.results[0]?.attempts).toBe(3);
  });

  it('gives up after maxRetries exhausted', async () => {
    const clock = new ManualClock();
    const ctx = makeContext('r', clock);
    const s = scheduler(clock);
    let attempts = 0;
    const outcome = await s.execute(
      [makeTask({ id: 'a', maxRetries: 2 })],
      async (task) => {
        attempts += 1;
        return failRun('MA_FLAKY', true)(task);
      },
      ctx,
    );
    expect(attempts).toBe(3);
    expect(outcome.results[0]?.status).toBe('FAILED');
  });

  it('does not retry non-retryable failures', async () => {
    const clock = new ManualClock();
    const ctx = makeContext('r', clock);
    const s = scheduler(clock);
    let attempts = 0;
    await s.execute(
      [makeTask({ id: 'a', maxRetries: 3 })],
      async (task) => {
        attempts += 1;
        return failRun('MA_HARD', false)(task);
      },
      ctx,
    );
    expect(attempts).toBe(1);
  });

  it('times out a task that never resolves', async () => {
    const clock = new ManualClock();
    const ctx = makeContext('r', clock);
    const s = scheduler(clock, { defaultTaskTimeoutMs: 100 });
    const outcome = await s.execute(
      [makeTask({ id: 'a', timeoutMs: 100 })],
      async () => neverResolves<TaskResult>(),
      ctx,
    );
    expect(outcome.timedOut).toBe(true);
    expect(outcome.results[0]?.error?.code).toBe('MA_TASK_TIMEOUT');
  });

  it('does not time out a task that resolves quickly', async () => {
    const clock = new ManualClock();
    const ctx = makeContext('r', clock);
    const s = scheduler(clock);
    const outcome = await s.execute([makeTask({ id: 'a' })], okRun, ctx);
    expect(outcome.timedOut).toBe(false);
    expect(outcome.results[0]?.status).toBe('SUCCEEDED');
  });

  it('cancels remaining work when aborted', async () => {
    const clock = new ManualClock();
    const ctx = makeContext('r', clock);
    const controller = new AbortController();
    ctx.signal = controller.signal;
    const s = scheduler(clock);
    const tasks = [
      makeTask({ id: 'a', dependsOn: [] }),
      makeTask({ id: 'b', dependsOn: ['a'] }),
      makeTask({ id: 'c', dependsOn: ['b'] }),
    ];
    let abortedAfterFirst = false;
    const outcome = await s.execute(
      tasks,
      async (task) => {
        if (task.id === 'a') {
          controller.abort();
          abortedAfterFirst = true;
        }
        return okRun(task);
      },
      ctx,
    );
    expect(abortedAfterFirst).toBe(true);
    expect(outcome.cancelled).toBe(true);
    // a executed; b/c never ran because the loop broke after the batch.
    const ran = outcome.results.filter((r) => r.status === 'SUCCEEDED').map((r) => r.taskId);
    expect(ran.length).toBeLessThanOrEqual(1);
  });

  it('runs independent tasks in parallel', async () => {
    const clock = new ManualClock();
    const ctx = makeContext('r', clock);
    const s = scheduler(clock);
    let active = 0;
    let peak = 0;
    const tasks = [
      makeTask({ id: 'a', dependsOn: [], timeoutMs: 0 }),
      makeTask({ id: 'b', dependsOn: [], timeoutMs: 0 }),
      makeTask({ id: 'c', dependsOn: [], timeoutMs: 0 }),
    ];
    await s.execute(
      tasks,
      async (task) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return okRun(task);
      },
      ctx,
    );
    expect(peak).toBeGreaterThan(1);
  });

  it('respects maxParallelism', async () => {
    const clock = new ManualClock();
    const ctx = makeContext('r', clock);
    const s = scheduler(clock, { maxParallelism: 2 });
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 6 }, (_, i) =>
      makeTask({ id: `t${i}`, dependsOn: [], timeoutMs: 0 }),
    );
    await s.execute(
      tasks,
      async (task) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return okRun(task);
      },
      ctx,
    );
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('posts assigned + completion messages in deterministic order', async () => {
    const clock = new ManualClock();
    const ctx = makeContext('r', clock);
    const s = scheduler(clock);
    await s.execute(
      [makeTask({ id: 'a', dependsOn: [] }), makeTask({ id: 'b', dependsOn: ['a'] })],
      okRun,
      ctx,
    );
    const types = ctx.conversation.all().map((m) => m.type);
    const firstAssigned = types.indexOf('TASK_ASSIGNED');
    const succeeded = types.filter((t) => t === 'TASK_SUCCEEDED');
    expect(succeeded).toHaveLength(2);
    expect(firstAssigned).toBeLessThan(types.indexOf('TASK_SUCCEEDED'));
  });

  it('is deterministic in messages and results', async () => {
    const run = async () => {
      const clock = new ManualClock();
      const ctx = makeContext('r', clock);
      const s = scheduler(clock);
      const outcome = await s.execute(
        [makeTask({ id: 'a', dependsOn: [] }), makeTask({ id: 'b', dependsOn: ['a'] })],
        okRun,
        ctx,
      );
      return { results: outcome.results, messages: ctx.conversation.all() };
    };
    const first = await run();
    const second = await run();
    expect(first.results).toEqual(second.results);
    expect(first.messages).toEqual(second.messages);
  });

  it('posts skipped messages for dependent failures', async () => {
    const clock = new ManualClock();
    const ctx = makeContext('r', clock);
    const s = scheduler(clock);
    await s.execute(
      [makeTask({ id: 'a', dependsOn: [] }), makeTask({ id: 'b', dependsOn: ['a'] })],
      async (task) => (task.id === 'a' ? failRun('MA_X', false)(task) : okRun(task)),
      ctx,
    );
    const skipped = ctx.conversation.byType('TASK_SKIPPED');
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.taskId).toBe('b');
  });
});