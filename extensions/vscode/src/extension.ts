/**
 * @devforge/vscode-extension — Extension entry point (DF-020).
 *
 * Activates the extension host: wires the DevForge client, session manager,
 * providers, commands, views, and the language client, then registers
 * everything with the `vscode` extension context.
 *
 * The {@link ExtensionHost} accepts an injectable dependency bundle so the
 * whole activation path is unit-testable against a vscode mock.
 */

import * as vscode from 'vscode';
import type { RepositoryContext, DevForgeCommand, LoggerLike } from './types.js';
import { Configuration, WorkspaceConfigurationReader } from './services/configuration.js';
import { DevForgeClient, RealCliAdapter, CliAdapter } from './services/devforge-client.js';
import { SessionManager } from './services/session-manager.js';
import { ChatViewProvider, ChatView } from './providers/chat-provider.js';
import { DiffProvider } from './providers/diff-provider.js';
import { DiagnosticsProvider } from './providers/diagnostics-provider.js';
import { ProgressProvider, ProgressTracker } from './providers/progress-provider.js';
import { DevForgeTreeProvider, buildRepositoryTree, buildTaskHistoryTree, buildDiagnosticsTree, buildDoctorTree } from './providers/tree-provider.js';
import { VscodeLanguageClientBridge, LanguageClientBridge } from './language-client.js';
import { registerAskCommand, registerExplainCommand } from './commands/ask.js';
import { registerPlanCommand } from './commands/plan.js';
import { registerFixCommand } from './commands/fix.js';
import { registerReviewCommand } from './commands/review.js';
import { registerRunCommand } from './commands/run.js';
import { registerStatusCommand } from './commands/status.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerDiffInlineCommands } from './commands/diff.js';
import type { CommandDeps } from './commands/deps.js';
import { DevForgeClientError, NoWorkspaceError } from './errors.js';

/** Simple logger writing to the VS Code console. */
export const consoleLogger: LoggerLike = {
  trace: (m, ...a) => console.debug(m, ...a),
  debug: (m, ...a) => console.debug(m, ...a),
  info: (m, ...a) => console.info(m, ...a),
  warn: (m, ...a) => console.warn(m, ...a),
  error: (m, ...a) => console.error(m, ...a),
};

/** Tree refresh entry points used by commands and the host. */
export interface TreeRefresher {
  refreshAll(): void;
  refreshHistory(): void;
  refreshRepository(repository?: RepositoryContext): void;
  refreshDiagnostics(): void;
}

/** The full dependency bundle accepted by {@link ExtensionHost}. */
export interface HostBundle {
  readonly vscode: typeof import('vscode');
  readonly context: vscode.ExtensionContext;
  readonly configuration: Configuration;
  readonly sessions: SessionManager;
  readonly chat: ChatViewProvider;
  readonly diff: DiffProvider;
  readonly diagnostics: DiagnosticsProvider;
  readonly progress: ProgressProvider;
  readonly languageClient: LanguageClientBridge;
  readonly logger: LoggerLike;
  readonly tree: {
    readonly history: DevForgeTreeProvider;
    readonly repository: DevForgeTreeProvider;
    readonly diagnostics: DevForgeTreeProvider;
  };
  /** Optional override for the active client factory (test seam). */
  readonly clientFactory?: (root: string) => DevForgeClient;
}

/** The default client factory wired to the real CLI adapter. */
export function defaultClientFactory(configuration: Configuration, adapter: CliAdapter): (root: string) => DevForgeClient {
  return (root: string) =>
    new DevForgeClient({
      adapter,
      workspaceRoot: root,
      getConfig: () => configuration.read(),
      getCliOptions: () => configuration.toCliOptions(),
      getEnvOverrides: () => configuration.toEnvOverrides(),
    });
}

/**
 * Build the default host bundle from a vscode namespace and extension
 * context. Everything here can be overridden in tests.
 */
