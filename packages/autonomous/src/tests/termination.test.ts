import { describe, expect, it } from 'vitest';
import { TerminationController } from '../termination.js';
import type { TerminationState } from '../termination.js';

function state(input: Partial<TerminationState> = {}): Partial<TerminationState> {
  return input;
}

describe('TerminationController defaults', () => {
  it('defaults maxAttempts to 1', () => {
    expect(new TerminationController().maxAttempts).toBe(1);
  });
  it('defaults the confidence threshold to 0.7', () => {
    expect(new TerminationController().confidenceThreshold).toBe(0.7);
  });
  it('continues for an empty state', () => {
    const decision = new TerminationController().evaluate();
    expect(decision.stop).toBe(false);
    expect(decision.reason).toBe('CONTINUE');
  });
});

describe('VERIFICATION_PASSED', () => {
  it('stops with success immediately', () => {
    const decision = new TerminationController().evaluate(
      state({ verificationPassed: true, attempt: 5, maxAttempts: 1 }),
    );
    expect(decision.stop).toBe(true);
    expect(decision.reason).toBe('VERIFICATION_PASSED');
  });
  it('takes priority over all other stop conditions', () => {
    const decision = new TerminationController().evaluate(
      state({
        verificationPassed: true,
        cancelled: true,
        timeoutMs: 1,
        now: 1000,
        startedAt: 0,
        repositoryChangedExternally: true,
        attempt: 99,
        maxAttempts: 1,
      }),
    );
    expect(decision.reason).toBe('VERIFICATION_PASSED');
  });
});

describe('USER_CANCELLED', () => {
  it('stops when the run is cancelled', () => {
    const decision = new TerminationController().evaluate(state({ cancelled: true }));
    expect(decision.stop).toBe(true);
    expect(decision.reason).toBe('USER_CANCELLED');
  });
});

describe('REPOSITORY_CHANGED_EXTERNALLY', () => {
  it('stops when the repository changed externally', () => {
    const decision = new TerminationController().evaluate(
      state({ repositoryChangedExternally: true }),
    );
    expect(decision.stop).toBe(true);
    expect(decision.reason).toBe('REPOSITORY_CHANGED_EXTERNALLY');
  });
});

describe('timeout', () => {
  it('stops when the wall-clock budget is exceeded', () => {
    const decision = new TerminationController().evaluate(
      state({ startedAt: 0, now: 1100, timeoutMs: 1000 }),
    );
    expect(decision.stop).toBe(true);
    expect(decision.reason).toBe('TIMEOUT');
  });
  it('stops exactly at the budget boundary', () => {
    const decision = new TerminationController().evaluate(
      state({ startedAt: 0, now: 1000, timeoutMs: 1000 }),
    );
    expect(decision.reason).toBe('TIMEOUT');
  });
  it('continues while within the budget', () => {
    const decision = new TerminationController().evaluate(
      state({ startedAt: 0, now: 999, timeoutMs: 1000 }),
    );
    expect(decision.stop).toBe(false);
  });
  it('does not timeout when timeoutMs is zero', () => {
    const decision = new TerminationController().evaluate(
      state({ startedAt: 0, now: 5000 }),
    );
    expect(decision.stop).toBe(false);
  });
});

describe('max attempts', () => {
  it('stops when the attempt exceeds the maximum', () => {
    const decision = new TerminationController({ maxAttempts: 3 }).evaluate(
      state({ attempt: 4 }),
    );
    expect(decision.stop).toBe(true);
    expect(decision.reason).toBe('MAX_ATTEMPTS_REACHED');
  });
  it('allows the last allowed attempt', () => {
    const decision = new TerminationController({ maxAttempts: 3 }).evaluate(
      state({ attempt: 3 }),
    );
    expect(decision.stop).toBe(false);
  });
  it('attemptAllowed reflects the limit', () => {
    const ctrl = new TerminationController({ maxAttempts: 3 });
    expect(ctrl.attemptAllowed(1)).toBe(true);
    expect(ctrl.attemptAllowed(3)).toBe(true);
    expect(ctrl.attemptAllowed(4)).toBe(false);
  });
});

