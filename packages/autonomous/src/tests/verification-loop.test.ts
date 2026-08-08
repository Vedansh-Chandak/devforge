import { describe, expect, it } from 'vitest';
import { TIMEOUT_ABORT_REASON, VerificationLoop } from '../verification-loop.js';
import type { VerificationTarget } from '@devforge/execution';
import { failResult, fixedClock, okResult, scriptedRunner } from './helpers.js';

const CWD = '/workspace';
const TARGET: VerificationTarget = { id: 'typecheck', command: 'tsc', args: ['--noEmit'], cwd: CWD };

function loop(overrides: Partial<ConstructorParameters<typeof VerificationLoop>[0]> = {}) {
  return new VerificationLoop({
    runner: scriptedRunner([okResult()]).runner,
    cwd: CWD,
    targets: [TARGET],
    ...overrides,
  });
}

describe('VerificationLoop basics', () => {
  it('starts empty with zero runs', () => {
    const verification = loop();
    expect(verification.count).toBe(0);
    expect(verification.hasPassed).toBe(false);
    expect(verification.snapshot).toEqual([]);
  });

  it('reports a passing run', async () => {
    const verification = loop();
    const run = await verification.run();
    expect(run.ok).toBe(true);
    expect(run.timedOut).toBe(false);
    expect(run.cancelled).toBe(false);
    expect(run.attempt).toBe(1);
    expect(verification.count).toBe(1);
    expect(verification.hasPassed).toBe(true);
  });

  it('records a snapshot for the run', async () => {
    const verification = loop();
    const run = await verification.run();
    expect(run.snapshot.ok).toBe(true);
    expect(run.snapshot.attempt).toBe(1);
    expect(run.snapshot.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('increments the attempt number across runs', async () => {
    const verification = loop({
      runner: scriptedRunner([okResult(), okResult()]).runner,
    });
    const first = await verification.run();
    const second = await verification.run();
    expect(first.attempt).toBe(1);
    expect(second.attempt).toBe(2);
  });

  it('exposes collected runs in order', async () => {
    const verification = loop({
      runner: scriptedRunner([okResult(), okResult()]).runner,
    });
    await verification.run();
    await verification.run();
    expect(verification.snapshot.map((run) => run.attempt)).toEqual([1, 2]);
  });
});

describe('VerificationLoop failure handling', () => {
  it('reports a failed run', async () => {
    const verification = loop({
      runner: scriptedRunner([failResult({ stderr: 'boom' })]).runner,
    });
    const run = await verification.run();
    expect(run.ok).toBe(false);
    expect(run.cancelled).toBe(false);
    expect(run.diagnostics.stderr.join(' ')).toContain('boom');
  });

  it('captures a failed target id', async () => {
    const verification = loop({
      runner: scriptedRunner([failResult()]).runner,
    });
    const run = await verification.run();
    expect(run.snapshot.result.failedTargetId).toBe('typecheck');
  });

  it('surfaces a runner exception as a failed run', async () => {
    const runner = {
      run: async () => {
        throw new Error('runner exploded');
      },
    };
    const verification = new VerificationLoop({ runner, cwd: CWD, targets: [TARGET] });
    const run = await verification.run();
    expect(run.ok).toBe(false);
    expect(run.diagnostics.stderr.join(' ')).toContain('runner exploded');
  });
});

describe('VerificationLoop cancellation', () => {
  it('treats a cancelled result as not ok', async () => {
    const verification = loop({
      runner: scriptedRunner([okResult({ cancelled: true, success: false, exitCode: null })]).runner,
    });
    const run = await verification.run();
    expect(run.ok).toBe(false);
    expect(run.cancelled).toBe(true);
  });

  it('honours a pre-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort('user stop');
    const runner = {
      run: async (request: { abortSignal?: AbortSignal }) =>
        request.abortSignal?.aborted
          ? okResult({ success: false, cancelled: true, exitCode: null })
          : okResult(),
    };
    const verification = new VerificationLoop({ runner, cwd: CWD, targets: [TARGET] });
    const run = await verification.run(controller.signal);
    expect(run.cancelled).toBe(true);
    expect(run.ok).toBe(false);
  });
});

describe('VerificationLoop overall timeout', () => {
  it('marks a run as timed out when the deadline fires', async () => {
    const runner = {
      run: async (request: { abortSignal?: AbortSignal }) => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return request.abortSignal?.aborted
          ? okResult({ success: false, cancelled: true, timedOut: true, exitCode: null })
          : okResult();
      },
    };
    const verification = new VerificationLoop({
      runner,
      cwd: CWD,
      targets: [TARGET],
      totalTimeoutMs: 5,
    });
    const run = await verification.run();
    expect(run.timedOut).toBe(true);
    expect(run.ok).toBe(false);
  });

  it('does not time out a fast verification', async () => {
    const verification = loop({ totalTimeoutMs: 500 });
    const run = await verification.run();
    expect(run.timedOut).toBe(false);
    expect(run.ok).toBe(true);
  });

  it('does not flag a cancelled slow run as a timeout when it finishes on its own', async () => {
    const runner = {
      run: async (request: { abortSignal?: AbortSignal }) => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        return okResult();
      },
    };
    const verification = new VerificationLoop({
      runner,
      cwd: CWD,
      targets: [TARGET],
      totalTimeoutMs: 5,
    });
    const run = await verification.run();
    expect(run.ok).toBe(true);
  });
});

describe('VerificationLoop diagnostics', () => {
  it('produces a diagnostics object with a summary', async () => {
    const verification = loop({
      runner: scriptedRunner([failResult({ stderr: 'type error' })]).runner,
    });
    const run = await verification.run();
    expect(run.diagnostics.source).toBe('verification');
    expect(run.diagnostics.verificationDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('uses a stable timing source when injected', async () => {
    const clock = fixedClock(100, 1);
    const verification = loop({ now: clock });
    const run = await verification.run();
    expect(run.snapshot.startedAt).toBe(100);
  });
});

describe('VerificationLoop error run', () => {
  it('reports cancelled state for an aborted error run', async () => {
    const controller = new AbortController();
    const runner = {
      run: async () => {
        throw new Error('gone');
      },
    };
    const signal = controller.signal;
    controller.abort('stop');
    const verification = new VerificationLoop({ runner, cwd: CWD, targets: [TARGET] });
    const run = await verification.run(signal);
    expect(run.cancelled).toBe(true);
    expect(run.diagnostics.stderr.join(' ')).toContain('gone');
  });
});