export function buildDefaultBundle(
  vscodeNs: typeof import('vscode'),
  context: vscode.ExtensionContext,
  overrides: Partial<HostBundle> = {},
): HostBundle {
  const logger = overrides.logger ?? consoleLogger;
  const workspaceRoot = vscodeNs.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

  const configuration = overrides.configuration ??
    new Configuration(new WorkspaceConfigurationReader(vscodeNs.workspace.getConfiguration('devforge')));

  const adapter = new RealCliAdapter();
  const clientFactory = overrides.clientFactory ?? defaultClientFactory(configuration, adapter);

  const historyTree = overrides.tree?.history ?? new DevForgeTreeProvider(vscodeNs);
  const repositoryTree = overrides.tree?.repository ?? new DevForgeTreeProvider(vscodeNs);
  const diagnosticsTree = overrides.tree?.diagnostics ?? new DevForgeTreeProvider(vscodeNs);
  const tree = overrides.tree ?? { history: historyTree, repository: repositoryTree, diagnostics: diagnosticsTree };

  const sessions = overrides.sessions ?? new SessionManager({
    createClient: clientFactory,
    events: {
      onTaskRecorded: (session) => {
        tree.history.setModel(buildTaskHistoryTree(sessions.list()));
      },
    },
  });

  const chat = overrides.chat ?? new ChatViewProvider({ vscode: vscodeNs });
  const progress = overrides.progress ?? new ProgressProvider({ vscode: vscodeNs });
  const diagnostics = overrides.diagnostics ?? new DiagnosticsProvider({ vscode: vscodeNs, workspaceRoot });
  const diff = overrides.diff ?? new DiffProvider({
    vscode: vscodeNs,
    logger,
    reject: async (files) => {
      const client = sessions.getActiveClient();
      if (client) await client.rejectDiff(files);
    },
  });

  const languageClient = overrides.languageClient ?? new VscodeLanguageClientBridge({
    vscode: vscodeNs,
    serverModule: context.asAbsolutePath('./dist/language-server.js'),
    logger,
  });

  return {
    vscode: vscodeNs,
    context,
    configuration,
    sessions,
    chat,
    diff,
    diagnostics,
    progress,
    languageClient,
    logger,
    tree,
    clientFactory,
  };
}

/** The extension host: registers commands, views, and services. */
export class ExtensionHost {
  private readonly bundle: HostBundle;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly treeRefresher: TreeRefresher;
  private activated = false;

  constructor(bundle: HostBundle) {
    this.bundle = bundle;
    this.treeRefresher = this.createTreeRefresher();
  }

  /** Whether the host has been activated. */
  get isActivated(): boolean {
    return this.activated;
  }

  /** The underlying bundle (for tests). */
  get bundleRef(): HostBundle {
    return this.bundle;
  }

  /** Build the tree refresher used by commands. */
  private createTreeRefresher(): TreeRefresher {
    const { vscodeNs } = this;
    return {
      refreshAll: (): void => this.refreshTrees(),
      refreshHistory: (): void => {
        this.bundle.tree.history.setModel(buildTaskHistoryTree(this.bundle.sessions.list()));
      },
      refreshRepository: (repository?: RepositoryContext): void => {
        if (repository) {
          this.bundle.tree.repository.setModel(buildRepositoryTree(repository));
        }
      },
      refreshDiagnostics: (): void => {
        // Diagnostics tree is rebuilt from the collection by commands.
        void vscodeNs;
      },
    };
  }

  private get vscodeNs(): typeof import('vscode') {
    return this.bundle.vscode;
  }

  /** Activate: register everything with the extension context. */
  async activate(): Promise<void> {
    if (this.activated) return;
    const { bundle } = this;

    const root = bundle.vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      bundle.logger.warn('DevForge: no workspace folder open; commands will be unavailable until one is opened.');
    } else {
      this.ensureActiveSession(root);
    }

    this.push(bundle.vscode.commands.registerCommand('devforge.activateSession', async (root: string) => {
      this.ensureActiveSession(root);
    }));

    this.registerCommands();
    this.registerViews();
    this.registerDiffProvider();
    this.registerProgress();

    // Refresh repository tree once a session exists.
    this.refreshRepositoryFromActiveSession();

