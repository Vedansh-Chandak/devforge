/**
 * @devforge/benchmark — Injectable clocks (DF-024).
 *
 * All timing in the framework flows through a {@link Clock} so tests can fix
 * timestamps and durations deterministically. The system clock is the only
 * production implementation; tests use a {@link FakeClock}.
 */

/** A source of wall-clock milliseconds since the Unix epoch. */
export interface Clock {
  now(): number;
}

/** Production clock backed by `Date.now()`. */
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

/**
 * Deterministic, manually-driven clock for tests and reproducible runs.
 * Values ascend monotonically from its start.
 */
export class FakeClock implements Clock {
  private time: number;

  constructor(start = 0) {
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  /** Pin the clock to an absolute timestamp. */
  set(time: number): void {
    this.time = time;
  }

  /** Advance the clock by a fixed number of milliseconds. */
  advance(deltaMs: number): void {
    this.time += deltaMs;
  }
}

/** Elapsed milliseconds between two clock reads, never negative. */
export function elapsed(startedAtMs: number, now: number): number {
  return Math.max(0, now - startedAtMs);
}