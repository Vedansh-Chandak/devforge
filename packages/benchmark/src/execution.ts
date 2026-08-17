/**
 * @devforge/benchmark — Execution primitives (DF-024).
 *
 * Deadlines, cancellation, cooperative timing, and the context handed to
 * adapters. All timing flows through an injected runtime so tests drive
 * every wait deterministically.
 */
import type { Clock } from "./clock.js";
import type { RepositoryFixture } from "./repository-fixture.js";
import type { BenchmarkTask } from "./types.js";
import { CancelledError, TimeoutError } from "./errors.js";

/** Cooperative cancellation handle shared by a whole benchmark run. */
export class Cancellation {
  private state = false;

  get cancelled(): boolean {
    return this.state;
  }

  cancel(): void {
    this.state = true;
  }

  /** Throw {@link CancelledError} when cancellation is requested. */
  check(label = "step"): void {
    if (this.state) {
      throw new CancelledError(`cancelled during ${label}`);
    }
  }
}

/** Injectable asynchronous behavior: sleeps and monotonic reads. */
export interface AsyncRuntime {
  readonly name: string;
  sleep(ms: number): Promise<void>;
  now(): number;
}

/** Production runtime backed by `setTimeout` and `Date.now()`. */
export class SystemAsyncRuntime implements AsyncRuntime {
  readonly name = "system";

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  now(): number {
    return Date.now();
  }
}

/**
 * Runtime for deterministic tests: `sleep` returns immediately and `now` is
 * driven by an injected {@link FakeClock}, so time only moves when the test
 * advances it.
 */
export class FakeAsyncRuntime implements AsyncRuntime {
  readonly name = "fake";

  constructor(private readonly clock: Clock) {}

  sleep(_ms: number): Promise<void> {
    return Promise.resolve();
  }

  now(): number {
    return this.clock.now();
  }
}

/** Countdown enforced cooperatively by adapters between steps. */
export class Deadline {
  constructor(
    private readonly startedAtMs: number,
    private readonly windowMs: number,
    private readonly clock: Clock,
  ) {}

  /** Milliseconds remaining, floors at zero. */
  remainingMs(): number {
    return Math.max(0, this.windowMs - (this.clock.now() - this.startedAtMs));
  }

  /** True when the budget is exhausted. */
  expired(): boolean {
    return this.remainingMs() === 0;
  }

  /** Throw {@link TimeoutError} when the budget is exhausted. */
  check(label = "execution"): void {
    if (this.expired()) {
      throw new TimeoutError(`deadline exceeded during ${label}`);
    }
  }
}

/** Context adapters receive for each task attempt. */
export interface TaskRunContext {
  readonly task: BenchmarkTask;
  readonly fixture: RepositoryFixture;
  readonly clock: Clock;
  readonly cancellation: Cancellation;
  readonly deadline: Deadline;
  readonly attempt: number;
  /** Ordered, non-secret notes appended by integration adapters. */
  readonly events: readonly string[];
}

/** A read-only event log append function for adapters. */
export type EventAppender = (message: string) => void;

/** Append to the event log with deterministic ordering (call order). */
export function appendEvent(context: TaskRunContext, message: string): void {
  (context as TaskRunContext & { events: string[] }).events.push(message);
}

/** Run with timeout in a non-cooperative discipline (real sleep only). */
export async function withTimeout<T>(
  run: () => Promise<T>,
  { timeoutMs, runtime }: { timeoutMs: number; runtime: AsyncRuntime },
): Promise<T> {
  if (runtime.name !== "system") {
    // Deterministic runtime: time cannot pass on its own, so the budget is
    // enforced purely through the cooperative Deadline.
    return run();
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError("hard timeout")), timeoutMs);
  });
  try {
    return await Promise.race([run(), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Guard a run with cooperative deadline+cancellation checks. */
export async function runCooperative<T>(
  run: (ctx: TaskRunContext) => Promise<T>,
  ctx: TaskRunContext,
): Promise<T> {
  ctx.deadline.check("start");
  ctx.cancellation.check("start");
  const value = await run(ctx);
  ctx.deadline.check("finish");
  ctx.cancellation.check("finish");
  return value;
}

/** A simple sequential queue preserving call order (deterministic). */
export class SequentialQueue<T> {
  private pending: Promise<T | undefined> = Promise.resolve(undefined);

  enqueue(fn: () => Promise<T>): Promise<T> {
    const run = this.pending.then(fn);
    this.pending = run.catch(() => undefined);
    return run;
  }
}

/** Built-in error helpers reused across the framework. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}