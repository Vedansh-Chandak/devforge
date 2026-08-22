/**
 * @devforge/vscode-extension — Language server (DF-020).
 *
 * A self-contained LSP server running the DevForge analysis layer:
 *
 *   - repository synchronization (workspace folders → repository snapshot)
 *   - incremental document updates (DocumentStore)
 *   - diagnostics forwarding (rule-based diagnostics + engine forwarding)
 *   - code action registration (quick fixes for flagged diagnostics)
 *   - symbol requests (DocumentSymbol extraction)
 *   - workspace events (folder/config change notifications)
 *
 * The pure pieces (DocumentStore, SymbolExtractor, DiagnosticEngine,
 * CodeActionProvider) have no `vscode-languageserver` dependency and are
 * fully unit-testable.
 */

import {
  createConnection,
  Connection,
  TextDocumentSyncKind,
  SymbolKind,
  DiagnosticSeverity,
  CodeActionKind,
  CodeActionParams,
  DocumentSymbolParams,
  Position,
  WorkspaceFoldersChangeEvent,
  InitializeParams,
  DidChangeTextDocumentParams,
  DidOpenTextDocumentParams,
  DidSaveTextDocumentParams,
  DidCloseTextDocumentParams,
} from 'vscode-languageserver/node';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { Diagnostic, DocumentSymbol, CodeAction } from 'vscode-languageserver/node';

/* ------------------------------------------------------------------ */
/* DocumentStore                                                       */
/* ------------------------------------------------------------------ */

/** A document tracked by the language server. */
export interface TrackedDocument {
  readonly uri: string;
  readonly languageId: string;
  readonly version: number;
  text: string;
}

/** A content change as received from the client (incremental or full). */
export interface ContentChange {
  readonly text: string;
  readonly range?: PositionRange;
}

/** Serialized position/range used by the pure store. */
export interface PositionRange {
  readonly start: { readonly line: number; readonly character: number };
  readonly end: { readonly line: number; readonly character: number };
}

/** Pure, incremental document store (no vscode imports). */
export class DocumentStore {
  private readonly documents = new Map<string, TrackedDocument>();

  /** Open a document with full text. */
  open(uri: string, languageId: string, text: string, version = 1): TrackedDocument {
    const document: TrackedDocument = { uri, languageId, version, text };
    this.documents.set(uri, document);
    return document;
  }

  /** Close a document. Returns true when it existed. */
  close(uri: string): boolean {
    return this.documents.delete(uri);
  }

  /** Get a tracked document by uri. */
  get(uri: string): TrackedDocument | undefined {
    return this.documents.get(uri);
  }

  /** All tracked documents. */
  all(): readonly TrackedDocument[] {
    return [...this.documents.values()];
  }

  /** Number of tracked documents. */
  get size(): number {
    return this.documents.size;
  }

  /**
   * Apply content changes (full or incremental). Incremental changes carry a
   * range whose characters are replaced by the change text. Returns the
   * updated document, or undefined when the uri is unknown.
   */
  update(uri: string, changes: readonly ContentChange[], version: number): TrackedDocument | undefined {
    const document = this.documents.get(uri);
    if (!document) return undefined;
    let text = document.text;
    for (const change of changes) {
      text = applyChange(text, change);
    }
    const updated: TrackedDocument = { ...document, text, version };
    this.documents.set(uri, updated);
    return updated;
  }

  /** Resolve a (line, character) position to an absolute offset. */
  static offsetOf(text: string, line: number, character: number): number {
    const lines = text.split('\n');
    const safeLine = Math.max(0, Math.min(line, lines.length - 1));
    let offset = 0;
    for (let i = 0; i < safeLine; i++) {
      offset += lines[i]!.length + 1;
    }
    return offset + Math.max(0, character);
  }

