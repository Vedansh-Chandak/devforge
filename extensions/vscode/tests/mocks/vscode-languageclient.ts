/**
 * @devforge/vscode-extension — Mock for `vscode-languageclient/node`.
 *
 * The real package `require('vscode')` at module load, which is not
 * available in the Node test environment. This mock provides the minimal
 * runtime surface the extension uses.
 */

/** Transport kinds (mirrors the real enum values). */
export const TransportKind = {
  stdio: 1,
  ipc: 2,
  pipe: 3,
  socket: 4,
} as const;

/** Structural types (compile-time only). */
export type ServerOptions = {
  run?: unknown;
  debug?: unknown;
};

export type LanguageClientOptions = {
  documentSelector?: unknown;
  synchronize?: unknown;
  outputChannel?: unknown;
  revealOutputChannelOn?: number;
};

export type RevealOutputChannelOn = number;

/** Mock LanguageClient with a controllable lifecycle. */
export class LanguageClient {
  readonly name: string;
  readonly serverOptions: unknown;
  readonly clientOptions: unknown;
  private started = false;
  private stopped = false;

  constructor(name: string, serverOptions: unknown, clientOptions: unknown) {
    this.name = name;
    this.serverOptions = serverOptions;
    this.clientOptions = clientOptions;
  }

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(_timeout?: number): Promise<void> {
    this.stopped = true;
  }

  isRunning(): boolean {
    return this.started && !this.stopped;
  }
}

export default { LanguageClient, TransportKind };
