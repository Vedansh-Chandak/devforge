import { describe, it, expect, vi } from 'vitest';
import { DevForgeLanguageServer, RepositorySnapshot } from '../../src/language-server.js';
import type { Connection } from 'vscode-languageserver/node';

type Handler = (...args: never[]) => unknown;

/** A controllable fake LSP connection. */
function fakeConnection(): { connection: Connection; sent: { diagnostics: unknown[]; notifications: { method: string; params: unknown }[] }; workspaceHandler: ((e: unknown) => void) | null } {
  const handlers = new Map<string, Handler>();
  const sent = { diagnostics: [] as unknown[], notifications: [] as { method: string; params: unknown }[] };
  let workspaceHandler: ((e: unknown) => void) | null = null;
  const connection = {
    listen: vi.fn(),
    onInitialize: (h: Handler): unknown => handlers.set('initialize', h),
    onDidOpenTextDocument: (h: Handler): unknown => handlers.set('open', h),
    onDidChangeTextDocument: (h: Handler): unknown => handlers.set('change', h),
    onDidSaveTextDocument: (h: Handler): unknown => handlers.set('save', h),
    onDidCloseTextDocument: (h: Handler): unknown => handlers.set('close', h),
    onDocumentSymbol: (h: Handler): unknown => handlers.set('symbol', h),
    onCodeAction: (h: Handler): unknown => handlers.set('codeAction', h),
    onDidChangeConfiguration: (h: Handler): unknown => handlers.set('config', h),
    onNotification: (method: string, h: Handler): unknown => handlers.set(`notification:${method}`, h),
    onRequest: (method: string, h: Handler): unknown => handlers.set(`request:${method}`, h),
    workspace: {
      onDidChangeWorkspaceFolders: (h: (e: unknown) => void): unknown => { workspaceHandler = h; },
    },
    sendDiagnostics: (params: unknown): void => { sent.diagnostics.push(params); },
    sendNotification: (method: string, params: unknown): void => { sent.notifications.push({ method, params }); },
  } as unknown as Connection;
  const result = {
    connection,
    sent,
    get workspaceHandler(): ((e: unknown) => void) | null {
      return workspaceHandler;
    },
    get: (key: string): Handler | undefined => handlers.get(key),
  };
  return result;
}

const SNAPSHOT: RepositorySnapshot = {
  root: '/repo',
  hasGit: true,
  branch: 'main',
  packageManager: 'pnpm',
  isMonorepo: false,
  testCommand: 'pnpm test',
  buildCommand: 'pnpm build',
  lintCommand: 'pnpm lint',
};

function makeServer(repositoryProvider = vi.fn().mockResolvedValue(SNAPSHOT)) {
  const fake = fakeConnection();
  const server = new DevForgeLanguageServer(fake.connection, { repositoryProvider });
  server.registerHandlers();
  return { fake, server };
}

