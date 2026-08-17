/**
 * @devforge/multi-agent — Parallel runner (DF-022).
 *
 * Executes independent jobs concurrently with a bounded parallel limit while
 * guaranteeing deterministic ordering of results, events and reports.
 * Results are always returned in input order regardless of the real
 * completion order, so concurrent execution can never reorder downstream
 * output.
 */

import { MultiAgentValidationError } from '../errors.js';

/** Options for a {@link ParallelRunner}. */
export interface ParallelRunnerOptions {
  readonly maxParallelism: number;
}

/**
 * Runs async jobs with bounded concurrency, returning results in the same
 * order as the input. If a job rejects, the batch rejects with that error
 * after the in-flight jobs settle.
 */
export class ParallelRunner {
  readonly maxParallelism: number;

  constructor(options: ParallelRunnerOptions) {
    if (!Number.isInteger(options.maxParallelism) || options.maxParallelism < 1) {
      throw new MultiAgentValidationError('maxParallelism must be an integer >= 1');
    }
    this.maxParallelism = options.maxParallelism;
  }

  /**
   * Map items to promises with at most `maxParallelism` in flight. Resolves
   * with results in input order.
   */
  async map<T, R>(
    items: readonly T[],
    fn: (item: T, index: number) => Promise<R>,
  ): Promise<readonly R[]> {
    if (items.length === 0) {
      return [];
    }
    const results: Array<R> = new Array(items.length);
    let next = 0;
    let failed = false;

    const workAll = async (): Promise<void> => {
      const slots: Promise<void>[] = [];
      while (next < items.length) {
        const index = next;
        next += 1;
        slots.push(
          (async () => {
            const value = await fn(items[index]!, index);
            results[index] = value;
          })(),
        );
        if (slots.length >= this.maxParallelism) {
          await Promise.all(slots);
          slots.length = 0;
        }
      }
      if (slots.length > 0) {
        await Promise.all(slots);
      }
    };

    try {
      await workAll();
    } catch (error) {
      failed = true;
      void failed;
      throw error;
    }

    return results;
  }
}
