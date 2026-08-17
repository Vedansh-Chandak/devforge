import { describe, expect, it } from "vitest";
import {
  appendEvent,
  Cancellation,
  Deadline,
  FakeAsyncRuntime,
  messageOf,
  runCooperative,
  SequentialQueue,
  SystemAsyncRuntime,
  TaskRunContext,
  withTimeout,
} from "../src/execution.js";
import { CancelledError, TimeoutError } from "../src/errors.js";
import { FakeClock } from "../src/clock.js";
import { makeTask } from "./helpers.js";

describe("Cancellation", () => {
  it("is not cancelled by default", () => {
    expect(new Cancellation().cancelled).toBe(false);
  });

  it("becomes cancelled after cancel()", () => {
    const cancellation = new Cancellation();
    cancellation.cancel();
    expect(cancellation.cancelled).toBe(true);
  });

  it("is idempotent", () => {
    const cancellation = new Cancellation();
    cancellation.cancel();
    cancellation.cancel();
    expect(cancellation.cancelled).toBe(true);
  });

  it("check throws CancelledError when cancelled", () => {
    const cancellation = new Cancellation();
    cancellation.cancel();
    expect(() => cancellation.check("step")).toThrow(CancelledError);
  });

  it("check does not throw when active", () => {
    expect(() => new Cancellation().check("step")).not.toThrow();
  });
});

describe("Deadline", () => {
  const clock = new FakeClock(100);

  it("reports the full remaining budget at start", () => {
    const deadline = new Deadline(clock.now(), 1000, clock);
    expect(deadline.remainingMs()).toBe(1000);
  });

  it("decreases as the clock advances", () => {
    const clock = new FakeClock(0);
    const deadline = new Deadline(0, 1000, clock);
    clock.advance(400);
    expect(deadline.remainingMs()).toBe(600);
  });

  it("floors remaining time at zero", () => {
    const clock = new FakeClock(0);
    const deadline = new Deadline(0, 100, clock);
    clock.advance(600);
    expect(deadline.remainingMs()).toBe(0);
  });

  it("expired flips when the budget is exhausted", () => {
    const clock = new FakeClock(0);
    const deadline = new Deadline(0, 100, clock);
    clock.advance(100);
    expect(deadline.expired()).toBe(true);
  });

  it("is not expired within the budget", () => {
    expect(new Deadline(0, 1000, new FakeClock(0)).expired()).toBe(false);
  });

  it("check throws TimeoutError when expired", () => {
    const clock = new FakeClock(0);
    const deadline = new Deadline(0, 10, clock);
    clock.advance(10);
    expect(() => deadline.check("test")).toThrow(TimeoutError);
  });

  it("check passes within budget", () => {
    expect(() => new Deadline(0, 10_000, new FakeClock(0)).check("test")).not.toThrow();
  });
});

describe("SystemAsyncRuntime / FakeAsyncRuntime", () => {
  it("system runtime reports its name", () => {
    expect(new SystemAsyncRuntime().name).toBe("system");
  });

  it("system runtime sleeps asynchronously", async () => {
    await new SystemAsyncRuntime().sleep(1);
    expect(true).toBe(true);
  });

  it("fake runtime reports its name", () => {
    expect(new FakeAsyncRuntime(new FakeClock()).name).toBe("fake");
  });

  it("fake runtime returns immediately from sleep", async () => {
    await new FakeAsyncRuntime(new FakeClock()).sleep(10_000);
    expect(true).toBe(true);
  });

  it("fake runtime reads the injected clock", () => {
    const clock = new FakeClock(321);
    expect(new FakeAsyncRuntime(clock).now()).toBe(321);
  });
});

describe("withTimeout", () => {
  it("runs the callback under a fake runtime without timers", async () => {
    const value = await withTimeout(
      async () => 7,
      { timeoutMs: 5, runtime: new FakeAsyncRuntime(new FakeClock()) },
    );
    expect(value).toBe(7);
  });

  it("enforces a hard timeout under the system runtime", async () => {
    let timer: ReturnType<typeof setTimeout>;
    const never = new Promise<void>((_resolve) => {
      timer = setTimeout(() => {}, 60_000);
      void timer;
    });
    await expect(
      withTimeout(async () => never, { timeoutMs: 30, runtime: new SystemAsyncRuntime() }),
    ).rejects.toThrow(TimeoutError);
  });

  it("returns the value when the callback finishes first", async () => {
    const value = await withTimeout(
      async () => "done",
      { timeoutMs: 1000, runtime: new SystemAsyncRuntime() },
    );
    expect(value).toBe("done");
  });
});

describe("runCooperative", () => {
  it("invokes the run against the context", async () => {
    const context = {
      task: makeTask("t"),
      fixture: {} as never,
      clock: new FakeClock(),
      cancellation: new Cancellation(),
      deadline: new Deadline(0, 1000, new FakeClock()),
      attempt: 1,
      events: [],
    } as TaskRunContext;
    let observed: TaskRunContext | undefined;
    await runCooperative(async (ctx) => {
      observed = ctx;
    }, context);
    expect(observed).toBe(context);
  });

  it("throws TimeoutError before starting when the deadline expired", async () => {
    const clock = new FakeClock(0);
    const deadline = new Deadline(0, 0, clock);
    await expect(
      runCooperative(
        async () => {},
        {
          task: makeTask("t"),
          fixture: {} as never,
          clock,
          cancellation: new Cancellation(),
          deadline,
          attempt: 1,
          events: [],
        },
      ),
    ).rejects.toThrow(TimeoutError);
  });

  it("throws CancelledError before starting when already cancelled", async () => {
    const cancellation = new Cancellation();
    cancellation.cancel();
    await expect(
      runCooperative(
        async () => {},
        {
          task: makeTask("t"),
          fixture: {} as never,
          clock: new FakeClock(),
          cancellation,
          deadline: new Deadline(0, 1000, new FakeClock()),
          attempt: 1,
          events: [],
        },
      ),
    ).rejects.toThrow(CancelledError);
  });
});

describe("SequentialQueue", () => {
  it("preserves enqueue order", async () => {
    const queue = new SequentialQueue<number>();
    const order: number[] = [];
    const results = await Promise.all(
      [1, 2, 3].map((value) =>
        queue.enqueue(async () => {
          order.push(value);
          return value;
        }),
      ),
    );
    expect(order).toEqual([1, 2, 3]);
    expect(results).toEqual([1, 2, 3]);
  });

  it("keeps the chain alive after a rejection", async () => {
    const queue = new SequentialQueue<number>();
    await expect(
      queue.enqueue(async () => {
        throw new Error("rejected");
      }),
    ).rejects.toThrow("rejected");
    const value = await queue.enqueue(async () => 42);
    expect(value).toBe(42);
  });
});

describe("appendEvent and messageOf", () => {
  it("appendEvent records messages in call order", () => {
    const events: string[] = [];
    const context = { events } as TaskRunContext;
    appendEvent(context, "first");
    appendEvent(context, "second");
    expect(events).toEqual(["first", "second"]);
  });

  it("messageOf extracts Error messages", () => {
    expect(messageOf(new Error("boom"))).toBe("boom");
  });

  it("messageOf stringifies non-error values", () => {
    expect(messageOf("plain")).toBe("plain");
    expect(messageOf(42)).toBe("42");
  });
});