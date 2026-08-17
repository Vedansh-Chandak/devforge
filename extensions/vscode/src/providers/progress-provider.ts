/**
 * @devforge/vscode-extension — Progress provider (DF-020).
 *
 * Surfaces running DevForge commands through VS Code progress notifications
 * (withProgress), a status-bar item, and toast notifications. The progress
 * *state machine* is vscode-free and fully unit-testable.
 */

import type * as vscode from 'vscode';
import type { DevForgeCommand } from '../types.js';

/** A snapshot of the progress state. */
export interface ProgressState {
  readonly running: boolean;
  readonly command: DevForgeCommand | null;
  readonly startedAt: number | null;
  readonly message: string;
}

/** Pure progress state machine (no vscode imports). */
export class ProgressTracker {
  private running = false;
  private command: DevForgeCommand | null = null;
  private startedAt: number | null = null;
  private message = '';

  /** Current state snapshot. */
  get state(): ProgressState {
    return {
      running: this.running,
      command: this.command,
      startedAt: this.startedAt,
      message: this.message,
    };
  }

  /** Whether a command is currently running. */
  get isRunning(): boolean {
    return this.running;
  }

  /** Record that a command started. */
  start(command: DevForgeCommand, message?: string): ProgressState {
    this.running = true;
    this.command = command;
    this.startedAt = Date.now();
    this.message = message ?? `DevForge: ${command} in progress`;
    return this.state;
  }

  /** Record that the running command finished. */
  finish(message?: string): ProgressState {
    this.running = false;
    this.command = null;
    this.startedAt = null;
    this.message = message ?? '';
    return this.state;
  }

  /** Update the displayed message. */
  update(message: string): ProgressState {
    if (this.running) this.message = message;
    return this.state;
  }

  /** Elapsed milliseconds since the command started (0 when idle). */
  get elapsedMs(): number {
    if (this.startedAt === null) return 0;
    return Date.now() - this.startedAt;
  }
}

/** Options for the progress provider. */
export interface ProgressProviderOptions {
  readonly vscode: typeof import('vscode');
  readonly tracker?: ProgressTracker;
  /** Human label used in the status bar while running. */
  readonly statusBarText?: (command: DevForgeCommand) => string;
}

/**
 * Binds the {@link ProgressTracker} to VS Code's progress/status-bar UI.
 * `run` wraps a task in a `withProgress` notification while a status-bar
 * item reflects the running state.
 */
export class ProgressProvider {
  private readonly vscodeNs: typeof import('vscode');
  private readonly tracker: ProgressTracker;
  private readonly statusBarText: (command: DevForgeCommand) => string;
  private readonly statusBar: vscode.StatusBarItem;
  private runningPromise: Promise<unknown> | null = null;

  constructor(options: ProgressProviderOptions) {
    this.vscodeNs = options.vscode;
    this.tracker = options.tracker ?? new ProgressTracker();
    this.statusBarText = options.statusBarText ?? ((command) => `$(sync~spin) DevForge: ${command}`);
    this.statusBar = options.vscode.window.createStatusBarItem(
      options.vscode.StatusBarAlignment.Left,
      100,
    );
    this.statusBar.hide();
  }

  /** The underlying tracker (for tests). */
  get trackerRef(): ProgressTracker {
    return this.tracker;
  }

  /** Register the status bar item. */
  register(): vscode.Disposable {
    return { dispose: (): void => this.statusBar.dispose() };
  }

  /** Run `task` behind a progress notification. */
  async run<T>(command: DevForgeCommand, task: (progress: (message: string) => void) => Promise<T>): Promise<T> {
    if (this.runningPromise) {
      await this.runningPromise;
    }
    const resultPromise = this.vscodeNs.window.withProgress(
      {
        location: this.vscodeNs.ProgressLocation.Notification,
        title: this.statusBarText(command),
        cancellable: false,
      },
      async (progress) => {
        this.tracker.start(command);
        this.statusBar.text = this.statusBarText(command);
        this.statusBar.show();
        try {
          const result = await task((message) => {
            progress.report({ message });
            this.tracker.update(message);
          });
          this.tracker.finish();
          return result;
        } catch (error) {
          this.tracker.finish();
          throw error;
        } finally {
          this.statusBar.hide();
        }
      },
    );
    this.runningPromise = Promise.resolve(resultPromise).then(
      () => undefined,
      () => undefined,
    );
    return resultPromise;
  }

  /** Show a transient toast message. */
  notify(message: string, kind: 'info' | 'warn' | 'error' = 'info'): void {
    if (kind === 'warn') this.vscodeNs.window.showWarningMessage(message);
    else if (kind === 'error') this.vscodeNs.window.showErrorMessage(message);
    else this.vscodeNs.window.showInformationMessage(message);
  }

  /** Dispose the status bar item. */
  dispose(): void {
    this.statusBar.dispose();
  }
}
