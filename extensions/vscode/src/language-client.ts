/**
 * @devforge/vscode-extension — Language client (DF-020).
 *
 * Bootstraps and manages the `vscode-languageclient` `LanguageClient` for the
 * DevForge language server (in-process repository sync, incremental
 * documents, diagnostics, code actions, symbols, and workspace events).
 * Option builders are pure so they are unit-testable without a client.
 */

import type * as vscode from 'vscode';
import { LanguageClient, TransportKind, ServerOptions, LanguageClientOptions } from 'vscode-languageclient/node';
import type { LoggerLike } from './types.js';

/** Document languages the language server handles. */
export const DEVFORGE_SELECTOR = ['typescript', 'javascript'] as const;

/** The language server module id. */
export const SERVER_MODULE_ID = 'language-server';

/** Build ServerOptions that launch the bundled server over IPC. */
export function buildServerOptions(serverModule: string): ServerOptions {
  return {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: { module: serverModule, transport: TransportKind.ipc },
  };
}

/** Build LanguageClientOptions for the DevForge server. */
export function buildClientOptions(
  selector: readonly string[] = DEVFORGE_SELECTOR,
  configurationSection = 'devforge',
  outputChannel?: vscode.OutputChannel,
): LanguageClientOptions {
  return {
    documentSelector: selector.map((language) => ({ scheme: 'file', language })),
    synchronize: {
      configurationSection,
    },
    outputChannel,
    revealOutputChannelOn: 2, // RevealChannel.Debug
  };
}

/** A thin abstraction over the vscode-languageclient lifecycle. */
export interface LanguageClientBridge {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly running: boolean;
}

/** Options for the default language client bridge. */
export interface LanguageClientBridgeOptions {
  readonly vscode: typeof import('vscode');
  readonly serverModule: string;
  readonly selector?: readonly string[];
  readonly configurationSection?: string;
  readonly outputChannel?: vscode.OutputChannel;
  readonly logger?: LoggerLike;
  readonly clientFactory?: (name: string, serverOptions: ServerOptions, clientOptions: LanguageClientOptions) => LanguageClientLike;
}

/** Minimal shape of a LanguageClient as used by the bridge. */
export interface LanguageClientLike {
  start(): Promise<void>;
  stop(timeout?: number): Promise<void>;
  isRunning(): boolean;
}

/** A created (but not yet started) language client record. */
export interface CreatedClient {
  readonly client: LanguageClientLike;
  readonly options: { readonly server: ServerOptions; readonly client: LanguageClientOptions };
}

/**
 * The default language client bridge. Creates a `LanguageClient` wired to the
 * bundled `dist/language-server.js` and manages its lifecycle.
 */
export class VscodeLanguageClientBridge implements LanguageClientBridge {
  private readonly vscodeNs: typeof import('vscode');
  private readonly serverModule: string;
  private readonly selector: readonly string[];
  private readonly configurationSection: string;
  private readonly outputChannel: vscode.OutputChannel | undefined;
  private readonly logger: LoggerLike;
  private readonly clientFactory: (name: string, serverOptions: ServerOptions, clientOptions: LanguageClientOptions) => LanguageClientLike;
  private client: LanguageClientLike | null = null;
  private _running = false;

  constructor(options: LanguageClientBridgeOptions) {
    this.vscodeNs = options.vscode;
    this.serverModule = options.serverModule;
    this.selector = options.selector ?? DEVFORGE_SELECTOR;
    this.configurationSection = options.configurationSection ?? 'devforge';
    this.outputChannel = options.outputChannel;
    this.logger = options.logger ?? { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };
    this.clientFactory = options.clientFactory ?? ((name, serverOptions, clientOptions) => new LanguageClient(name, serverOptions, clientOptions));
  }

  get running(): boolean {
    return this._running;
  }

  /** Build the server + client options (pure, exposed for tests). */
  buildOptions(): { server: ServerOptions; client: LanguageClientOptions } {
    return {
      server: buildServerOptions(this.serverModule),
      client: buildClientOptions(this.selector, this.configurationSection, this.outputChannel),
    };
  }

  /** Create the language client (without starting it). */
  create(): CreatedClient {
    const { server, client } = this.buildOptions();
    return { client: this.clientFactory('devforge', server, client), options: { server, client } };
  }

  async start(): Promise<void> {
    if (this._running) return;
    const created = this.create();
    this.client = created.client;
    await this.client.start();
    this._running = true;
    this.logger.info('DevForge language client started.');
  }

  async stop(): Promise<void> {
    if (!this._running) return;
    const client = this.client;
    this._running = false;
    if (client) {
      await client.stop();
    }
    this.client = null;
    this.logger.info('DevForge language client stopped.');
  }
}
