import { describe, it, expect, vi } from 'vitest';
import { SessionManager, summarizeResult } from '../../src/services/session-manager.js';
import { DevForgeClient } from '../../src/services/devforge-client.js';
import { CommandResult, DevForgeSession, TaskRecord } from '../../src/types.js';
import { SessionError } from '../../src/errors.js';

function okResult(overrides: Partial<CommandResult> = {}): CommandResult {
  return { command: 'status', args: [], ok: true, text: 'ok', data: null, durationMs: 10, ...overrides };
}

function failResult(overrides: Partial<CommandResult> = {}): CommandResult {
  return { command: 'run', args: ['x'], ok: false, text: 'failed', data: null, durationMs: 5, error: { code: 'E', message: 'boom' }, ...overrides };
}

function fakeClient(overrides: Partial<DevForgeClient> = {}): DevForgeClient {
  return {
    workspaceRoot: '/ws',
    isDisposed: false,
    config: () => ({ provider: 'fake', model: '', baseUrl: '', apiKey: '', maxAttempts: 3, autoRepair: true, confirmRiskyChanges: true, autoApprove: false, logLevel: 'info' }),
    run: vi.fn(),
    repositoryContext: vi.fn(),
    diff: vi.fn(),
    changedFiles: vi.fn(),
    rejectDiff: vi.fn(),
    planStructured: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DevForgeClient;
}

function makeManager(options: { now?: () => number; client?: DevForgeClient } = {}): SessionManager {
  const created: DevForgeClient[] = [];
  const manager = new SessionManager({
    createClient: () => {
      const client = options.client ?? fakeClient();
      created.push(client);
      return client;
    },
    now: options.now ?? (() => 1000),
  });
  return manager;
}

describe('SessionManager basics', () => {
  it('starts with no sessions and no active session', () => {
    const manager = makeManager();
    expect(manager.list()).toEqual([]);
    expect(manager.getActiveSession()).toBeNull();
    expect(manager.getActiveClient()).toBeNull();
  });

  it('activate creates a session and makes it active', () => {
    const manager = makeManager();
    const session = manager.activate('/a');
    expect(session.workspaceRoot).toBe('/a');
    expect(session.tasks).toEqual([]);
    expect(manager.getActiveSession()?.workspaceRoot).toBe('/a');
    expect(manager.getActiveClient()).not.toBeNull();
  });

  it('activate is idempotent for the same root', () => {
    const manager = makeManager();
    const first = manager.activate('/a');
    const second = manager.activate('/a');
    expect(second).toBe(first);
    expect(manager.list()).toHaveLength(1);
  });

  it('list orders sessions by creation time', () => {
    let time = 0;
    const manager = makeManager({ now: () => time++ });
    manager.activate('/b');
    manager.activate('/a');
    const roots = manager.list().map((s) => s.workspaceRoot);
    expect(roots).toEqual(['/b', '/a']);
  });

  it('setActiveById switches the active session', () => {
    const manager = makeManager();
    manager.activate('/a');
    manager.activate('/b');
    const a = manager.getById(manager.list()[0]!.id)!;
    manager.setActiveById(a.id);
    expect(manager.getActiveSession()?.workspaceRoot).toBe('/a');
  });

  it('setActiveById throws for an unknown id', () => {
    const manager = makeManager();
    expect(() => manager.setActiveById('nope')).toThrow(SessionError);
  });

  it('fires onSessionCreated and onActiveSessionChanged', () => {
    const created = vi.fn();
    const changed = vi.fn();
    const manager = new SessionManager({
      createClient: () => fakeClient(),
      events: { onSessionCreated: created, onActiveSessionChanged: changed },
    });
    manager.activate('/a');
    expect(created).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(1);
  });
});

describe('SessionManager execute', () => {
  it('throws when no session is active', async () => {
    const manager = makeManager();
    await expect(manager.execute('status')).rejects.toThrow(SessionError);
  });

  it('runs a command through the active client and records a task', async () => {
    const client = fakeClient();
    vi.mocked(client.run).mockResolvedValue(okResult({ command: 'status' }));
    const manager = makeManager({ client });
    manager.activate('/a');

    const result = await manager.execute('status');
    expect(result.ok).toBe(true);
    expect(client.run).toHaveBeenCalledWith('status');
    expect(manager.getActiveSession()?.tasks).toHaveLength(1);
    expect(manager.getActiveSession()?.tasks[0]?.command).toBe('status');
  });

  it('records failed results too', async () => {
    const client = fakeClient();
    vi.mocked(client.run).mockResolvedValue(failResult());
    const manager = makeManager({ client });
    manager.activate('/a');

    await manager.execute('run', 'x');
    const task = manager.getActiveSession()?.tasks[0] as TaskRecord;
    expect(task.ok).toBe(false);
    expect(task.summary).toContain('boom');
  });

  it('fires onCommandChanged for start and end', async () => {
    const changed = vi.fn();
    const client = fakeClient();
    vi.mocked(client.run).mockResolvedValue(okResult());
    const manager = new SessionManager({
      createClient: () => client,
      events: { onCommandChanged: changed },
    });
    manager.activate('/a');
    await manager.execute('status');
    expect(changed).toHaveBeenCalledWith(true, 'status');
    expect(changed).toHaveBeenCalledWith(false, 'status');
  });

  it('fires onTaskRecorded with the updated session', async () => {
    const recorded = vi.fn();
    const client = fakeClient();
    vi.mocked(client.run).mockResolvedValue(okResult({ command: 'status' }));
    const manager = new SessionManager({
      createClient: () => client,
      events: { onTaskRecorded: recorded },
    });
    manager.activate('/a');
    await manager.execute('status');
    expect(recorded).toHaveBeenCalledWith(expect.objectContaining({ tasks: expect.any(Array) }), expect.objectContaining({ command: 'status' }));
  });
});

describe('SessionManager clear/dispose', () => {
  it('clearSessions disposes clients and clears state', async () => {
    const client = fakeClient();
    const manager = makeManager({ client });
    manager.activate('/a');
    await manager.clearSessions();
    expect(manager.list()).toHaveLength(0);
    expect(manager.getActiveSession()).toBeNull();
    expect(client.dispose).toHaveBeenCalled();
  });

  it('dispose delegates to clearSessions', async () => {
    const client = fakeClient();
    const manager = makeManager({ client });
    manager.activate('/a');
    await manager.dispose();
    expect(manager.list()).toHaveLength(0);
  });
});

describe('summarizeResult', () => {
  it('summarizes a successful result with an argument', () => {
    expect(summarizeResult(okResult({ command: 'ask', args: ['how do I x?'] }))).toBe('ask "how do I x?"');
  });

  it('truncates long arguments', () => {
    const summary = summarizeResult(okResult({ command: 'ask', args: ['a'.repeat(100)] }));
    expect(summary.length).toBeLessThan(70);
    expect(summary).toContain('...');
  });

  it('omits the argument when there is none', () => {
    expect(summarizeResult(okResult({ command: 'status', args: [] }))).toBe('status');
  });

  it('summarizes failures with the error message', () => {
    expect(summarizeResult(failResult())).toBe('run: boom');
  });

  it('handles failures without an error payload', () => {
    const result = failResult();
    delete (result as { error?: unknown }).error;
    expect(summarizeResult(result)).toBe('run: failed');
  });
});
