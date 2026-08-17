import { describe, it, expect, vi } from 'vitest';
import {
  buildServerOptions,
  buildClientOptions,
  DEVFORGE_SELECTOR,
  SERVER_MODULE_ID,
  VscodeLanguageClientBridge,
  LanguageClientLike,
} from '../src/language-client.js';
import { TransportKind } from 'vscode-languageclient/node';
import * as vscode from './mocks/vscode.js';

describe('buildServerOptions', () => {
  it('launches the module over IPC for run and debug', () => {
    const options = buildServerOptions('/abs/language-server.js');
    expect(options.run).toEqual({ module: '/abs/language-server.js', transport: TransportKind.ipc });
    expect(options.debug).toEqual({ module: '/abs/language-server.js', transport: TransportKind.ipc });
  });
});

describe('buildClientOptions', () => {
  it('maps the selector to file documents', () => {
    const options = buildClientOptions();
    expect(options.documentSelector).toEqual([
      { scheme: 'file', language: 'typescript' },
      { scheme: 'file', language: 'javascript' },
    ]);
  });

  it('sets the configuration section to synchronize', () => {
    expect(buildClientOptions().synchronize).toEqual({ configurationSection: 'devforge' });
  });

  it('honors a custom selector and section', () => {
    const options = buildClientOptions(['rust'], 'devforge-lsp');
    expect(options.documentSelector).toEqual([{ scheme: 'file', language: 'rust' }]);
    expect(options.synchronize).toEqual({ configurationSection: 'devforge-lsp' });
  });

  it('defaults revealOutputChannelOn to debug', () => {
    expect(buildClientOptions().revealOutputChannelOn).toBe(2);
  });
});

describe('constants', () => {
  it('declares the supported languages and server module id', () => {
    expect(DEVFORGE_SELECTOR).toContain('typescript');
    expect(DEVFORGE_SELECTOR).toContain('javascript');
    expect(SERVER_MODULE_ID).toBe('language-server');
  });
});

describe('VscodeLanguageClientBridge', () => {
  function fakeClientFactory(): { factory: (name: string) => LanguageClientLike; instances: LanguageClientLike[] } {
    const instances: LanguageClientLike[] = [];
    const factory = (name: string): LanguageClientLike => {
      const instance = {
        name,
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn(() => false),
      } as unknown as LanguageClientLike;
      instances.push(instance);
      return instance;
    };
    return { factory: factory as never, instances };
  }

  function makeBridge(clientFactory: (name: string) => LanguageClientLike) {
    return new VscodeLanguageClientBridge({
      vscode: vscode as unknown as typeof import('vscode'),
      serverModule: '/abs/language-server.js',
      clientFactory: clientFactory as never,
    });
  }

  it('starts not running', () => {
    const { factory, instances } = fakeClientFactory();
    const bridge = makeBridge(factory);
    expect(bridge.running).toBe(false);
    expect(instances).toHaveLength(0);
  });

  it('start creates and starts the client', async () => {
    const { factory, instances } = fakeClientFactory();
    const bridge = makeBridge(factory);
    await bridge.start();
    expect(instances).toHaveLength(1);
    expect(instances[0]?.start).toHaveBeenCalled();
    expect(bridge.running).toBe(true);
  });

  it('start is idempotent', async () => {
    const { factory, instances } = fakeClientFactory();
    const bridge = makeBridge(factory);
    await bridge.start();
    await bridge.start();
    expect(instances).toHaveLength(1);
  });

  it('stop stops the running client and clears it', async () => {
    const { factory, instances } = fakeClientFactory();
    const bridge = makeBridge(factory);
    await bridge.start();
    await bridge.stop();
    expect(instances[0]?.stop).toHaveBeenCalled();
    expect(bridge.running).toBe(false);
  });

  it('stop is a no-op when not running', async () => {
    const { factory } = fakeClientFactory();
    const bridge = makeBridge(factory);
    await bridge.stop();
    expect(bridge.running).toBe(false);
  });

  it('buildOptions produces server and client options', () => {
    const { factory } = fakeClientFactory();
    const bridge = makeBridge(factory);
    const { server, client } = bridge.buildOptions();
    expect(server.run).toEqual({ module: '/abs/language-server.js', transport: TransportKind.ipc });
    expect(client.documentSelector).toHaveLength(2);
  });

  it('create returns a created client with its options', () => {
    const { factory, instances } = fakeClientFactory();
    const bridge = makeBridge(factory);
    const created = bridge.create();
    expect(created.client).toBe(instances[0]);
    expect(created.options.server.run).toBeDefined();
  });
});