    try {
      await bundle.languageClient.start();
    } catch (error) {
      bundle.logger.warn(`DevForge language client failed to start: ${String(error)}`);
    }

    this.activated = true;
  }

  /** Deactivate: dispose everything. */
  async deactivate(): Promise<void> {
    if (!this.activated && this.disposables.length === 0) return;
    this.activated = false;
    try {
      await this.bundle.languageClient.stop();
    } catch {
      // ignore
    }
    for (const disposable of this.disposables.splice(0)) {
      try {
        disposable.dispose();
      } catch {
        // ignore
      }
    }
    await this.bundle.sessions.dispose();
  }

  private registerCommands(): void {
    const { bundle } = this;
    const deps: CommandDeps = {
      vscode: bundle.vscode,
      sessions: bundle.sessions,
      configuration: bundle.configuration,
      chat: bundle.chat,
      diff: bundle.diff,
      diagnostics: bundle.diagnostics,
      progress: bundle.progress,
      tree: this.treeRefresher,
      logger: bundle.logger,
    };

    this.push(registerAskCommand(deps));
    this.push(registerExplainCommand(deps));
    this.push(registerPlanCommand(deps));
    this.push(registerFixCommand(deps));
    this.push(registerReviewCommand(deps));
    this.push(registerRunCommand(deps));
    this.push(registerStatusCommand(deps));
    this.push(registerDoctorCommand(deps));
    this.push(registerDiffInlineCommands(deps));
  }

  private registerViews(): void {
    const { bundle } = this;
    this.push(bundle.vscode.window.registerWebviewViewProvider('devforge.chat', bundle.chat));
    this.push(bundle.vscode.window.createTreeView('devforge.taskHistory', {
      treeDataProvider: bundle.tree.history,
      showCollapseAll: true,
    }));
    this.push(bundle.vscode.window.createTreeView('devforge.repositoryContext', {
      treeDataProvider: bundle.tree.repository,
      showCollapseAll: true,
    }));
    this.push(bundle.vscode.window.createTreeView('devforge.diagnostics', {
      treeDataProvider: bundle.tree.diagnostics,
      showCollapseAll: true,
    }));
  }

  private registerDiffProvider(): void {
    this.push(this.bundle.diff.register());
  }

  private registerProgress(): void {
    this.push(this.bundle.progress.register());
    const tracker: ProgressTracker = this.bundle.progress.trackerRef;
    void tracker;
  }

  private ensureActiveSession(root: string): void {
    this.bundle.sessions.activate(root);
    this.bundle.tree.history.setModel(buildTaskHistoryTree(this.bundle.sessions.list()));
  }

  private refreshTrees(): void {
    this.bundle.tree.history.setModel(buildTaskHistoryTree(this.bundle.sessions.list()));
  }

  private refreshRepositoryFromActiveSession(): void {
    const session = this.bundle.sessions.getActiveSession();
    const client = this.bundle.sessions.getActiveClient();
    if (!session || !client) return;
    client
      .repositoryContext()
      .then((repository) => {
        this.bundle.tree.repository.setModel(buildRepositoryTree(repository));
      })
      .catch((error) => {
        this.bundle.logger.warn(`Unable to refresh repository context: ${String(error)}`);
      });
  }

  private push(disposable: vscode.Disposable): void {
    this.disposables.push(disposable);
  }
}

/** Global host reference so `deactivate` can reach the running instance. */
let activeHost: ExtensionHost | null = null;

/** Activate the extension. */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const bundle = buildDefaultBundle(vscode, context);
  const host = new ExtensionHost(bundle);
  activeHost = host;
  await host.activate();
  context.subscriptions.push({ dispose: (): void => void host.deactivate() });
}

/** Deactivate the extension. */
export async function deactivate(): Promise<void> {
  const host = activeHost;
  activeHost = null;
  if (host) {
    await host.deactivate();
  }
}

/** Re-export errors used by consumers. */
export { DevForgeClientError, NoWorkspaceError };
export type { DevForgeCommand };
