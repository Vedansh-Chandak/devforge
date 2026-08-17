/**
 * @devforge/vscode-extension — Session manager (DF-020).
 *
 * Owns the DevForge sessions bound to workspace roots, records task history,
 * and dispatches command execution through the active session's client.
 * Pure bookkeeping + eventing — no engine logic lives here.
 */

import type { CommandResult, DevForgeCommand, DevForgeSession, TaskRecord } from '../types.js';
import { DevForgeClient } from './devforge-client.js';
import { SessionError } from '../errors.js';
import { uniqueId } from '../utils.js';

/** Events emitted by the session manager (fed to the task-history view). */
export interface SessionEvents {
  /** A new session was created for a workspace root. */
  onSessionCreated?: (session: DevForgeSession) => void;
  /** A task was recorded on a session. */
  onTaskRecorded?: (session: DevForgeSession, task: TaskRecord) => void;
  /** The active session changed. */
  onActiveSessionChanged?: (session: DevForgeSession | null) => void;
  /** A command transitioned to running/finished. */
  onCommandChanged?: (running: boolean, command: DevForgeCommand) => void;
}

/** Dependencies required by the session manager. */
export interface SessionManagerDeps {
  /** Factory creating a client bound to a workspace root. */
  readonly createClient: (workspaceRoot: string) => DevForgeClient;
  readonly events?: SessionEvents;
  readonly now?: () => number;
}

/** The session manager: sessions, history, and dispatch. */
export class SessionManager {
  private readonly sessions = new Map<string, DevForgeSession>();
  private readonly clients = new Map<string, DevForgeClient>();
  private readonly createClient: (workspaceRoot: string) => DevForgeClient;
  private readonly events: Required<SessionEvents>;
  private readonly now: () => number;
  private activeRoot: string | null = null;

  constructor(deps: SessionManagerDeps) {
    this.createClient = deps.createClient;
    this.now = deps.now ?? (() => Date.now());
    this.events = {
      onSessionCreated: deps.events?.onSessionCreated ?? (() => undefined),
      onTaskRecorded: deps.events?.onTaskRecorded ?? (() => undefined),
      onActiveSessionChanged: deps.events?.onActiveSessionChanged ?? (() => undefined),
      onCommandChanged: deps.events?.onCommandChanged ?? (() => undefined),
    };
  }

  /** All sessions, ordered by creation time. */
  list(): readonly DevForgeSession[] {
    return [...this.sessions.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  /** The active session, or null when none is set. */
  getActiveSession(): DevForgeSession | null {
    if (this.activeRoot === null) return null;
    return this.sessions.get(this.activeRoot) ?? null;
  }

  /** The active client, or null when none is set. */
  getActiveClient(): DevForgeClient | null {
    if (this.activeRoot === null) return null;
    return this.clients.get(this.activeRoot) ?? null;
  }

  /** Get a session by id, or null. */
  getById(id: string): DevForgeSession | null {
    for (const session of this.sessions.values()) {
      if (session.id === id) return session;
    }
    return null;
  }

  /**
   * Get or create the session for a workspace root and make it active.
   * Returns the (possibly new) session.
   */
  activate(root: string): DevForgeSession {
    let session = this.sessions.get(root);
    if (!session) {
      const id = uniqueId('session');
      session = {
        id,
        workspaceRoot: root,
        createdAt: this.now(),
        tasks: [],
      };
      this.sessions.set(root, session);
      this.clients.set(root, this.createClient(root));
      this.events.onSessionCreated(session);
    }
    this.activeRoot = root;
    this.events.onActiveSessionChanged(session);
    return session;
  }

  /** Set the active session by id. */
  setActiveById(id: string): DevForgeSession {
    const session = this.getById(id);
    if (!session) throw new SessionError(`No session with id "${id}".`);
    this.activeRoot = session.workspaceRoot;
    this.events.onActiveSessionChanged(session);
    return session;
  }

  /** Drop all sessions and dispose their clients. */
  async clearSessions(): Promise<void> {
    this.activeRoot = null;
    this.sessions.clear();
    await Promise.all([...this.clients.values()].map((c) => c.dispose()));
    this.clients.clear();
    this.events.onActiveSessionChanged(null);
  }

  /**
   * Execute a command on the active session, recording a task in history.
   * Throws a {@link SessionError} when no session is active.
   */
  async execute(command: DevForgeCommand, ...args: string[]): Promise<CommandResult> {
    const session = this.getActiveSession();
    if (!session) throw new SessionError('No active session. Open a workspace folder first.');
    const client = this.getActiveClient();
    if (!client) throw new SessionError('No active client for the current session.');

    const startedAt = this.now();
    this.events.onCommandChanged(true, command);
    try {
      const result = await client.run(command, ...args);
      this.record(session, command, args, startedAt, result);
      return result;
    } finally {
      this.events.onCommandChanged(false, command);
    }
  }

  /** Dispose the manager and all clients. */
  async dispose(): Promise<void> {
    await this.clearSessions();
  }

  private record(session: DevForgeSession, command: DevForgeCommand, args: readonly string[], startedAt: number, result: CommandResult): void {
    const summary = summarizeResult(result);
    const task: TaskRecord = {
      id: uniqueId('task'),
      command,
      args,
      startedAt,
      durationMs: result.durationMs,
      ok: result.ok,
      summary,
    };
    const tasks = [...session.tasks, task];
    this.sessions.set(session.workspaceRoot, { ...session, tasks });
    this.events.onTaskRecorded(this.getActiveSession() ?? session, task);
  }
}

/** Build a short summary for a task record from its result. */
export function summarizeResult(result: CommandResult): string {
  if (!result.ok) {
    return result.error ? `${result.command}: ${result.error.message}` : `${result.command}: failed`;
  }
  const arg = result.args[0];
  const subject = arg ? ` "${truncate(arg, 48)}"` : '';
  return `${result.command}${subject}`;
}

function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max - 3)}...`;
}
