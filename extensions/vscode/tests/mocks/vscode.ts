/**
 * @devforge/vscode-extension — VS Code mock for unit tests.
 *
 * Replaces the real `vscode` module (via vitest alias) with a lightweight,
 * controllable stub. Only the surface used by the extension is implemented.
 * Test seams (mutable state + helpers) are exported so tests can simulate
 * inputs and assert on side effects.
 */

/* ------------------------------------------------------------------ */
/* Primitive types                                                     */
/* ------------------------------------------------------------------ */

export type Event<T> = (listener: (e: T) => unknown, thisArgs?: unknown, disposables?: Disposable[]) => Disposable;

/** Minimal mock disposable. */
export class Disposable {
  private disposed = false;
  private readonly onDispose: () => void;

  constructor(onDispose?: () => void) {
    this.onDispose = onDispose ?? (() => undefined);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.onDispose();
  }

  static from(...disposables: Disposable[]): Disposable {
    return new Disposable(() => {
      for (const disposable of disposables) disposable.dispose();
    });
  }

  static readonly None = new Disposable();
}

/** Minimal event emitter mock. */
export class EventEmitter<T> {
  private readonly listeners = new Set<(data: T) => void>();

  get event(): Event<T> {
    return (listener: (data: T) => unknown) => {
      this.listeners.add(listener as (data: T) => void);
      return new Disposable(() => {
        this.listeners.delete(listener as (data: T) => void);
      });
    };
  }

  fire(data: T): void {
    for (const listener of [...this.listeners]) listener(data);
  }

  dispose(): void {
    this.listeners.clear();
  }
}

/** Mock URI. */
export class Uri {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  readonly query: string;
  readonly fragment: string;

  constructor(scheme: string, path: string, authority = '', query = '', fragment = '') {
    this.scheme = scheme;
    this.path = path;
    this.authority = authority;
    this.query = query;
    this.fragment = fragment;
  }

  static file(fsPath: string): Uri {
    return new Uri('file', fsPath);
  }

  static parse(value: string): Uri {
    const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/]*)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/.exec(value);
    if (match) {
      return new Uri(match[1]!, match[3] ?? '/', match[2] ?? '', match[4] ?? '', match[5] ?? '');
    }
    return new Uri('file', value.startsWith('/') ? value : `/${value}`);
  }

  get fsPath(): string {
    if (this.scheme === 'file') return this.path;
    return this.path;
  }

  toString(): string {
    let result = `${this.scheme}://${this.authority}${this.path}`;
    if (this.query) result += this.query;
    if (this.fragment) result += this.fragment;
    return result;
  }
}

/** Mock position. */
export class Position {
  readonly line: number;
  readonly character: number;

  constructor(line: number, character: number) {
    this.line = line;
    this.character = character;
  }
}

/** Mock range. */
export class Range {
  readonly start: Position;
  readonly end: Position;

  constructor(start: Position | number, end?: Position | number, third?: number, fourth?: number) {
    if (typeof start === 'number' && typeof end === 'number') {
      this.start = new Position(start, third ?? 0);
      this.end = new Position(end, fourth ?? 0);
    } else if (start instanceof Position && end instanceof Position) {
      this.start = start;
      this.end = end;
    } else {
      this.start = new Position(0, 0);
      this.end = new Position(0, 0);
    }
  }

  get isEmpty(): boolean {
    return this.start.line === this.end.line && this.start.character === this.end.character;
  }
}

/** Mock selection (subset of Range used by the extension). */
export class Selection {
  readonly start: Position;
  readonly end: Position;

  constructor(start: Position, end: Position) {
    this.start = start;
    this.end = end;
  }

  get isEmpty(): boolean {
    return this.start.line === this.end.line && this.start.character === this.end.character;
  }
}

/** Mock diagnostic. */
export class Diagnostic {
  readonly range: Range;
  readonly message: string;
  readonly severity: number | undefined;
  source: string | undefined;
  code: string | number | undefined;

  constructor(range: Range, message: string, severity?: number) {
    this.range = range;
    this.message = message;
    this.severity = severity;
  }
}

/** Mock tree item. */
export class TreeItem {
  readonly label: string;
  readonly collapsibleState: number;
  id: string | undefined;
  description: string | undefined;
  tooltip: unknown;
  iconPath: unknown;
  command: { command: string; title: string; arguments?: unknown[] } | undefined;

  constructor(label: string, collapsibleState?: number) {
    this.label = label;
    this.collapsibleState = collapsibleState ?? TreeItemCollapsibleState.None;
  }
}

/** Mock theme icon. */
export class ThemeIcon {
  readonly id: string;

  constructor(id: string) {
    this.id = id;
  }
}

/** Mock output channel. */
export class OutputChannel {
  private readonly lines: string[] = [];
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  appendLine(line: string): void {
    this.lines.push(line);
  }

  append(_value: string): void {}

  show(): void {}

  dispose(): void {}
}

