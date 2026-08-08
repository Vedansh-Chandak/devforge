import { describe, expect, it } from 'vitest';
import { TaskManager } from '../task-manager.js';
import type { AgentResult } from '../types.js';
import { terminalResult } from './task-helpers.js';

function okResult(): AgentResult {
  return terminalResult('VERIFICATION_PASSED');
}

describe('TaskManager.enqueue', () => {
  it('returns the new queue length', () => {
    const manager = new TaskManager(async () => okResult());
    expect(manager.enqueue({ id: 'a', goal: 'g' })).toBe(1);
    expect(manager.enqueue({ id: 'b', goal: 'g' })).toBe(2);
  });

  it('rejects an empty task id', () => {
    const manager = new TaskManager(async () => okResult());
    expect(() => manager.enqueue({ id: '', goal: 'g' })).toThrow('Task id');
  });

  it('enforces the queue limit', () => {
    const manager = new TaskManager(async () => okResult(), { queueLimit: 2 });
    manager.enqueue({ id: 'a', goal: 'g' });
    manager.enqueue({ id: 'b', goal: 'g' });
    expect(() => manager.enqueue({ id: 'c', goal: 'g' })).toThrow('queue full');
  });

  it('reports pending tasks before drain', () => {
    const manager = new TaskManager(async () => okResult());
    manager.enqueue({ id: 'a', goal: 'g' });
    expect(manager.pending).toBe(1);
    expect(manager.isEmpty).toBe(false);
  });
});

describe('TaskManager.drain', () => {
  it('runs tasks in insertion order', async () => {
    const order: string[] = [];
    const manager = new TaskManager(async (task) => {
      order.push(task.id);
      return okResult();
    });
    manager.enqueue({ id: 'one', goal: 'g' });
    manager.enqueue({ id: 'two', goal: 'g' });
    const report = await manager.drain();
    expect(order).toEqual(['one', 'two']);
    expect(report.map((outcome) => outcome.task.id)).toEqual(['one', 'two']);
    expect(manager.completed).toBe(2);
    expect(manager.succeeded).toBe(2);
  });

  it('records a completed outcome with a result', async () => {
    const manager = new TaskManager(async () => okResult());
    manager.enqueue({ id: 'a', goal: 'g' });
    const [outcome] = await manager.drain();
    expect(outcome?.status).toBe('COMPLETED');
    expect(outcome?.result?.outcome).toBe('SUCCESS');
    expect(outcome?.error).toBeNull();
  });

  it('records a failed outcome when a task rejects', async () => {
    const manager = new TaskManager(async () => {
      throw new Error('no plan');
    });
    manager.enqueue({ id: 'a', goal: 'g' });
    const [outcome] = await manager.drain();
    expect(outcome?.status).toBe('FAILED');
    expect(outcome?.result).toBeNull();
    expect(outcome?.error?.message).toBe('no plan');
  });

  it('continues after a task failure', async () => {
    const manager = new TaskManager(async (task) => {
      if (task.id === 'bad') throw new Error('nope');
      return okResult();
    });
    manager.enqueue({ id: 'bad', goal: 'g' });
    manager.enqueue({ id: 'good', goal: 'g' });
    const report = await manager.drain();
    expect(report.map((outcome) => outcome.status)).toEqual(['FAILED', 'COMPLETED']);
  });

  it('passes the cancellation signal to the runner', async () => {
    let sawSignal: AbortSignal | undefined;
    const manager = new TaskManager(async (_task, signal) => {
      sawSignal = signal;
      return okResult();
    });
    manager.enqueue({ id: 'a', goal: 'g' });
    await manager.drain();
    expect(sawSignal?.aborted).toBe(false);
    expect(manager.isRunning).toBe(false);
  });

  it('stops after the configured stopAfter count', async () => {
    const order: string[] = [];
    const manager = new TaskManager(async (task) => {
      order.push(task.id);
      return okResult();
    }, { stopAfter: 2 });
    manager.enqueue({ id: 'a', goal: 'g' });
    manager.enqueue({ id: 'b', goal: 'g' });
    manager.enqueue({ id: 'c', goal: 'g' });
    await manager.drain();
    expect(order).toEqual(['a', 'b']);
    expect(manager.completed).toBe(2);
  });

  it('refuses to drain twice', async () => {
    const manager = new TaskManager(async () => okResult());
    manager.enqueue({ id: 'a', goal: 'g' });
    await manager.drain();
    await expect(manager.drain()).rejects.toThrow('already drained');
  });
});

describe('TaskManager.cancel', () => {
  it('cancels pending tasks during drain', async () => {
    const manager = new TaskManager(
      async (_task, signal) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (signal?.aborted) throw new Error('aborted');
        return okResult();
      },
    );
    manager.enqueue({ id: 'a', goal: 'g' });
    manager.enqueue({ id: 'b', goal: 'g' });
    const draining = manager.drain();
    await new Promise((resolve) => setTimeout(resolve, 0));
    manager.cancel('cancel now');
    const report = await draining;
    expect(manager.cancelledFlag).toBe(true);
    expect(report.every((outcome) => outcome.status !== 'COMPLETED')).toBe(true);
  });

  it('marks tasks that never started as cancelled', async () => {
    const manager = new TaskManager(
      async (_task, signal) => {
        await new Promise((resolve) => setTimeout(resolve, 8));
        if (signal?.aborted) throw new Error('aborted');
        return okResult();
      },
    );
    manager.enqueue({ id: 'a', goal: 'g' });
    manager.enqueue({ id: 'b', goal: 'g' });
    const draining = manager.drain();
    await new Promise((resolve) => setTimeout(resolve, 0));
    manager.cancel('stop');
    const report = await draining;
    expect(report.some((outcome) => outcome.status === 'CANCELLED')).toBe(true);
  });
});

describe('TaskManager.reset', () => {
  it('clears queues, outcome, and cancellation state', async () => {
    const manager = new TaskManager(async () => okResult());
    manager.enqueue({ id: 'a', goal: 'g' });
    await manager.drain();
    manager.reset();
    expect(manager.pending).toBe(0);
    expect(manager.completed).toBe(0);
    expect(manager.cancelledFlag).toBe(false);
    manager.enqueue({ id: 'b', goal: 'g' });
    const report = await manager.drain();
    expect(report.map((outcome) => outcome.task.id)).toEqual(['b']);
  });
});

describe('TaskManager.report', () => {
  it('exposes a snapshot of the outcomes', async () => {
    const manager = new TaskManager(async () => okResult());
    expect(manager.report).toEqual([]);
    manager.enqueue({ id: 'a', goal: 'g' });
    await manager.drain();
    expect(manager.report).toHaveLength(1);
  });
});