  /** Resolve an absolute offset to a (line, character) position. */
  static positionOf(text: string, offset: number): { line: number; character: number } {
    const safeOffset = Math.max(0, Math.min(offset, text.length));
    let line = 0;
    let character = 0;
    for (let i = 0; i < safeOffset; i++) {
      if (text[i] === '\n') {
        line += 1;
        character = 0;
      } else {
        character += 1;
      }
    }
    return { line, character };
  }
}

/** Apply a single content change to a document text. */
export function applyChange(text: string, change: ContentChange): string {
  if (!change.range) return change.text;
  const start = DocumentStore.offsetOf(text, change.range.start.line, change.range.start.character);
  const end = DocumentStore.offsetOf(text, change.range.end.line, change.range.end.character);
  return `${text.slice(0, start)}${change.text}${text.slice(end)}`;
}

/* ------------------------------------------------------------------ */
/* SymbolExtractor                                                     */
/* ------------------------------------------------------------------ */

/** A symbol extracted from a document. */
export interface ExtractedSymbol {
  readonly name: string;
  readonly kind: SymbolKind;
  /** 0-based line and character of the start. */
  readonly line: number;
  readonly character: number;
  readonly endLine: number;
  readonly children: readonly ExtractedSymbol[];
}

const SYMBOL_PATTERNS: readonly { readonly kind: SymbolKind; readonly pattern: RegExp }[] = [
  { kind: SymbolKind.Class, pattern: /\bclass\s+([A-Za-z_$][\w$]*)/g },
  { kind: SymbolKind.Interface, pattern: /\binterface\s+([A-Za-z_$][\w$]*)/g },
  { kind: SymbolKind.Enum, pattern: /\benum\s+([A-Za-z_$][\w$]*)/g },
  { kind: SymbolKind.TypeParameter, pattern: /\btype\s+([A-Za-z_$][\w$]*)\s*=/g },
  { kind: SymbolKind.Function, pattern: /\b(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g },
  { kind: SymbolKind.Method, pattern: /\b(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g },
  { kind: SymbolKind.Variable, pattern: /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g },
];

/** Extract top-level and nested symbols from source text. */
export class SymbolExtractor {
  extract(text: string): readonly ExtractedSymbol[] {
    return SymbolExtractor.extractSymbols(text);
  }

  /** Pure extraction (static, testable). */
  static extractSymbols(text: string): readonly ExtractedSymbol[] {
    const lines = text.split('\n');
    const symbols: ExtractedSymbol[] = [];

    for (const { kind, pattern } of SYMBOL_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const name = match[1];
        if (!name) continue;
        // Method matches that are actually `function`/`async function`
        // declarations are already covered by the Function pattern.
        if (kind === SymbolKind.Method && /(?:^|\W)(?:async\s+)?function\s+$/.test(text.slice(0, match.index))) {
          continue;
        }
        const offset = match.index;
        const pos = DocumentStore.positionOf(text, offset);
        const endPos = DocumentStore.positionOf(text, offset + name.length);
        if (symbols.some((s) => s.line === pos.line && s.character === pos.character && s.kind === kind)) {
          continue;
        }
        const children = findBodySymbols(text, lines, kind, offset, pos);
        symbols.push({
          name,
          kind,
          line: pos.line,
          character: pos.character,
          endLine: endPos.line,
          children,
        });
      }
    }

    return symbols.sort((a, b) => (a.line - b.line) || (a.character - b.character));
  }
}

/** Find symbols nested inside a class/interface body. */
function findBodySymbols(
  text: string,
  lines: readonly string[],
  kind: SymbolKind,
  offset: number,
  pos: { line: number; character: number },
): readonly ExtractedSymbol[] {
  if (kind !== SymbolKind.Class && kind !== SymbolKind.Interface) return [];
  const brace = findNextBrace(text, offset);
  if (brace === -1) return [];
  const endBrace = findMatchingBrace(text, brace);
  if (endBrace === -1) return [];
  const body = text.slice(brace + 1, endBrace);
  return SymbolExtractor.extractSymbols(body).map((child) => ({
    ...child,
    line: child.line + countNewlinesBefore(text, brace),
    character: child.line === 0 ? child.character : child.character,
    endLine: child.endLine + countNewlinesBefore(text, brace),
  }));
}

function findNextBrace(text: string, offset: number): number {
  return text.indexOf('{', offset);
}

function findMatchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function countNewlinesBefore(text: string, offset: number): number {
  let count = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') count += 1;
  }
  return count;
}

