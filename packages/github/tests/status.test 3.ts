/**
 * Status helper tests (DF-021).
 *
 * Covers check-run status/conclusion validation, outcome mapping, human
 * labels, pass/fail interpretation, and compact summaries.
 */

import { describe, expect, it } from 'vitest';
import {
  CHECK_STATUSES,
  CHECK_CONCLUSIONS,
  isCheckStatus,
  isCheckConclusion,
  conclusionForPass,
  conclusionForOutcome,
  statusLabel,
  conclusionLabel,
  isPassing,
  isFailing,
  summarizeCheckRun,
  failureStatusLine,
} from '../src/status.js';
import type { CheckRun } from '../src/types.js';

describe('status constants & validation', () => {
  it('exposes the full set of statuses and conclusions', () => {
    expect(CHECK_STATUSES).toEqual(['queued', 'in_progress', 'completed']);
    expect(CHECK_CONCLUSIONS).toHaveLength(8);
    expect(CHECK_CONCLUSIONS).toContain('success');
    expect(CHECK_CONCLUSIONS).toContain('failure');
  });

  it('validates status values', () => {
    expect(isCheckStatus('in_progress')).toBe(true);
    expect(isCheckStatus('completed')).toBe(true);
    expect(isCheckStatus('banana')).toBe(false);
  });

  it('validates conclusion values', () => {
    expect(isCheckConclusion('success')).toBe(true);
    expect(isCheckConclusion('timed_out')).toBe(true);
    expect(isCheckConclusion('startup_failure')).toBe(false);
  });
});

describe('conclusion mapping', () => {
  it('maps pass/fail booleans to success/failure', () => {
    expect(conclusionForPass(true)).toBe('success');
    expect(conclusionForPass(false)).toBe('failure');
  });

  it('maps outcomes to conclusions', () => {
    expect(conclusionForOutcome('success')).toBe('success');
    expect(conclusionForOutcome('failed')).toBe('failure');
    expect(conclusionForOutcome('cancelled')).toBe('cancelled');
    expect(conclusionForOutcome('timed_out')).toBe('timed_out');
  });
});

describe('human-readable labels', () => {
  it('labels every status', () => {
    expect(statusLabel('queued')).toBe('Queued');
    expect(statusLabel('in_progress')).toBe('In progress');
    expect(statusLabel('completed')).toBe('Completed');
  });

  it('labels every conclusion', () => {
    expect(conclusionLabel('success')).toBe('Success');
    expect(conclusionLabel('failure')).toBe('Failure');
    expect(conclusionLabel('neutral')).toBe('Neutral');
    expect(conclusionLabel('cancelled')).toBe('Cancelled');
    expect(conclusionLabel('timed_out')).toBe('Timed out');
    expect(conclusionLabel('action_required')).toBe('Action required');
    expect(conclusionLabel('stale')).toBe('Stale');
    expect(conclusionLabel('skipped')).toBe('Skipped');
  });
});

describe('pass/fail interpretation', () => {
  it('treats success, neutral, and skipped as passing', () => {
    expect(isPassing('success')).toBe(true);
    expect(isPassing('neutral')).toBe(true);
    expect(isPassing('skipped')).toBe(true);
    expect(isPassing('failure')).toBe(false);
    expect(isPassing(null)).toBe(false);
  });

  it('treats failure, timed_out, cancelled, and action_required as failing', () => {
    expect(isFailing('failure')).toBe(true);
    expect(isFailing('timed_out')).toBe(true);
    expect(isFailing('cancelled')).toBe(true);
    expect(isFailing('action_required')).toBe(true);
    expect(isFailing('success')).toBe(false);
    expect(isFailing(null)).toBe(false);
  });
});

describe('summarizeCheckRun & failureStatusLine', () => {
  it('summarizes a completed run by conclusion', () => {
    const check: CheckRun = { id: 1, name: 'build', headSha: 'h', status: 'completed', conclusion: 'success' };
    expect(summarizeCheckRun(check)).toBe('build: Success');
  });

  it('summarizes an in-progress run by status', () => {
    const check: CheckRun = { id: 1, name: 'build', headSha: 'h', status: 'in_progress', conclusion: null };
    expect(summarizeCheckRun(check)).toBe('build: In progress');
  });

  it('builds a failure status line', () => {
    expect(failureStatusLine(2, 5)).toBe('2 failed job(s), 5 failed step(s)');
  });

  it('builds an empty failure status line', () => {
    expect(failureStatusLine(0, 0)).toBe('0 failed job(s), 0 failed step(s)');
  });
});