/**
 * Shared test helper: builds a full {@link CommandDeps} bundle over the
 * vscode mock so command tests can focus on behavior.
 */

import { vi } from 'vitest';
import * as vscode from '../mocks/vscode.js';
import { CommandDeps } from '../../src/commands/deps.js';
import { SessionManager } from '../../src/services/session-manager.js';
import { Configuration } from '../../src/services/configuration.js';
import { ChatViewProvider } from '../../src/providers/chat-provider.js';
import { DiffProvider } from '../../src/providers/diff-provider.js';
import { DiagnosticsProvider } from '../../src/providers/diagnostics-provider.js';
import { ProgressProvider } from '../../src/providers/progress-provider.js';
import { DevForgeClient } from '../../src/services/devforge-client.js';
import { CommandResult } from '../../src/types.js';
import { TreeRefresher } from '../../src/extension.js';

export interface MakeDepsOptions {
  /** Canned results returned by the active client, in call order. */
  results?: CommandResult[];
  /** The default result when results run out. */
  fallback?: CommandResult;
  /** Override for the diff provider accept hook (defaults to a no-op). */
  diffAccept?: (document: unknown) => Promise<void>;
  /** Override for the diff provider reject hook (defaults to a no-op). */
  diffReject?: (files: readonly string[]) => Promise<void>;
}

export function makeDeps(options: MakeDepsOptions = {}): { deps: CommandDeps; client: DevForgeClient } {
  const runSpy = vi.fn(async (_command: string, ..._args: string[]): Promise<CommandResult> => {
    const next = options.results?.shift();
    return next ?? options.fallback ?? okResult();
  });
  const client = {
    run: runSpy,
    diff: async (): Promise<{ empty: boolean; files: unknown[] }> => ({
      empty: false,
      files: [{ oldPath: 'a.ts', newPath: 'a.ts', hunks: [] }],
    }),
    dispose: async (): Promise<void> => undefined,
  } as unknown as DevForgeClient;

  const sessions = new SessionManager({ createClient: () => client });
  sessions.activate('/workspace/test-repo');

  const vscodeNs = vscode as unknown as typeof import('vscode');
  const configuration = new Configuration({ get: (): unknown => undefined });

  const chat = new ChatViewProvider({ vscode: vscodeNs });
  const diff = new DiffProvider({
    vscode: vscodeNs,
    logger: makeLogger(),
    reject: options.diffReject ?? (async (): Promise<void> => undefined),
    accept: options.diffAccept ?? (async (): Promise<void> => undefined),
  });
  const diagnostics = new DiagnosticsProvider({ vscode: vscodeNs, workspaceRoot: '/workspace/test-repo' });
  const progress = new ProgressProvider({ vscode: vscodeNs });

  const tree: TreeRefresher = {
    refreshAll: (): void => undefined,
    refreshHistory: (): void => undefined,
    refreshRepository: (): void => undefined,
    refreshDiagnostics: (): void => undefined,
  };

  const deps: CommandDeps = {
    vscode: vscodeNs,
    sessions,
    configuration,
    chat,
    diff,
    diagnostics,
    progress,
    tree,
    logger: makeLogger(),
  };
  return { deps, client };
}

export function okResult(overrides: Partial<CommandResult> = {}): CommandResult {
  return { command: 'ask', args: ['goal'], ok: true, text: 'ok', data: null, durationMs: 1, ...overrides };
}

export function failResult(overrides: Partial<CommandResult> = {}): CommandResult {
  return {
    command: 'ask',
    args: ['goal'],
    ok: false,
    text: 'ask failed',
    data: null,
    durationMs: 1,
    error: { code: 'E', message: 'boom' },
    ...overrides,
  };
}

export function makeLogger(): { debug: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}