/** Mock status bar item. */
export class StatusBarItem {
  text = '';
  tooltip: string | undefined;
  visible = false;

  show(): void {
    this.visible = true;
  }

  hide(): void {
    this.visible = false;
  }

  dispose(): void {}
}

/** Mock diagnostic collection. */
export class DiagnosticCollection {
  readonly name: string;
  entries: [Uri, Diagnostic[]][] = [];

  constructor(name: string) {
    this.name = name;
  }

  set(entries: [Uri, Diagnostic[]][]): void {
    this.entries = entries;
  }

  clear(): void {
    this.entries = [];
  }

  dispose(): void {
    this.entries = [];
  }
}

/* ------------------------------------------------------------------ */
/* Enum-like constants                                                 */
/* ------------------------------------------------------------------ */

export const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3,
} as const;

export const StatusBarAlignment = {
  Left: 1,
  Right: 2,
} as const;

export const ViewColumn = {
  Active: -1,
  Beside: -2,
  One: 1,
  Two: 2,
} as const;

export const ProgressLocation = {
  Notification: 15,
  Window: 10,
} as const;

export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
} as const;

/* ------------------------------------------------------------------ */
/* Test seams                                                          */
/* ------------------------------------------------------------------ */

/** Registered commands: id -> handler. */
export const __commands = new Map<string, (...args: unknown[]) => unknown>();

/** Input box result queue. `undefined` = cancelled. */
export const __inputBoxQueue: (string | undefined)[] = [];

/** The active text editor (or undefined). */
export let __activeTextEditor: { selection: Selection; document: { getText: (r?: unknown) => string } } | undefined;

/** Workspace configuration values for `devforge.*`. */
export const __configuration = new Map<string, unknown>();

/** Created status bar items. */
export const __statusBarItems: StatusBarItem[] = [];

/** Created tree views. */
export const __treeViews: { viewId: string; options: unknown }[] = [];

/** Created diagnostic collections. */
export const __diagnosticCollections: DiagnosticCollection[] = [];

/** Registered text-document content providers: scheme -> provider. */
export const __contentProviders = new Map<string, { provideTextDocumentContent: (uri: Uri) => string }>();

/** Documents opened via workspace.openTextDocument. */
export const __openedDocuments: Uri[] = [];

/** Documents shown via window.showTextDocument. */
export const __shownDocuments: { uri: Uri; options: unknown }[] = [];

/** Toast messages captured via showInformationMessage/showWarningMessage/showErrorMessage. */
export const __toasts: { message: string; kind: 'info' | 'warn' | 'error' }[] = [];

/** withProgress invocations. */
export const __withProgressCalls: { options: unknown; report: (message: string) => void }[] = [];

/** Webview views resolved by the chat provider. */
export const __webviewViews: WebviewView[] = [];

/** Workspace folders. */
export const __workspaceFolders: { uri: Uri; name: string; index: number }[] = [
  { uri: Uri.file('/workspace/test-repo'), name: 'test-repo', index: 0 },
];

/** Extension context mock. */
export const __extensionContext = {
  subscriptions: [] as Disposable[],
  asAbsolutePath: (relative: string): string => `/workspace/test-repo/extensions/vscode/${relative}`,
};

/* ------------------------------------------------------------------ */
/* Mock text document                                                  */
/* ------------------------------------------------------------------ */

export class TextDocument {
  readonly uri: Uri;
  readonly languageId: string;
  readonly version: number;
  private readonly text: string;

  constructor(uri: Uri, text: string, languageId = 'typescript', version = 1) {
    this.uri = uri;
    this.text = text;
    this.languageId = languageId;
    this.version = version;
  }

  getText(range?: unknown): string {
    if (range === undefined) return this.text;
    return this.text;
  }
}

/** Test helper to register a text document that openTextDocument will return. */
export const __registeredDocuments = new Map<string, TextDocument>();

export function __addDocument(uri: Uri, text: string, languageId = 'typescript', version = 1): TextDocument {
  const document = new TextDocument(uri, text, languageId, version);
  __registeredDocuments.set(uri.toString(), document);
  return document;
}

/* ------------------------------------------------------------------ */
/* Workspace / window / languages / commands namespaces                */
/* ------------------------------------------------------------------ */

export const workspace = {
  workspaceFolders: __workspaceFolders,

  getConfiguration(section: string): { get: <T>(key: string) => T | undefined } {
    return {
      get: <T>(key: string): T | undefined => {
        const fullKey = section ? `${section}.${key}` : key;
        return __configuration.get(fullKey) as T | undefined;
      },
    };
  },

  registerTextDocumentContentProvider(
    scheme: string,
    provider: { provideTextDocumentContent: (uri: Uri) => string },
  ): Disposable {
    __contentProviders.set(scheme, provider);
    return new Disposable(() => {
      __contentProviders.delete(scheme);
    });
  },

  async openTextDocument(uri: Uri): Promise<TextDocument> {
    __openedDocuments.push(uri);
    const existing = __registeredDocuments.get(uri.toString());
    if (existing) return existing;
    const provider = __contentProviders.get(uri.scheme);
    const text = provider ? provider.provideTextDocumentContent(uri) : '';
    return new TextDocument(uri, text);
  },

  textDocuments: [] as TextDocument[],
};