describe('duplicate patch', () => {
  it('stops when a fingerprint repeats at least the duplicate window', () => {
    const decision = new TerminationController({ duplicateWindow: 2 }).evaluate(
      state({ fingerprintCount: 2 }),
    );
    expect(decision.stop).toBe(true);
    expect(decision.reason).toBe('DUPLICATE_PATCH');
  });
  it('continues below the duplicate window', () => {
    const decision = new TerminationController({ duplicateWindow: 2 }).evaluate(
      state({ fingerprintCount: 1 }),
    );
    expect(decision.stop).toBe(false);
  });
});

describe('confidence below threshold', () => {
  it('stops when confidence is below the threshold', () => {
    const decision = new TerminationController({ confidenceThreshold: 0.7 }).evaluate(
      state({ confidence: 0.5 }),
    );
    expect(decision.stop).toBe(true);
    expect(decision.reason).toBe('CONFIDENCE_BELOW_THRESHOLD');
  });
  it('continues when confidence equals the threshold', () => {
    const decision = new TerminationController({ confidenceThreshold: 0.7 }).evaluate(
      state({ confidence: 0.7 }),
    );
    expect(decision.stop).toBe(false);
  });
  it('continues when confidence is undefined', () => {
    const decision = new TerminationController({ confidenceThreshold: 0.7 }).evaluate(
      state({}),
    );
    expect(decision.stop).toBe(false);
  });
  it('exposes the configured threshold', () => {
    expect(new TerminationController({ confidenceThreshold: 0.55 }).confidenceThreshold).toBe(0.55);
  });
});

describe('message strings', () => {
  it('describes a verification pass', () => {
    expect(
      new TerminationController().evaluate(state({ verificationPassed: true })).message,
    ).toContain('verification');
  });
  it('describes a user cancellation', () => {
    expect(new TerminationController().evaluate(state({ cancelled: true })).message).toContain(
      'cancelled',
    );
  });
  it('describes an external repository change', () => {
    expect(
      new TerminationController().evaluate(state({ repositoryChangedExternally: true })).message,
    ).toContain('external');
  });
  it('describes a timeout', () => {
    expect(
      new TerminationController().evaluate(state({ startedAt: 0, now: 5, timeoutMs: 1 })).message,
    ).toContain('budget');
  });
  it('describes the attempt limit', () => {
    const decision = new TerminationController({ maxAttempts: 2 }).evaluate(
      state({ attempt: 3 }),
    );
    expect(decision.message).toContain('max 2');
  });
  it('describes the duplicate fingerprint', () => {
    const decision = new TerminationController().evaluate(
      state({ fingerprintCount: 3, duplicateWindow: 2 }),
    );
    expect(decision.message).toContain('3');
  });
  it('describes the confidence shortfall', () => {
    const decision = new TerminationController({ confidenceThreshold: 0.7 }).evaluate(
      state({ confidence: 0.4 }),
    );
    expect(decision.message).toContain('0.4');
  });
  it('describes continuation', () => {
    expect(new TerminationController().evaluate().message).toBe('continue');
  });
});

describe('evaluation ordering', () => {
  it('never returns MAX_ATTEMPTS before cancellation', () => {
    const decision = new TerminationController({ maxAttempts: 1 }).evaluate(
      state({ attempt: 9, cancelled: true }),
    );
    expect(decision.reason).toBe('USER_CANCELLED');
  });
  it('never returns DUPLICATE_PATCH before a timeout', () => {
    const decision = new TerminationController().evaluate(
      state({ fingerprintCount: 5, startedAt: 0, now: 9999, timeoutMs: 100 }),
    );
    expect(decision.reason).toBe('TIMEOUT');
  });
  it('evaluates confidence before continuing', () => {
    const decision = new TerminationController({ confidenceThreshold: 0.5 }).evaluate(
      state({ attempt: 1, confidence: 0.4 }),
    );
    expect(decision.reason).toBe('CONFIDENCE_BELOW_THRESHOLD');
  });
});

describe('controller state merging', () => {
  it('merges partial state over defaults', () => {
    const ctrl = new TerminationController({ maxAttempts: 3, timeoutMs: 500 });
    const decision = ctrl.evaluate(state({ startedAt: 0, now: 600 }));
    expect(decision.reason).toBe('TIMEOUT');
  });
  it('stops on external change even with a passing timeout budget', () => {
    const decision = new TerminationController().evaluate(
      state({ repositoryChangedExternally: true, startedAt: 0, now: 999999, timeoutMs: 10 }),
    );
    expect(decision.reason).toBe('REPOSITORY_CHANGED_EXTERNALLY');
  });
});