/* ------------------------------------------------------------------ */
/* DiagnosticEngine                                                    */
/* ------------------------------------------------------------------ */

/** A deterministic rule-based diagnostic. */
export interface RuleDiagnostic {
  readonly line: number;
  readonly character: number;
  readonly endLine: number;
  readonly endCharacter: number;
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
  readonly code: string;
}

const RULES: readonly { readonly severity: RuleDiagnostic['severity']; readonly code: string; readonly message: string; readonly pattern: RegExp }[] = [
  { severity: 'error', code: 'devforge.eqeqeq', message: 'Use strict equality (=== / !==) instead of loose equality.', pattern: /([^=!<>])(==|!=)(?!=)/g },
  { severity: 'error', code: 'devforge.no-eval', message: 'Avoid eval(): it executes arbitrary code.', pattern: /\beval\s*\(/g },
  { severity: 'warning', code: 'devforge.no-console', message: 'Console logging found in source; use the project logger instead.', pattern: /\bconsole\.(log|warn|error|debug)\s*\(/g },
  { severity: 'warning', code: 'devforge.no-innerhtml', message: 'Avoid innerHTML assignment; use textContent or createElement.', pattern: /\.innerHTML\s*=/g },
  { severity: 'info', code: 'devforge.todo', message: 'TODO/FIXME marker found.', pattern: /\/\/\s*(TODO|FIXME|XXX)\b/g },
];

/** Compute rule-based diagnostics for a document text. */
export class DiagnosticEngine {
  scan(text: string): readonly RuleDiagnostic[] {
    return DiagnosticEngine.scanText(text);
  }

  /** Pure scan (static, testable). */
  static scanText(text: string): readonly RuleDiagnostic[] {
    const results: RuleDiagnostic[] = [];
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = rule.pattern.exec(text)) !== null) {
        const start = match.index + (match[1] !== undefined ? match[1].length : 0);
        const startPos = DocumentStore.positionOf(text, start);
        const endPos = DocumentStore.positionOf(text, match.index + match[0].length);
        results.push({
          line: startPos.line,
          character: startPos.character,
          endLine: endPos.line,
          endCharacter: endPos.character,
          severity: rule.severity,
          message: rule.message,
          code: rule.code,
        });
      }
    }
    return results.sort((a, b) => (a.line - b.line) || (a.character - b.character));
  }

  /** Convert a rule diagnostic into an LSP diagnostic. */
  toLsp(diagnostic: RuleDiagnostic, uri: string, text: string): Diagnostic {
    const lsp: Diagnostic = {
      range: {
        start: { line: diagnostic.line, character: diagnostic.character },
        end: { line: diagnostic.endLine, character: diagnostic.endCharacter },
      },
      message: diagnostic.message,
      severity:
        diagnostic.severity === 'error'
          ? DiagnosticSeverity.Error
          : diagnostic.severity === 'warning'
            ? DiagnosticSeverity.Warning
            : DiagnosticSeverity.Information,
      source: 'devforge',
      code: diagnostic.code,
    };
    return lsp;
  }
}

/* ------------------------------------------------------------------ */
/* CodeActionProvider                                                  */
/* ------------------------------------------------------------------ */

/** A quick-fix suggestion derived from a diagnostic. */
export interface SuggestedFix {
  readonly title: string;
  readonly kind: string;
  readonly edit: {
    readonly range: PositionRange;
    readonly newText: string;
  };
}