export const window = {
  activeTextEditor: __activeTextEditor,
  ProgressLocation,

  registerWebviewViewProvider(
    _viewId: string,
    provider: { resolveWebviewView: (view: unknown) => void },
  ): Disposable {
    return new Disposable();
  },

  createTreeView(viewId: string, options: unknown): { viewId: string; options: unknown; reveal: () => Promise<void>; dispose: () => void } {
    const view = { viewId, options, reveal: (): Promise<void> => Promise.resolve(), dispose: (): void => undefined };
    __treeViews.push(view);
    return view;
  },

  createStatusBarItem(_alignment?: number, _priority?: number): StatusBarItem {
    const item = new StatusBarItem();
    __statusBarItems.push(item);
    return item;
  },

  createOutputChannel(name: string): OutputChannel {
    return new OutputChannel(name);
  },

  async showTextDocument(document: TextDocument, options?: unknown): Promise<TextDocument> {
    __shownDocuments.push({ uri: document.uri, options });
    return document;
  },

  async showInputBox(_options?: unknown): Promise<string | undefined> {
    return __inputBoxQueue.shift();
  },

  showInformationMessage(message: string): Promise<unknown> {
    __toasts.push({ message, kind: 'info' });
    return Promise.resolve(undefined);
  },

  showWarningMessage(message: string): Promise<unknown> {
    __toasts.push({ message, kind: 'warn' });
    return Promise.resolve(undefined);
  },

  showErrorMessage(message: string): Promise<unknown> {
    __toasts.push({ message, kind: 'error' });
    return Promise.resolve(undefined);
  },

  withProgress<T>(
    options: unknown,
    task: (progress: { report: (value: { message?: string; increment?: number }) => void }) => Promise<T>,
  ): Promise<T> {
    let reportMessage = '';
    const report = (value: { message?: string; increment?: number }): void => {
      if (value.message !== undefined) reportMessage = value.message;
    };
    __withProgressCalls.push({ options, report: (message: string): void => report({ message }) });
    return Promise.resolve().then(() => task({ report }));
  },
};

export const languages = {
  createDiagnosticCollection(name: string): DiagnosticCollection {
    const collection = new DiagnosticCollection(name);
    __diagnosticCollections.push(collection);
    return collection;
  },
};

export const commands = {
  registerCommand(id: string, handler: (...args: unknown[]) => unknown): Disposable {
    __commands.set(id, handler);
    return new Disposable(() => {
      __commands.delete(id);
    });
  },

  async executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T> {
    const handler = __commands.get(id);
    if (!handler) throw new Error(`Unknown command: ${id}`);
    return (await handler(...args)) as T;
  },
};

/* ------------------------------------------------------------------ */
/* Webview                                                             */
/* ------------------------------------------------------------------ */

export class Webview {
  html = '';
  options: unknown = {};

  postMessage(_message: unknown): Thenable<boolean> {
    return Promise.resolve(true);
  }
}

export class WebviewView {
  readonly webview: Webview = new Webview();
  private readonly onDidDisposeEmitter = new EventEmitter<void>();

  get onDidDispose(): Event<void> {
    return this.onDidDisposeEmitter.event;
  }

  /** Test helper: simulate the view being closed by the user. */
  __fireDispose(): void {
    this.onDidDisposeEmitter.fire();
  }
}

/** Convenience: set the active editor selection. */
export function __setActiveTextEditor(selection: Selection | undefined): void {
  __activeTextEditor = selection
    ? { selection, document: { getText: (): string => 'const selected = true;' } }
    : undefined;
  window.activeTextEditor = __activeTextEditor;
}

/** Convenience: reset all mock state between tests. */
export function __resetMocks(): void {
  __commands.clear();
  __inputBoxQueue.length = 0;
  __configuration.clear();
  __statusBarItems.length = 0;
  __treeViews.length = 0;
  __diagnosticCollections.length = 0;
  __contentProviders.clear();
  __openedDocuments.length = 0;
  __shownDocuments.length = 0;
  __toasts.length = 0;
  __withProgressCalls.length = 0;
  __webviewViews.length = 0;
  __registeredDocuments.clear();
  __activeTextEditor = undefined;
  window.activeTextEditor = undefined;
}

export default {
  Disposable,
  EventEmitter,
  Uri,
  Position,
  Range,
  Selection,
  Diagnostic,
  TreeItem,
  ThemeIcon,
  OutputChannel,
  StatusBarItem,
  DiagnosticCollection,
  DiagnosticSeverity,
  StatusBarAlignment,
  ViewColumn,
  ProgressLocation,
  TreeItemCollapsibleState,
  workspace,
  window,
  languages,
  commands,
  TextDocument,
  Webview,
  WebviewView,
};
