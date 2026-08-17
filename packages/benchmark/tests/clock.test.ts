import { describe, expect, it } from "vitest";
import { elapsed, FakeClock, SystemClock } from "../src/clock.js";

describe("FakeClock", () => {
  it("starts at zero by default", () => {
    expect(new FakeClock().now()).toBe(0);
  });

  it("starts at the given offset", () => {
    expect(new FakeClock(500).now()).toBe(500);
  });

  it("advance moves time forward monotonically", () => {
    const clock = new FakeClock();
    clock.advance(25);
    expect(clock.now()).toBe(25);
    clock.advance(100);
    expect(clock.now()).toBe(125);
  });

  it("set pins the exact timestamp", () => {
    const clock = new FakeClock();
    clock.set(999);
    expect(clock.now()).toBe(999);
    clock.set(123);
    expect(clock.now()).toBe(123);
  });

  it("advance accepts negative deltas (test-only flexibility)", () => {
    const clock = new FakeClock(10);
    clock.advance(-3);
    expect(clock.now()).toBe(7);
  });
});

describe("SystemClock", () => {
  it("reports wall-clock millisecond timestamps", () => {
    const before = Date.now();
    const value = new SystemClock().now();
    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(Date.now());
  });

  it("is callable repeatedly", () => {
    const clock = new SystemClock();
    const first = clock.now();
    expect(clock.now()).toBeGreaterThanOrEqual(first);
  });
});

describe("elapsed", () => {
  it("returns the difference between two reads", () => {
    expect(elapsed(100, 250)).toBe(150);
  });

  it("never returns a negative value", () => {
    expect(elapsed(250, 100)).toBe(0);
  });

  it("returns zero for identical timestamps", () => {
    expect(elapsed(42, 42)).toBe(0);
  });
});