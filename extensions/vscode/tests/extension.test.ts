import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExtensionHost, buildDefaultBundle, defaultClientFactory } from '../src/extension.js';
import { SessionManager } from '../src/services/session-manager.js';
import type { DevForgeClient, CliAdapter } from '../src/services/devforge-client.js';
import type { RepositoryContext } from '../src/types.js';
import type { LanguageClientBridge } from '../src/language-client.js';
import * as vscode from './mocks/vscode.js';

const REPO: RepositoryContext = {
  root: '/workspace/test-repo',
  gitRoot: '/workspace/test-repo',
  hasGit: true,
  branch: 'main',
  packageManager: 'pnpm',
  hasPackageJson: true,
  packageJsonName: 'test-repo',
  isMonorepo: true,
  hasWorkspaces: true,
  tsconfig: true,
  testFramework: 'vitest',
  buildTool: 'tsc',
  buildCommand: 'pnpm build',
  testCommand: 'pnpm test',
  lintCommand: 'pnpm lint',
} as RepositoryContext;

function fakeClient() {
  return {
    repositoryContext: vi.fn().mockResolvedValue(REPO),
    run: vi.fn().mockResolvedValue({ ok: true, code: 0, stdout: 'ok', stderr: '', data: undefined }),
    diff: vi.fn().mockResolvedValue({ empty: false, files: [] }),
    dispose: vi.fn().mockResolvedValue(undefined),
    rejectDiff: vi.fn().mockResolvedValue(undefined),
  } as unknown as DevForgeClient;
}

function fakeBridge() {
  const bridge = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    running: false,
  } as unknown as LanguageClientBridge;
  return bridge;
}

function makeBundle(client: DevForgeClient, bridge: LanguageClientBridge) {
  return buildDefaultBundle(vscode as unknown as typeof import('vscode'), vscode.__extensionContext as never, {
    languageClient: bridge,
    clientFactory: () => client,
  });
}

describe('buildDefaultBundle', () => {
  it('wires a default client factory over the CLI adapter', () => {
    const configuration = { read: () => ({ apiKey: 'x' }), toCliOptions: () => ({}), toEnvOverrides: () => ({}) } as never;
    const adapter = {} as CliAdapter;
    const factory = defaultClientFactory(configuration, adapter);
    expect(factory('/workspace/test-repo')).toBeDefined();
  });

  it('falls back to cwd when no workspace folder is open', () => {
    const original = (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders;
    (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = [];
    try {
      const bundle = buildDefaultBundle(vscode as unknown as typeof import('vscode'), vscode.__extensionContext as never, {
        languageClient: fakeBridge(),
        clientFactory: () => fakeClient(),
      });
      expect(bundle.diagnostics.workspaceRoot).toBe(process.cwd());
    } finally {
      (vscode.workspace as { workspaceFolders: unknown }).workspaceFolders = original;
    }
  });
});

describe('ExtensionHost', () => {
  beforeEach(() => {
    vscode.__resetMocks();
  });

  it('starts inactive', () => {
    const client = fakeClient();
    const bridge = fakeBridge();
    const host = new ExtensionHost(makeBundle(client, bridge));
    expect(host.isActivated).toBe(false);
  });

  it('activates, registers everything, and starts the language client', async () => {
    const client = fakeClient();
    const bridge = fakeBridge();
    const host = new ExtensionHost(makeBundle(client, bridge));
    await host.activate();

    expect(host.isActivated).toBe(true);
    expect(bridge.start).toHaveBeenCalledTimes(1);

    for (const id of [
      'devforge.activateSession',
      'devforge.ask',
      'devforge.plan',
      'devforge.fix',
      'devforge.review',
      'devforge.explain',
      'devforge.run',
      'devforge.status',
      'devforge.doctor',
      'devforge.diff.applyPatch',
      'devforge.diff.rejectPatch',
    ]) {
      expect(vscode.__commands.has(id), `command ${id} registered`).toBe(true);
    }

    expect(vscode.__treeViews.map((v) => v.viewId)).toEqual([
      'devforge.taskHistory',
      'devforge.repositoryContext',
      'devforge.diagnostics',
    ]);
  });

  it('activates a session for the workspace root and refreshes the repository tree', async () => {
    const client = fakeClient();
    const bridge = fakeBridge();
    const host = new ExtensionHost(makeBundle(client, bridge));
    await host.activate();

    const session = host.bundleRef.sessions.getActiveSession();
    expect(session?.workspaceRoot).toBe('/workspace/test-repo');
    expect(client.repositoryContext).toHaveBeenCalled();
    expect(host.bundleRef.tree.repository.model.id).toBe('repository');
  });

  it('deactivate stops the language client and disposes sessions', async () => {
    const client = fakeClient();
    const bridge = fakeBridge();
    const host = new ExtensionHost(makeBundle(client, bridge));
    await host.activate();
    await host.deactivate();

    expect(host.isActivated).toBe(false);
    expect(bridge.stop).toHaveBeenCalledTimes(1);
    expect(client.dispose).toHaveBeenCalled();
    expect(host.bundleRef.sessions.list()).toHaveLength(0);
  });

  it('activates twice is a no-op', async () => {
    const bridge = fakeBridge();
    const host = new ExtensionHost(makeBundle(fakeClient(), bridge));
    await host.activate();
    await host.activate();
    expect(bridge.start).toHaveBeenCalledTimes(1);
  });

  it('refreshes the task history tree from sessions', async () => {
    const host = new ExtensionHost(makeBundle(fakeClient(), fakeBridge()));
    await host.activate();
    const model = host.bundleRef.tree.history.model;
    expect(model.label).toContain('Task History');
    expect(host.bundleRef.sessions.list().length).toBe(1);
  });
});