/** Compute quick fixes for a diagnostic in a document. */
export class CodeActionProvider {
  fixFor(diagnostic: RuleDiagnostic, text: string): readonly SuggestedFix[] {
    return CodeActionProvider.fixesFor(diagnostic, text);
  }

  /** Pure fixes (static, testable). */
  static fixesFor(diagnostic: RuleDiagnostic, text: string): readonly SuggestedFix[] {
    const start = DocumentStore.offsetOf(text, diagnostic.line, diagnostic.character);
    const end = DocumentStore.offsetOf(text, diagnostic.endLine, diagnostic.endCharacter);
    const token = text.slice(start, end);

    if (diagnostic.code === 'devforge.eqeqeq') {
      const fixed = token.replace('==', '===').replace('!=', '!==');
      return [{
        title: `Replace '${token}' with '${fixed}'`,
        kind: CodeActionKind.QuickFix,
        edit: {
          range: { start: { line: diagnostic.line, character: diagnostic.character }, end: { line: diagnostic.endLine, character: diagnostic.endCharacter } },
          newText: fixed,
        },
      }];
    }

    if (diagnostic.code === 'devforge.no-console') {
      return [{
        title: 'Remove console call',
        kind: CodeActionKind.QuickFix,
        edit: {
          range: { start: { line: diagnostic.line, character: diagnostic.character }, end: { line: diagnostic.endLine, character: diagnostic.endCharacter } },
          newText: '',
        },
      }];
    }

    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Repository synchronization                                          */
/* ------------------------------------------------------------------ */

/** A serializable repository snapshot served by the server. */
export interface RepositorySnapshot {
  readonly root: string;
  readonly hasGit: boolean;
  readonly branch: string | null;
  readonly packageManager: string | null;
  readonly isMonorepo: boolean;
  readonly testCommand: string | null;
  readonly buildCommand: string | null;
  readonly lintCommand: string | null;
}

/** Provider of repository snapshots (injected for tests). */
export interface RepositoryProvider {
  (root: string): Promise<RepositorySnapshot | null>;
}

/** Convert a CLI RepositoryContext into a snapshot (lazy CLI import). */
export const cliRepositoryProvider: RepositoryProvider = async (root: string) => {
  try {
    const { discoverRepository } = await import('@vedansh78/cli');
    const repository = await discoverRepository(root);
    return {
      root: repository.root,
      hasGit: repository.hasGit,
      branch: repository.branch,
      packageManager: repository.packageManager,
      isMonorepo: repository.isMonorepo,
      testCommand: repository.testCommand,
      buildCommand: repository.buildCommand,
      lintCommand: repository.lintCommand,
    };
  } catch {
    return null;
  }
};

/* ------------------------------------------------------------------ */
/* Server                                                              */
/* ------------------------------------------------------------------ */

/** Options for the DevForge language server. */
export interface LanguageServerOptions {
  /** Repository snapshot provider (defaults to the CLI discovery). */
  readonly repositoryProvider?: RepositoryProvider;
  readonly diagnosticEngine?: DiagnosticEngine;
  readonly symbolExtractor?: SymbolExtractor;
  readonly codeActionProvider?: CodeActionProvider;
  readonly now?: () => number;
}

/**
 * The DevForge language server. Wires the pure analysis modules to an LSP
 * connection.
 */
export class DevForgeLanguageServer {
  private readonly connection: Connection;
  private readonly documents = new DocumentStore();
  private readonly repositoryProvider: RepositoryProvider;
  private readonly diagnosticEngine: DiagnosticEngine;
  private readonly symbolExtractor: SymbolExtractor;
  private readonly codeActionProvider: CodeActionProvider;
  private workspaceRoot: string | null = null;
  private repository: RepositorySnapshot | null = null;

  constructor(connection: Connection, options: LanguageServerOptions = {}) {
    this.connection = connection;
    this.repositoryProvider = options.repositoryProvider ?? cliRepositoryProvider;
    this.diagnosticEngine = options.diagnosticEngine ?? new DiagnosticEngine();
    this.symbolExtractor = options.symbolExtractor ?? new SymbolExtractor();
    this.codeActionProvider = options.codeActionProvider ?? new CodeActionProvider();
  }

  /** The tracked documents (for tests). */
  get store(): DocumentStore {
    return this.documents;
  }

  /** The last repository snapshot (for tests). */
  get repositorySnapshot(): RepositorySnapshot | null {
    return this.repository;
  }

  /** Start the server: register handlers and listen. */
  start(): void {
    this.registerHandlers();
    this.connection.listen();
  }

  /** Register all LSP handlers. Exposed for tests. */
  registerHandlers(): void {
    const connection = this.connection;

    connection.onInitialize((params: InitializeParams) => {
      const roots = params.workspaceFolders?.map((f) => f.uri) ?? [];
      this.workspaceRoot = this.uriToPath(roots[0]);
      void this.refreshRepository();
      return {
        capabilities: {
          textDocumentSync: {
            openClose: true,
            change: TextDocumentSyncKind.Incremental,
          },
          documentSymbolProvider: true,
          codeActionProvider: {
            codeActionKinds: [CodeActionKind.QuickFix],
          },
          workspace: {
            workspaceFolders: {
              supported: true,
              changeNotifications: true,
            },
          },
        },
        serverInfo: { name: 'devforge-language-server', version: '0.1.0' },
      };
    });

    connection.onDidOpenTextDocument((params: DidOpenTextDocumentParams) => {
      const { uri, text, languageId, version } = params.textDocument;
      this.documents.open(uri, languageId, text, version);
      this.publishDiagnostics(uri);
    });

    connection.onDidChangeTextDocument((params: DidChangeTextDocumentParams) => {
      const { uri, version } = params.textDocument;
      const changes = params.contentChanges.map((change) => ({
        text: change.text,
        range:
          'range' in change && change.range
            ? {
                start: { line: change.range.start.line, character: change.range.start.character },
                end: { line: change.range.end.line, character: change.range.end.character },
              }
            : undefined,
      }));
      this.documents.update(uri, changes, version);
      this.publishDiagnostics(uri);
    });

    connection.onDidSaveTextDocument((params: DidSaveTextDocumentParams) => {
      // Re-scan on save so fresh diagnostics are pushed.
      this.publishDiagnostics(params.textDocument.uri);
    });

    connection.onDidCloseTextDocument((params: DidCloseTextDocumentParams) => {
      this.documents.close(params.textDocument.uri);
    });

    connection.onDocumentSymbol((params: DocumentSymbolParams) => {
      const document = this.documents.get(params.textDocument.uri);
      if (!document) return null;
      const symbols = this.symbolExtractor.extract(document.text);
      return toDocumentSymbols(symbols);
    });

    connection.onCodeAction((params: CodeActionParams) => {
      const document = this.documents.get(params.textDocument.uri);
      if (!document) return null;
      const diagnostics = this.diagnosticEngine.scan(document.text);
      const actions: CodeAction[] = [];
      for (const diagnostic of diagnostics) {
        if (!rangeOverlaps(diagnostic, params.range)) continue;
        for (const fix of this.codeActionProvider.fixFor(diagnostic, document.text)) {
          actions.push({
            title: fix.title,
            kind: fix.kind,
            diagnostics: [this.diagnosticEngine.toLsp(diagnostic, params.textDocument.uri, document.text)],
            edit: {
              changes: {
                [params.textDocument.uri]: [
                  {
                    range: {
                      start: { line: fix.edit.range.start.line, character: fix.edit.range.start.character },
                      end: { line: fix.edit.range.end.line, character: fix.edit.range.end.character },
                    },
                    newText: fix.edit.newText,
                  },
                ],
              },
            },
          });
        }
      }
      return actions;
    });

    connection.workspace.onDidChangeWorkspaceFolders((event: WorkspaceFoldersChangeEvent) => {
      const added = event.added[0]?.uri;
      if (added) {
        this.workspaceRoot = this.uriToPath(added);
        void this.refreshRepository();
      }
    });

    connection.onDidChangeConfiguration(() => {
      // Configuration refresh hook — re-publish diagnostics.
      for (const document of this.documents.all()) {
        this.publishDiagnostics(document.uri);
      }
    });

    // Engine diagnostics forwarding: the extension host pushes verification
    // diagnostics for the active file; the server forwards them to the editor.
    connection.onNotification('devforge/setDiagnostics', (params: { uri: string; diagnostics: unknown[] }) => {
      this.connection.sendDiagnostics({
        uri: params.uri,
        version: this.documents.get(params.uri)?.version,
        diagnostics: (params.diagnostics ?? []) as Diagnostic[],
      });
    });

    // Custom repository request.
    connection.onRequest('devforge/repository', async (): Promise<RepositorySnapshot | null> => {
      if (!this.workspaceRoot) return null;
      return this.refreshRepository();
    });
  }

  /** Publish rule-based diagnostics for a document uri. */
  publishDiagnostics(uri: string): void {
    const document = this.documents.get(uri);
    if (!document) {
      this.connection.sendDiagnostics({ uri, diagnostics: [] });
      return;
    }
    const diagnostics = this.diagnosticEngine.scan(document.text).map((d) =>
      this.diagnosticEngine.toLsp(d, uri, document.text),
    );
    this.connection.sendDiagnostics({ uri, version: document.version, diagnostics });
  }

  /** Refresh the repository snapshot from the current workspace root. */
  private async refreshRepository(): Promise<RepositorySnapshot | null> {
    if (!this.workspaceRoot) return null;
    this.repository = await this.repositoryProvider(this.workspaceRoot);
    if (this.repository) {
      this.connection.sendNotification('devforge/repositoryUpdated', this.repository);
    }
    return this.repository;
  }

  private uriToPath(uri: string | undefined): string | null {
    if (!uri) return null;
    if (uri.startsWith('file:')) {
      try {
        return fileURLToPath(uri);
      } catch {
        return uri;
      }
    }
    return uri;
  }
}

/** Convert extracted symbols into LSP DocumentSymbols. */
export function toDocumentSymbols(symbols: readonly ExtractedSymbol[]): DocumentSymbol[] {
  return symbols.map((symbol) => ({
    name: symbol.name,
    kind: symbol.kind,
    range: {
      start: { line: symbol.line, character: symbol.character },
      end: { line: symbol.endLine, character: symbol.character + symbol.name.length },
    },
    selectionRange: {
      start: { line: symbol.line, character: symbol.character },
      end: { line: symbol.endLine, character: symbol.character + symbol.name.length },
    },
    children: toDocumentSymbols(symbol.children),
  }));
}

function rangeOverlaps(diagnostic: RuleDiagnostic, range: { start: Position; end: Position }): boolean {
  const diagStart = diagnostic.line * 1_000_000 + diagnostic.character;
  const diagEnd = diagnostic.endLine * 1_000_000 + diagnostic.endCharacter;
  const rangeStart = range.start.line * 1_000_000 + range.start.character;
  const rangeEnd = range.end.line * 1_000_000 + range.end.character;
  return diagEnd >= rangeStart && diagStart <= rangeEnd;
}

/**
 * Main entry point: create a connection from the process argv (stdin/stdout
 * IPC) and start the server. Executed as a separate node process by the
 * language client.
 */
export function startLanguageServer(): void {
  const connection = createConnection();
  const server = new DevForgeLanguageServer(connection);
  server.start();
}

// Auto-start only when this module is the process entry point (not in tests).
const isMain = (): boolean => {
  try {
    const entry = process.argv[1];
    return entry !== undefined && __filename === resolve(entry);
  } catch {
    return false;
  }
};

if (isMain()) {
  startLanguageServer();
}
