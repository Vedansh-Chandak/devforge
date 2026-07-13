import { describe, it, expect } from "vitest";
import { calculateMedian, calculateStats } from "./runner.js";

describe("Benchmark utilities", () => {
  it("should calculate median correctly", () => {
    const results = [
      { timings: { totalMs: 10 } } as any,
      { timings: { totalMs: 20 } } as any,
      { timings: { totalMs: 30 } } as any,
    ];
    
    const median = calculateMedian(results);
    expect(median.timings.totalMs).toBe(20);
  });

  it("should calculate stats correctly", () => {
    const results = [
      { timings: { totalMs: 10 } } as any,
      { timings: { totalMs: 20 } } as any,
      { timings: { totalMs: 30 } } as any,
      { timings: { totalMs: 40 } } as any,
      { timings: { totalMs: 50 } } as any,
    ];
    
    const stats = calculateStats(results);
    expect(stats.min).toBe(10);
    expect(stats.max).toBe(50);
    expect(stats.median).toBe(30);
    expect(stats.mean).toBe(30);
  });
});
