/**
 * Event bus tests (DF-021).
 *
 * Covers handler registration/unregistration, type and action filtering,
 * synchronous and awaited dispatch, history, and clearing.
 */

import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/events.js';
import type { GitHubEvent } from '../src/types.js';

function event(type: GitHubEvent['type'], action?: string): GitHubEvent {
  return { type, action, payload: {} };
}

describe('EventBus dispatch', () => {
  it('dispatches to matching handlers synchronously', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on({ type: 'push' }, () => {
      seen.push('push');
    });
    bus.emit(event('push'));
    bus.emit(event('issue'));
    expect(seen).toEqual(['push']);
  });

  it('filters by action', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on({ type: 'pull_request', action: 'opened' }, () => seen.push('opened'));
    bus.on({ type: 'pull_request', action: 'closed' }, () => seen.push('closed'));
    bus.emit(event('pull_request', 'opened'));
    bus.emit(event('pull_request', 'closed'));
    bus.emit(event('pull_request', 'reopened'));
    expect(seen).toEqual(['opened', 'closed']);
  });

  it('filters by type only when no action is given', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on({ type: 'issue' }, () => seen.push('issue'));
    bus.emit(event('issue', 'opened'));
    bus.emit(event('issue', 'closed'));
    expect(seen).toEqual(['issue', 'issue']);
  });

  it('invokes catch-all handlers for every event', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.onAny(() => seen.push('any'));
    bus.emit(event('push'));
    bus.emit(event('check_run'));
    expect(seen).toEqual(['any', 'any']);
  });

  it('does not dispatch to handlers that do not match', () => {
    const bus = new EventBus();
    let count = 0;
    bus.on({ type: 'workflow_run' }, () => {
      count += 1;
    });
    bus.emit(event('push'));
    bus.emit(event('repository_dispatch'));
    expect(count).toBe(0);
  });

  it('passes the full event snapshot to handlers', () => {
    const bus = new EventBus();
    let received: GitHubEvent | null = null;
    bus.onAny((e) => {
      received = e;
    });
    const sent = event('push');
    bus.emit(sent);
    expect(received).toEqual(sent);
  });
});

describe('EventBus emitAsync', () => {
  it('awaits all matching handlers', async () => {
    const bus = new EventBus();
    let order = '';
    bus.on({ type: 'push' }, async () => {
      order += 'a';
    });
    bus.on({ type: 'push' }, async () => {
      order += 'b';
    });
    await bus.emitAsync(event('push'));
    expect(order).toBe('ab');
  });

  it('propagates handler rejections from emitAsync', async () => {
    const bus = new EventBus();
    bus.on({ type: 'push' }, async () => {
      throw new Error('boom');
    });
    await expect(bus.emitAsync(event('push'))).rejects.toThrow('boom');
  });

  it('records emitted events in history', async () => {
    const bus = new EventBus();
    bus.on({ type: 'push' }, async () => {});
    await bus.emitAsync(event('push'));
    expect(bus.history()).toHaveLength(1);
  });
});

describe('EventBus registration', () => {
  it('unsubscribes a handler when its unsubscribe function is called', () => {
    const bus = new EventBus();
    let count = 0;
    const unsubscribe = bus.on({ type: 'push' }, () => {
      count += 1;
    });
    bus.emit(event('push'));
    unsubscribe();
    bus.emit(event('push'));
    expect(count).toBe(1);
  });

  it('tracks handler count', () => {
    const bus = new EventBus();
    expect(bus.handlerCount).toBe(0);
    bus.on({ type: 'push' }, () => {});
    bus.onAny(() => {});
    expect(bus.handlerCount).toBe(2);
  });

  it('history captures emitted events in order', () => {
    const bus = new EventBus();
    bus.emit(event('push'));
    bus.emit(event('issue', 'opened'));
    const history = bus.history();
    expect(history.map((e) => e.type)).toEqual(['push', 'issue']);
    expect(history[1]?.action).toBe('opened');
  });

  it('clear empties the history but keeps handlers', () => {
    const bus = new EventBus();
    let count = 0;
    bus.onAny(() => {
      count += 1;
    });
    bus.emit(event('push'));
    bus.clear();
    expect(bus.history()).toHaveLength(0);
    bus.emit(event('push'));
    expect(count).toBe(2);
  });

  it('returns copies of history so callers cannot mutate it', () => {
    const bus = new EventBus();
    bus.emit(event('push'));
    const history = bus.history();
    history.length = 0;
    expect(bus.history()).toHaveLength(1);
  });
});