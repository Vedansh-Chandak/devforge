import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProgressTracker, ProgressProvider } from '../../src/providers/progress-provider.js';
import * as vscode from '../mocks/vscode.js';

describe('ProgressTracker', () => {
  it('starts idle', () => {
    const tracker = new ProgressTracker();
    expect(tracker.state).toMatchObject({ running: false, command: null, startedAt: null, message: '' });
    expect(tracker.isRunning).toBe(false);
    expect(tracker.elapsedMs).toBe(0);
  });

  it('start records the command and a default message', () => {
    const tracker = new ProgressTracker();
    tracker.start('plan');
    expect(tracker.isRunning).toBe(true);
    expect(tracker.command).toBe('plan');
    expect(tracker.message).toBe('DevForge: plan in progress');
    expect(tracker.startedAt).not.toBeNull();
  });

  it('start honors a custom message', () => {
    const tracker = new ProgressTracker();
    tracker.start('fix', 'fixing things');
    expect(tracker.message).toBe('fixing things');
  });

  it('update changes the message while running', () => {
    const tracker = new ProgressTracker();
    tracker.start('plan');
    tracker.update('halfway');
    expect(tracker.message).toBe('halfway');
  });

  it('update is ignored when idle', () => {
    const tracker = new ProgressTracker();
    tracker.update('nope');
    expect(tracker.message).toBe('');
  });

  it('finish resets to idle', () => {
    const tracker = new ProgressTracker();
    tracker.start('plan', 'x');
    tracker.finish();
    expect(tracker.isRunning).toBe(false);
    expect(tracker.command).toBeNull();
    expect(tracker.startedAt).toBeNull();
  });

  it('elapsedMs reports the duration since start', () => {
    const tracker = new ProgressTracker();
    tracker.start('run');
    expect(tracker.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});

describe('ProgressProvider', () => {
  beforeEach(() => vscode.__resetMocks());

  function makeProvider(tracker?: ProgressTracker): ProgressProvider {
    return new ProgressProvider({ vscode: vscode as unknown as typeof import('vscode'), tracker });
  }

  it('creates and hides a status bar item', () => {
    makeProvider();
    expect(vscode.__statusBarItems).toHaveLength(1);
    expect(vscode.__statusBarItems[0]?.visible).toBe(false);
  });

  it('register returns a disposable that disposes the status bar', () => {
    const provider = makeProvider();
    const item = vscode.__statusBarItems[0]!;
    const spy = vi.spyOn(item, 'dispose');
    const disposable = provider.register();
    disposable.dispose();
    expect(spy).toHaveBeenCalled();
  });

  it('run wraps a task in withProgress and tracks state', async () => {
    const provider = makeProvider();
    const result = await provider.run('plan', async (progress) => {
      progress('working...');
      return 'done';
    });
    expect(result).toBe('done');
    expect(vscode.__withProgressCalls).toHaveLength(1);
    expect(provider.trackerRef.isRunning).toBe(false);
  });

  it('run re-throws task errors but finishes the tracker', async () => {
    const provider = makeProvider();
    await expect(provider.run('plan', async () => { throw new Error('nope'); })).rejects.toThrow('nope');
    expect(provider.trackerRef.isRunning).toBe(false);
  });

  it('run serializes concurrent invocations', async () => {
    const provider = makeProvider();
    const order: string[] = [];
    const p1 = provider.run('plan', async () => { order.push('one'); await new Promise((r) => setTimeout(r, 10)); return '1'; });
    const p2 = provider.run('status', async () => { order.push('two'); return '2'; });
    await Promise.all([p1, p2]);
    expect(order).toEqual(['one', 'two']);
  });

  it('notify shows the right toast kind', () => {
    const provider = makeProvider();
    provider.notify('info!', 'info');
    provider.notify('warn!', 'warn');
    provider.notify('err!', 'error');
    expect(vscode.__toasts).toEqual([
      { message: 'info!', kind: 'info' },
      { message: 'warn!', kind: 'warn' },
      { message: 'err!', kind: 'error' },
    ]);
  });

  it('notify defaults to info', () => {
    const provider = makeProvider();
    provider.notify('hi');
    expect(vscode.__toasts[0]?.kind).toBe('info');
  });
});
