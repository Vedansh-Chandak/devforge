import { describe, expect, it } from 'vitest';
import { ExecutorVerifier, fixedVerifier, toSummary } from '../src/execution/verification.js';
import { makeContext, fakeCommandRunner, failedCommand, passedCommand } from './helpers/mock.js';
import type { VerificationTarget } from '@devforge/execution';

const target = (id: string, command = 'node'): VerificationTarget => ({
  id,
  command: command as VerificationTarget['command'],
  args: [],
  cwd: '/ws',
});

describe('toSummary', () => {
  it('maps a passing verification result', () => {
    expect(
      toSummary({
        ok: true,
        targets: [{ targetId: 'a', success: true, exitCode: 0, durationMs: 1, output: '' }],
        durationMs: 3,
        cancelled: false,
      }),
    ).toEqual({
      ok: true,
      targets: ['a'],
      failedTargetId: null,
      durationMs: 3,
      attempts: 1,
      cancelled: false,
    });
  });

  it('maps a failing verification result with failed target', () => {
    expect(
      toSummary({
        ok: false,
        targets: [
          { targetId: 'a', success: true, exitCode: 0, durationMs: 1, output: '' },
          { targetId: 'b', success: false, exitCode: 1, durationMs: 2, output: 'x' },
        ],
        failedTargetId: 'b',
        durationMs: 4,
        cancelled: false,
      }),
    ).toMatchObject({ ok: false, failedTargetId: 'b', targets: ['a', 'b'] });
  });
});

describe('ExecutorVerifier', () => {
  it('posts VERIFICATION_STARTED then VERIFICATION_PASSED on success', async () => {
    const ctx = makeContext();
    const verifier = new ExecutorVerifier(fakeCommandRunner([passedCommand()]), [target('t')]);
    const summary = await verifier.verify(ctx);
    expect(summary.ok).toBe(true);
    const types = ctx.conversation.all().map((m) => m.type);
    expect(types[0]).toBe('VERIFICATION_STARTED');
    expect(types).toContain('VERIFICATION_PASSED');
  });

  it('posts VERIFICATION_FAILED with the failing target on failure', async () => {
    const ctx = makeContext();
    const verifier = new ExecutorVerifier(fakeCommandRunner([failedCommand()]), [target('t')]);
    const summary = await verifier.verify(ctx);
    expect(summary.ok).toBe(false);
    const failed = ctx.conversation.byType('VERIFICATION_FAILED');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.payload.failedTargetId).toBe('t');
  });

  it('runs every target when all succeed', async () => {
    let calls = 0;
    const runner = {
      async run() {
        calls += 1;
        return passedCommand();
      },
    };
    const verifier = new ExecutorVerifier(runner, [target('a'), target('b')]);
    const summary = await verifier.verify(makeContext());
    expect(summary.ok).toBe(true);
    expect(summary.targets).toEqual(['a', 'b']);
    expect(calls).toBe(2);
  });

  it('stops at the first failing target', async () => {
    let calls = 0;
    const runner = {
      async run() {
        calls += 1;
        return calls === 1 ? passedCommand() : failedCommand();
      },
    };
    const verifier = new ExecutorVerifier(runner, [target('a'), target('b'), target('c')]);
    const summary = await verifier.verify(makeContext());
    expect(summary.ok).toBe(false);
    expect(summary.failedTargetId).toBe('b');
    expect(calls).toBe(2);
  });

  it('accepts per-run target overrides', async () => {
    const runner = fakeCommandRunner([passedCommand()]);
    const verifier = new ExecutorVerifier(runner, [target('default')]);
    const summary = await verifier.verify(makeContext(), { targets: [target('override')] });
    expect(summary.targets).toEqual(['override']);
  });

  it('propagates the attempts option', async () => {
    const verifier = new ExecutorVerifier(fakeCommandRunner([passedCommand()]), [target('t')]);
    const summary = await verifier.verify(makeContext(), { attempts: 3 });
    expect(summary.attempts).toBe(3);
  });

  it('uses an injected time source for message timestamps', async () => {
    const ctx = makeContext();
    const verifier = new ExecutorVerifier(
      fakeCommandRunner([passedCommand()]),
      [target('t')],
      () => 4242,
    );
    await verifier.verify(ctx);
    expect(ctx.conversation.byType('VERIFICATION_STARTED')[0]?.at).toBe(4242);
    expect(ctx.conversation.byType('VERIFICATION_PASSED')[0]?.at).toBe(4242);
  });

  it('resolves ok for zero targets', async () => {
    const verifier = new ExecutorVerifier(fakeCommandRunner([]), []);
    const summary = await verifier.verify(makeContext());
    expect(summary.ok).toBe(true);
    expect(summary.targets).toEqual([]);
  });
});

describe('fixedVerifier', () => {
  it('resolves a deterministic passing outcome', async () => {
    const ctx = makeContext();
    const summary = await fixedVerifier(true).verify(ctx);
    expect(summary.ok).toBe(true);
    expect(ctx.conversation.byType('VERIFICATION_PASSED')).toHaveLength(1);
  });

  it('resolves a deterministic failing outcome with a target', async () => {
    const ctx = makeContext();
    const summary = await fixedVerifier(false, 'build').verify(ctx);
    expect(summary.ok).toBe(false);
    expect(summary.failedTargetId).toBe('build');
    expect(ctx.conversation.byType('VERIFICATION_FAILED')).toHaveLength(1);
  });

  it('honours attempts from options', async () => {
    const summary = await fixedVerifier(true).verify(makeContext(), { attempts: 2 });
    expect(summary.attempts).toBe(2);
  });
});