describe('DevForgeLanguageServer handlers', () => {
  it('start registers handlers and listens', () => {
    const fake = fakeConnection();
    const server = new DevForgeLanguageServer(fake.connection, { repositoryProvider: vi.fn().mockResolvedValue(SNAPSHOT) });
    const spy = vi.spyOn(server, 'registerHandlers');
    server.start();
    expect(spy).toHaveBeenCalled();
    expect(fake.connection.listen).toHaveBeenCalled();
  });

  it('initialize returns the server capabilities', () => {
    const { fake } = makeServer();
    const result = fake.get('initialize')!({ workspaceFolders: [] } as never);
    expect(result.capabilities.textDocumentSync.change).toBe(2);
    expect(result.capabilities.documentSymbolProvider).toBe(true);
    expect(result.capabilities.codeActionProvider.codeActionKinds).toEqual(['quickfix']);
    expect(result.serverInfo.name).toBe('devforge-language-server');
  });

  it('open document publishes diagnostics', () => {
    const { fake } = makeServer();
    fake.get('open')!({ textDocument: { uri: 'file:///a.ts', text: 'a == b', languageId: 'typescript', version: 1 } } as never);
    expect(fake.sent.diagnostics).toHaveLength(1);
    const payload = fake.sent.diagnostics[0] as { uri: string; diagnostics: unknown[] };
    expect(payload.uri).toBe('file:///a.ts');
    expect(payload.diagnostics.length).toBeGreaterThan(0);
  });

  it('change document applies incremental updates and re-scans', () => {
    const { fake } = makeServer();
    fake.get('open')!({ textDocument: { uri: 'file:///a.ts', text: 'console.log("x")', languageId: 'typescript', version: 1 } } as never);
    fake.get('change')!({
      textDocument: { uri: 'file:///a.ts', version: 2 },
      contentChanges: [{ text: '==', range: { start: { line: 0, character: 13 }, end: { line: 0, character: 13 } } }],
    } as never);
    expect(fake.sent.diagnostics).toHaveLength(2);
  });

  it('close document clears diagnostics for it', () => {
    const { fake } = makeServer();
    fake.get('open')!({ textDocument: { uri: 'file:///a.ts', text: 'x', languageId: 'typescript', version: 1 } } as never);
    fake.get('close')!({ textDocument: { uri: 'file:///a.ts' } } as never);
    const payload = fake.sent.diagnostics[fake.sent.diagnostics.length - 1] as { diagnostics: unknown[] };
    expect(payload.diagnostics).toEqual([]);
  });

  it('save re-publishes diagnostics', () => {
    const { fake } = makeServer();
    fake.get('open')!({ textDocument: { uri: 'file:///a.ts', text: 'eval(x)', languageId: 'typescript', version: 1 } } as never);
    const before = fake.sent.diagnostics.length;
    fake.get('save')!({ textDocument: { uri: 'file:///a.ts' } } as never);
    expect(fake.sent.diagnostics.length).toBe(before + 1);
  });

  it('document symbol returns extracted symbols', () => {
    const { fake } = makeServer();
    fake.get('open')!({ textDocument: { uri: 'file:///a.ts', text: 'class Foo {}', languageId: 'typescript', version: 1 } } as never);
    const result = fake.get('symbol')!({ textDocument: { uri: 'file:///a.ts' } } as never) as { name: string }[];
    expect(result[0]?.name).toBe('Foo');
  });

  it('code action offers quick fixes for diagnostics in range', () => {
    const { fake } = makeServer();
    fake.get('open')!({ textDocument: { uri: 'file:///a.ts', text: 'a == b', languageId: 'typescript', version: 1 } } as never);
    const actions = fake.get('codeAction')!({
      textDocument: { uri: 'file:///a.ts' },
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
    } as never) as { title: string; edit: unknown }[];
    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0]?.title).toContain('===');
  });

  it('code action returns none when the document is unknown', () => {
    const { fake } = makeServer();
    const result = fake.get('codeAction')!({
      textDocument: { uri: 'file:///missing.ts' },
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    } as never);
    expect(result).toBeNull();
  });

  it('workspace folder change refreshes the repository snapshot', async () => {
    const repositoryProvider = vi.fn().mockResolvedValue(SNAPSHOT);
    const { fake, server } = makeServer(repositoryProvider);
    fake.workspaceHandler!({ added: [{ uri: 'file:///new-repo' }], removed: [] });
    await vi.waitFor(() => expect(repositoryProvider).toHaveBeenCalledWith('/new-repo'));
    expect(server.repositorySnapshot).toEqual(SNAPSHOT);
    expect(fake.sent.notifications.some((n) => n.method === 'devforge/repositoryUpdated')).toBe(true);
  });

  it('devforge/setDiagnostics forwards engine diagnostics', () => {
    const { fake } = makeServer();
    const handler = fake.get('notification:devforge/setDiagnostics');
    fake.get('open')!({ textDocument: { uri: 'file:///a.ts', text: 'x', languageId: 'typescript', version: 1 } } as never);
    handler!({ uri: 'file:///a.ts', diagnostics: [{ range: {}, message: 'engine says' }] } as never);
    const payload = fake.sent.diagnostics[fake.sent.diagnostics.length - 1] as { diagnostics: unknown[] };
    expect(payload.diagnostics).toHaveLength(1);
  });

  it('devforge/repository returns the snapshot', async () => {
    const { fake, server } = makeServer();
    fake.get('initialize')!({ workspaceFolders: [{ uri: 'file:///repo' }] } as never);
    await vi.waitFor(() => expect(server.repositorySnapshot).not.toBeNull());
    const result = await fake.get('request:devforge/repository')!();
    expect(result.root).toBe('/repo');
  });
});
