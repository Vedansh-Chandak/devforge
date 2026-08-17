import { describe, it, expect } from 'vitest';
import type { CommandResult } from '../../command/types.js';
import {
  defaultVerificationTargets,
  runVerification,
  typecheckTarget,
} from '../verification.js';
import { failResult, okResult, scriptedRunner } from './helpers.js';

const CWD = '/workspace';

describe('runVerification', () => {
  it('runs every target when all succeed', async () => {
    const { runner, calls } = scriptedRunner([
      okResult({ stdout: 'ok' }),
      okResult({ stdout: 'ok' }),
    ]);
    const result = await runVerification(
      runner,
      [
        { id: 'typecheck', command: 'tsc', args: ['--noEmit'], cwd: CWD },
        { id: 'build', command: 'tsc', args: [], cwd: CWD },
      ],
      { cwd: CWD },
    );
    expect(result.ok).toBe(true);
    expect(result.targets).toHaveLength(2);
    expect(calls).toHaveLength(2);
    expect(result.failedTargetId).toBeUndefined();
  });

  it('stops at the first failing target', async () => {
    const { runner, calls } = scriptedRunner([
      okResult(),
      failResult({ exitCode: 2 }),
      okResult(),
    ]);
    const result = await runVerification(
      runner,
      [
        { id: 'a', command: 'node', args: [], cwd: CWD },
        { id: 'b', command: 'node', args: [], cwd: CWD },
        { id: 'c', command: 'node', args: [], cwd: CWD },
      ],
      { cwd: CWD },
    );
    expect(result.ok).toBe(false);
    expect(result.failedTargetId).toBe('b');
    expect(calls).toHaveLength(2);
  });

  it('records output, exit code, and duration per target', async () => {
    const { runner } = scriptedRunner([
      failResult({ stdout: 'boom', exitCode: 7, durationMs: 5 }),
    ]);
    const now = (() => {
      let value = 1000;
      return () => {
        const current = value;
        value += 10;
        return current;
      };
    })();
    const result = await runVerification(
      runner,
      [{ id: 't', command: 'node', args: [], cwd: CWD }],
      { cwd: CWD, now },
    );
    expect(result.targets[0]).toMatchObject({
      targetId: 't',
      success: false,
      exitCode: 7,
      output: 'boom',
      durationMs: 10,
    });
    expect(result.durationMs).toBe(30);
  });

  it('defaults a target cwd to the run cwd', async () => {
    const { runner, calls } = scriptedRunner([okResult()]);
    await runVerification(runner, [{ id: 't', command: 'node', args: [] }], {
      cwd: CWD,
    });
    expect(calls[0]!.cwd).toBe(CWD);
  });

  it('propagates a per-target cwd override', async () => {
    const { runner, calls } = scriptedRunner([okResult()]);
    await runVerification(
      runner,
      [{ id: 't', command: 'node', args: [], cwd: '/other' }],
      { cwd: CWD },
    );
    expect(calls[0]!.cwd).toBe('/other');
  });

  it('passes the abort signal and allowFailure to the runner', async () => {
    const { runner, calls } = scriptedRunner([okResult()]);
    const controller = new AbortController();
    await runVerification(runner, [{ id: 't', command: 'node', args: [] }], {
      cwd: CWD,
      abortSignal: controller.signal,
    });
    expect(calls[0]!.abortSignal).toBe(controller.signal);
    expect(calls[0]!.allowFailure).toBe(true);
  });

  it('reports cancellation when a target is cancelled', async () => {
    const { runner } = scriptedRunner([
      okResult({ cancelled: true, success: false, exitCode: null }),
    ]);
    const result = await runVerification(
      runner,
      [{ id: 't', command: 'node', args: [] }],
      { cwd: CWD },
    );
    expect(result.cancelled).toBe(true);
    expect(result.ok).toBe(false);
  });

  it('combines stdout and stderr into the output field', async () => {
    const { runner } = scriptedRunner([
      okResult({ stdout: 'out', stderr: 'err' }),
    ]);
    const result = await runVerification(
      runner,
      [{ id: 't', command: 'node', args: [] }],
      { cwd: CWD },
    );
    expect(result.targets[0]!.output).toBe('out\nerr');
  });

  it('resolves with an empty target list as ok', async () => {
    const { runner, calls } = scriptedRunner([]);
    const result = await runVerification(runner, [], { cwd: CWD });
    expect(result.ok).toBe(true);
    expect(result.targets).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('verification helpers', () => {
  it('typecheckTarget builds a tsc --noEmit target', () => {
    expect(typecheckTarget('/root')).toEqual({
      id: 'typecheck',
      command: 'tsc',
      args: ['--noEmit'],
      cwd: '/root',
    });
  });

  it('defaultVerificationTargets returns a single typecheck target for the root', () => {
    const targets = defaultVerificationTargets('/root');
    expect(targets).toEqual([typecheckTarget('/root')]);
  });

  it('forwards the target timeout to the runner', async () => {
    const { runner, calls } = scriptedRunner([okResult()]);
    await runVerification(
      runner,
      [{ id: 't', command: 'node', args: [], timeoutMs: 1234 }],
      { cwd: CWD },
    );
    expect(calls[0]!.timeoutMs).toBe(1234);
  });

  it('forwards the target maxOutputBytes to the runner', async () => {
    const { runner, calls } = scriptedRunner([okResult()]);
    await runVerification(
      runner,
      [{ id: 't', command: 'node', args: [], maxOutputBytes: 512 }],
      { cwd: CWD },
    );
    expect(calls[0]!.maxOutputBytes).toBe(512);
  });
});
