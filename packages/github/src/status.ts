/**
 * @devforge/github — Status (DF-021).
 *
 * Small, pure helpers that translate internal states into GitHub check-run
 * status/conclusion values and human-readable status strings. Deterministic.
 */

import type { CheckRun, CheckRunConclusion, CheckRunStatus } from './types.js';

/** All valid check run statuses. */
export const CHECK_STATUSES: readonly CheckRunStatus[] = ['queued', 'in_progress', 'completed'];

/** All valid check run conclusions. */
export const CHECK_CONCLUSIONS: readonly CheckRunConclusion[] = [
  'success',
  'failure',
  'neutral',
  'cancelled',
  'timed_out',
  'action_required',
  'stale',
  'skipped',
];

/** Whether a status value is a valid check run status. */
export function isCheckStatus(value: string): value is CheckRunStatus {
  return (CHECK_STATUSES as readonly string[]).includes(value);
}

/** Whether a conclusion value is a valid check run conclusion. */
export function isCheckConclusion(value: string): value is CheckRunConclusion {
  return (CHECK_CONCLUSIONS as readonly string[]).includes(value);
}

/** A successful/failed state that maps to a conclusion. */
export type PassState = 'pass' | 'fail';

/** Map a boolean verification result to a GitHub conclusion. */
export function conclusionForPass(passed: boolean): CheckRunConclusion {
  return passed ? 'success' : 'failure';
}

/** Map an outcome to a conclusion. */
export function conclusionForOutcome(outcome: 'success' | 'failed' | 'cancelled' | 'timed_out'): CheckRunConclusion {
  switch (outcome) {
    case 'success':
      return 'success';
    case 'failed':
      return 'failure';
    case 'cancelled':
      return 'cancelled';
    case 'timed_out':
      return 'timed_out';
  }
}

/** Human-readable label for a check run status. */
export function statusLabel(status: CheckRunStatus): string {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'in_progress':
      return 'In progress';
    case 'completed':
      return 'Completed';
  }
}

/** Human-readable label for a conclusion. */
export function conclusionLabel(conclusion: CheckRunConclusion): string {
  switch (conclusion) {
    case 'success':
      return 'Success';
    case 'failure':
      return 'Failure';
    case 'neutral':
      return 'Neutral';
    case 'cancelled':
      return 'Cancelled';
    case 'timed_out':
      return 'Timed out';
    case 'action_required':
      return 'Action required';
    case 'stale':
      return 'Stale';
    case 'skipped':
      return 'Skipped';
  }
}

/** Whether a conclusion represents a passing run. */
export function isPassing(conclusion: CheckRunConclusion | null): boolean {
  return conclusion === 'success' || conclusion === 'neutral' || conclusion === 'skipped';
}

/** Whether a conclusion represents a failed run. */
export function isFailing(conclusion: CheckRunConclusion | null): boolean {
  return conclusion === 'failure' || conclusion === 'timed_out' || conclusion === 'cancelled' || conclusion === 'action_required';
}

/** A compact, single-line status for a check run. */
export function summarizeCheckRun(check: CheckRun): string {
  if (check.status === 'completed' && check.conclusion !== null) {
    return `${check.name}: ${conclusionLabel(check.conclusion)}`;
  }
  return `${check.name}: ${statusLabel(check.status)}`;
}

/** Build a short status line for a workflow failure analysis. */
export function failureStatusLine(failedJobs: number, failedSteps: number): string {
  return `${failedJobs} failed job(s), ${failedSteps} failed step(s)`;
}
