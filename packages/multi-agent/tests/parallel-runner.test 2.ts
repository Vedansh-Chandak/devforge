import { describe, expect, it, vi } from 'vitest';
import { ParallelRunner } from '../src/execution/parallel-runner.js';
import { MultiAgentValidationError } from '../src/errors.js';

const tick = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('ParallelRunner', () => {
  it('rejects invalid parallelism', () => {
    expect(() => new ParallelRunner({ maxParallelism: 0 })).toThrow(MultiAgentValidationError);
    expect(() => new ParallelRunner({ maxParallelism: 1.5 })).toThrow(MultiAgentValidationError);
  });

  it('accepts a valid limit', () => {
    const runner = new ParallelRunner({ maxParallelism: 1 });
    expect(runner.maxParallelism).toBe(1);
  });

  it('returns empty for empty input', async () => {
    const runner = new ParallelRunner({ maxParallelism: 3 });
    expect(await runner.map([], async () => 1)).toEqual([]);
  });

  it('returns results in input order regardless of completion order', async () => {
    const runner = new ParallelRunner({ maxParallelism: 3 });
    const items = ['a', 'b', 'c'];
    const delays: Record<string, number> = { a: 30, b: 5, c: 15 };
    const out = await runner.map(items, async (item) => {
      await tick(delays[item]);
      return item;
    });
    expect(out).toEqual(['a', 'b', 'c']);
  });

  it('limits concurrency to maxParallelism', async () => {
    const runner = new ParallelRunner({ maxParallelism: 2 });
    let active = 0;
    let peak = 0;
    await runner.map([1, 2, 3, 4, 5], async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await tick(10);
      active -= 1;
      return item;
    });
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('runs single-limit sequentially', async () => {
    const runner = new ParallelRunner({ maxParallelism: 1 });
    const calls: number[] = [];
    await runner.map([1, 2, 3], async (item) => {
      calls.push(item);
      await tick(5);
      return item;
    });
    expect(calls).toEqual([1, 2, 3]);
  });

  it('propagates a rejection', async () => {
    const runner = new ParallelRunner({ maxParallelism: 2 });
    await expect(
      runner.map([1, 2, 3], async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });

  it('is deterministic across repeated runs', async () => {
    const runner = new ParallelRunner({ maxParallelism: 4 });
    const run = async () =>
      runner.map(
        ['x', 'y', 'z', 'w'],
        async (v) => {
          await tick(10);
          return v;
        },
      );
    expect(await run()).toEqual(await run());
  });

  it('handles more items than slots', async () => {
    const runner = new ParallelRunner({ maxParallelism: 2 });
    const out = await runner.map(Array.from({ length: 9 }, (_, i) => i), async (n) => {
      await tick(1);
      return n * 2;
    });
    expect(out).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16]);
  });

  it('rejects non-integer and zero parallelism', () => {
    expect(() => new ParallelRunner({ maxParallelism: 2.5 })).toThrow(MultiAgentValidationError);
    expect(() => new ParallelRunner({ maxParallelism: -1 })).toThrow(MultiAgentValidationError);
    expect(() => new ParallelRunner({ maxParallelism: NaN })).toThrow(MultiAgentValidationError);
  });

  it('never invokes the mapper for empty input', async () => {
    const runner = new ParallelRunner({ maxParallelism: 3 });
    const fn = vi.fn(async () => 0);
    await runner.map([], fn);
    expect(fn).not.toHaveBeenCalled();
  });

  it('passes the item index to the mapper', async () => {
    const runner = new ParallelRunner({ maxParallelism: 3 });
    const seen: Array<[string, number]> = [];
    await runner.map(['a', 'b'], async (item, index) => {
      seen.push([item, index]);
      return index;
    });
    expect(seen).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
  });

  it('handles a single item without hanging', async () => {
    const runner = new ParallelRunner({ maxParallelism: 4 });
    expect(await runner.map(['only'], async (v) => v.toUpperCase())).toEqual(['ONLY']);
  });

  it('rejects with the first error when multiple items fail in parallel', async () => {
    const runner = new ParallelRunner({ maxParallelism: 3 });
    await expect(
      runner.map([1, 2, 3], async () => {
        throw new Error('kaboom');
      }),
    ).rejects.toThrow('kaboom');
  });

  it('completes all in-flight work even when one limb rejects late', async () => {
    const runner = new ParallelRunner({ maxParallelism: 2 });
    const done: number[] = [];
    await expect(
      runner.map([1, 2, 3], async (n) => {
        if (n === 3) throw new Error('boom');
        await tick(5);
        done.push(n);
        return n;
      }),
    ).rejects.toThrow('boom');
    expect(done.sort()).toEqual([1, 2]);
  });

  it('keeps results ordered even with a large task count and limit one', async () => {
    const runner = new ParallelRunner({ maxParallelism: 1 });
    const out = await runner.map(Array.from({ length: 20 }, (_, i) => i), async (n) => {
      await tick(0);
      return n;
    });
    expect(out).toHaveLength(20);
    expect(out[0]).toBe(0);
    expect(out[19]).toBe(19);
  });
});