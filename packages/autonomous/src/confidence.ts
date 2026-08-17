/**
 * @devforge/autonomous — Confidence engine (DF-019).
 *
 * Every generated patch receives a deterministic confidence score: how likely
 * it is to succeed, how risky it is, expected success, and estimated impact.
 * The agent only continues automatically when confidence clears the
 * configured threshold; below it the run pauses for confirmation.
 */

import type { CodePatch } from '@devforge/execution';
import type { ConfidenceScore, RiskLevel } from './types.js';

/** Context supplied to an evaluator when scoring a patch set. */
export interface ConfidenceContext {
  readonly goal: string;
  readonly attempt: number;
  /** Number of consecutive verification failures so far this run. */
  readonly failures: number;
  /** Whether each targeted file is known to exist already. */
  readonly existingFiles?: Readonly<Record<string, boolean>>;
}

/** Injectable confidence evaluator. */
export interface ConfidenceEvaluator {
  readonly name?: string;
  evaluate(patches: readonly CodePatch[], context: ConfidenceContext): ConfidenceScore;
}

/** Ordinal ranking of risk levels (higher is riskier). */
export const RISK_ORDER: readonly RiskLevel[] = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
] as const;

/** Ordering comparison for two risk levels. */
export function compareRisk(a: RiskLevel, b: RiskLevel): number {
  return RISK_ORDER.indexOf(a) - RISK_ORDER.indexOf(b);
}

/** Coarse risk derived from the patch operations. Pure and deterministic. */
export function riskOf(patches: readonly CodePatch[]): RiskLevel {
  if (patches.length === 0) return 'LOW';
  if (patches.some((patch) => patch.operation === 'DELETE')) return 'CRITICAL';
  if (patches.length > 3) return 'HIGH';
  if (patches.some((patch) => patch.operation === 'MODIFY')) return 'HIGH';
  return 'MEDIUM';
}

/** Clamp a number into [0, 1]. */
export function clamp01(value: number, decimals = 2): number {
  const clamped = Math.max(0, Math.min(1, value));
  return Number(clamped.toFixed(decimals));
}

/**
 * Deterministic heuristic evaluator. Same patches + same context always
 * yields the same score; scores are cheap to reason about in tests.
 */
export class DeterministicConfidenceEvaluator implements ConfidenceEvaluator {
  readonly name = 'deterministic';

  evaluate(
    patches: readonly CodePatch[],
    context: ConfidenceContext,
  ): ConfidenceScore {
    const reasons: string[] = [];

    let confidence = 0.5;
    let wellFormed = true;
    for (const patch of patches) {
      const hasContent = (patch.newContent ?? '').length > 0;
      const validOperation = ['CREATE', 'MODIFY', 'DELETE'].includes(patch.operation);
      if (patch.file.length === 0) wellFormed = false;
      if (patch.operation === 'CREATE' && !hasContent) wellFormed = false;
      if (!validOperation) wellFormed = false;
    }

    if (patches.length === 0) {
      reasons.push('empty patch set is untrustworthy');
      confidence = 0.1;
    } else {
      if (wellFormed) {
        confidence += 0.15;
        reasons.push('patch set is well formed');
      } else {
        reasons.push('patch set has malformed entries');
      }
      if (wellFormed && patches.length === 1) {
        confidence += 0.1;
        reasons.push('single-file change');
      }
      if (patches.length > 3) {
        confidence -= 0.15;
        reasons.push('broad change touches many files');
      }
      const destructive = patches.filter((p) => p.operation === 'DELETE').length;
      if (destructive > 0) {
        confidence -= 0.2 * Math.min(destructive, 2);
        reasons.push(`${destructive} delete operation(s) lower confidence`);
      }
      const modifies = patches.filter((p) => p.operation === 'MODIFY').length;
      if (modifies > 0 && patches.length > modifies) {
        confidence -= 0.05;
        reasons.push('mixed operations are riskier');
      }
    }

    const failurePenalty = Math.min(context.failures, 3) * 0.05;
    if (failurePenalty > 0) {
      confidence -= failurePenalty;
      reasons.push(`${context.failures} prior failure(s) lower confidence`);
    }

    const score = clamp01(confidence);

    const risk = riskOf(patches);
    let expectedSuccess = score;
    if (risk === 'LOW') expectedSuccess += 0.05;
    if (risk === 'CRITICAL') expectedSuccess -= 0.1;
    expectedSuccess = clamp01(expectedSuccess);

    const totalChars = patches.reduce(
      (sum, patch) => sum + (patch.newContent?.length ?? 0),
      0,
    );
    const impact = clamp01(
      Math.min(1, patches.length / 4) * 0.5 +
        Math.min(1, totalChars / 8000) * 0.5,
    );

    return {
      confidence: score,
      risk,
      expectedSuccess,
      estimatedImpact: impact,
      reasons,
    };
  }
}

/** Convenience constructor for the deterministic evaluator. */
export function deterministicConfidence(): ConfidenceEvaluator {
  return new DeterministicConfidenceEvaluator();
}

/** A fixed-score evaluator used to script deterministic confidence values. */
export function fixedConfidence(score: Partial<ConfidenceScore> = {}): ConfidenceEvaluator {
  return {
    name: 'fixed',
    evaluate(): ConfidenceScore {
      return {
        confidence: score.confidence ?? 0.8,
        risk: score.risk ?? 'MEDIUM',
        expectedSuccess: score.expectedSuccess ?? score.confidence ?? 0.8,
        estimatedImpact: score.estimatedImpact ?? 0.5,
        reasons: score.reasons ?? ['fixed score'],
      };
    },
  };
}

// ── Gate ───────────────────────────────────────────────────────────────

/** Outcome of a thorough gate check. */
export interface ConfidenceGateDecision {
  readonly pass: boolean;
  readonly threshold: number;
  readonly score: number;
  readonly message: string;
}

/** Threshold guard that decides whether the loop may continue. */
export interface ConfidenceGate {
  readonly threshold: number;
  check(score: ConfidenceScore): ConfidenceGateDecision;
}

/** True when the score clears the threshold. */
export function clearsThreshold(score: ConfidenceScore, threshold: number): boolean {
  return score.confidence >= threshold;
}

/** Default threshold gate implementation. */
export class DefaultConfidenceGate implements ConfidenceGate {
  constructor(readonly threshold: number) {}

  check(score: ConfidenceScore): ConfidenceGateDecision {
    const pass = clearsThreshold(score, this.threshold);
    return {
      pass,
      threshold: this.threshold,
      score: score.confidence,
      message: pass
        ? `confidence ${score.confidence} meets threshold ${this.threshold}`
        : `confidence ${score.confidence} below threshold ${this.threshold}`,
    };
  }
}

/** Factory for a (optionally fixed) gate. */
export function confidenceGate(threshold = 0.7): ConfidenceGate {
  return new DefaultConfidenceGate(threshold);
}

/** Highest confidence across a batch, or null when empty. */
export function maxConfidence(scores: readonly ConfidenceScore[]): ConfidenceScore | null {
  let best: ConfidenceScore | null = null;
  for (const score of scores) {
    if (!best || score.confidence > best.confidence) best = score;
  }
  return best;
}