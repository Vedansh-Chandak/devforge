/**
 * @devforge/vscode-extension — Shared command dependencies (DF-020).
 *
 * The dependency bundle every command handler receives from the extension
 * host. Type-only — the extension host composes these at activation time.
 */

import type * as vscode from 'vscode';
import type { SessionManager } from '../services/session-manager.js';
import type { Configuration } from '../services/configuration.js';
import type { ChatView } from '../providers/chat-provider.js';
import type { DiffProvider } from '../providers/diff-provider.js';
import type { DiagnosticsProvider } from '../providers/diagnostics-provider.js';
import type { ProgressProvider } from '../providers/progress-provider.js';
import type { TreeRefresher } from '../extension.js';
import type { LoggerLike } from '../types.js';

/** The full dependency bundle available to commands. */
export interface CommandDeps {
  readonly vscode: typeof import('vscode');
  readonly sessions: SessionManager;
  readonly configuration: Configuration;
  readonly chat: ChatView;
  readonly diff: DiffProvider;
  readonly diagnostics: DiagnosticsProvider;
  readonly progress: ProgressProvider;
  readonly tree: TreeRefresher;
  readonly logger: LoggerLike;
}
