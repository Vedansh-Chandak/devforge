/**
 * @devforge/benchmark — Scoring (DF-024).
 *
 * Deterministic composite scoring of a run from its metrics. Only measured
 * (non-null) components contribute; missing components renormalize the
 * weights so a partial metric set never skews the total.
 */
import type { BenchmarkMetrics } from "./metrics.js";
import { roundTo } from "./metrics.js";

export interface ScoreWeights {
  readonly successRate?: number;
  readonly verificationRate?: number;
  readonly testPassRate?: number;
  readonly buildRate?: number;
  readonly repairRate?: number;
  readonly regressionRate?: number;
  readonly latencyRate?: number;
}

export interface ComponentEntry {
  readonly rate: number | null;
  readonly weight: number;
}

export interface BenchmarkScore {
  readonly total: number;
  readonly components: Record<string, number>;
  readonly weights: Record<string, number>;
}

const RATE_KEYS: Record<string, keyof BenchmarkMetrics> = {
  successRate: "taskSuccessRate",
  verificationRate: "verificationSuccessRate",
  testPassRate: "testPassRate",
  buildRate: "buildSuccessRate",
  repairRate: "repairSuccessRate",
  regressionRate: "regressionRate",
};

/** Deterministic weighted score over measured rates. */
export function scoreBenchmark(
  metrics: BenchmarkMetrics,
  weights: ScoreWeights = {},
): BenchmarkScore {
  const resolved: Record<string, { rate: number | null; weight: number }> = {};
  for (const [label, metricKey] of Object.entries(RATE_KEYS)) {
    const weight = (weights as Record<string, number | undefined>)[label] ?? 1;
    resolved[label] = {
      rate: metrics[metricKey] as number | null,
      weight,
    };
  }
  // Latency enters negatively: below a floor it earns full credit.
  const latencyRate = latencyRateFrom(metrics.medianExecutionTimeMs);
  resolved.latencyRate = { rate: latencyRate, weight: weights.latencyRate ?? 0.5 };

  let appliedWeight = 0;
  let total = 0;
  const components: Record<string, number> = {};
  const appliedWeights: Record<string, number> = {};
  for (const [label, entry] of Object.entries(resolved)) {
    if (entry.rate === null) continue;
    if (entry.weight <= 0) continue;
    appliedWeight += entry.weight;
    total += entry.rate * entry.weight;
    components[label] = roundTo(entry.rate, 6);
    appliedWeights[label] = entry.weight;
  }
  const score =
    appliedWeight === 0 ? 0 : Math.max(0, Math.min(1, total / appliedWeight));
  return {
    total: roundTo(score, 6),
    components,
    weights: appliedWeights,
  };
}

function latencyRateFrom(medianMs: number | null): number | null {
  if (medianMs === null) return null;
  // 60s and below earns full credit; 10 minutes earns zero credit, linear in between.
  const floorMs = 60 * 1000;
  const ceilingMs = 10 * 60 * 1000;
  if (medianMs <= floorMs) return 1;
  if (medianMs >= ceilingMs) return 0;
  return roundTo(1 - (medianMs - floorMs) / (ceilingMs - floorMs));
}

/** Simple task score: 1 for a pass, 0 otherwise. */
export function scoreTaskPass(passed: boolean): number {
  return passed ? 1 : 0;
}

/** Order benchmark results by decaying score, then stable id tie-break. */
export function rankBenchmarks<T extends { readonly score?: unknown; readonly resultId: string }>(
  runs: readonly T[],
  scoreOf: (run: T) => number,
): T[] {
  return Array.from(runs).sort((a, b) => {
    const scoreDelta = scoreOf(b) - scoreOf(a);
    if (scoreDelta !== 0) return scoreDelta > 0 ? 1 : -1;
    return a.resultId < b.resultId ? -1 : a.resultId > b.resultId ? 1 : 0;
  });
}