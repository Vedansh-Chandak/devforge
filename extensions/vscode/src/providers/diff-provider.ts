/**
 * @devforge/vscode-extension — Diff provider (DF-020).
 *
 * Registers a virtual text-document provider (`devforge-diff` scheme) that
 * serves unified diff previews for the extension's views, and exposes the
 * inline "Apply Patch" / "Reject Patch" flow. The pure state machine
 * ({@link DiffStore}) is vscode-free and fully unit-testable.
 */

import type * as vscode from 'vscode';
import type { GitDiff } from '@devforge/execution';
import type { DiffDocument } from '../types.js';
import { renderUnifiedDiffFromGit, uniqueId } from '../utils.js';
import { DiffError } from '../errors.js';
import type { LoggerLike } from '../types.js';

/** The URI scheme used by all DevForge diff previews. */
export const DIFF_SCHEME = 'devforge-diff';

/** Options accepted by the diff provider. */
export interface DiffProviderOptions {
  readonly vscode: typeof import('vscode');
  readonly logger: LoggerLike;
  /** Rejects a pending diff: restores the given files through the client. */
  readonly reject: (files: readonly string[]) => Promise<void>;
  /** Accepts a pending diff: acknowledge the changes. */
  readonly accept?: (document: DiffDocument) => Promise<void>;
}

/** Pure state holder for diff documents (no vscode imports). */
export class DiffStore {
  private readonly documents = new Map<string, DiffDocument>();

  /** Register a diff document, returning a stable uri. */
  add(diff: GitDiff, title: string, options: { pending?: boolean; patchId?: string } = {}): DiffDocument {
    const id = uniqueId('diff');
    const uri = `${DIFF_SCHEME}:///${id}.diff`;
    const document: DiffDocument = {
      uri,
      text: renderUnifiedDiffFromGit(diff),
      files: diff.files.map((f) => f.newPath || f.oldPath),
      pending: options.pending ?? false,
      patchId: options.patchId,
    };
    this.documents.set(uri, document);
    return document;
  }

  /** Get a registered document by uri. */
  get(uri: string): DiffDocument | undefined {
    return this.documents.get(uri);
  }

  /** All registered documents. */
  list(): readonly DiffDocument[] {
    return [...this.documents.values()];
  }

  /** Remove a document. */
  remove(uri: string): boolean {
    return this.documents.delete(uri);
  }

  /** Number of registered documents. */
  get size(): number {
    return this.documents.size;
  }
}

/** The diff provider bound to VS Code. */
export class DiffProvider {
  private readonly store = new DiffStore();
  private readonly vscode: typeof import('vscode');
  private readonly logger: LoggerLike;
  private readonly reject: (files: readonly string[]) => Promise<void>;
  private readonly accept: (document: DiffDocument) => Promise<void>;
  private currentDocument: DiffDocument | null = null;

  constructor(options: DiffProviderOptions) {
    this.vscode = options.vscode;
    this.logger = options.logger;
    this.reject = options.reject;
    this.accept = options.accept ?? (() => Promise.resolve());
  }

  /** The underlying pure store (for tests and previews). */
  get storeRef(): DiffStore {
    return this.store;
  }

  /** The most recently shown diff document, if any. */
  get current(): DiffDocument | null {
    return this.currentDocument;
  }

  /**
   * Register the text-document content provider. Returns a disposable that
   * unregisters it.
   */
  register(): vscode.Disposable {
    const disposable = this.vscode.workspace.registerTextDocumentContentProvider(
      DIFF_SCHEME,
      {
        provideTextDocumentContent: (uri: vscode.Uri): string => {
          const document = this.store.get(uri.toString());
          if (!document) {
            this.logger.warn(`No diff document for ${uri.toString()}`);
            return '// No diff content available.';
          }
          return document.text;
        },
      },
    );
    return disposable;
  }

  /**
   * Show a diff preview for a git diff and open it in an editor.
   * Returns the registered document.
   */
  async show(diff: GitDiff, title: string, options: { pending?: boolean; patchId?: string } = {}): Promise<DiffDocument> {
    const document = this.store.add(diff, title, options);
    this.currentDocument = document;
    const uri = this.vscode.Uri.parse(document.uri);
    const doc = await this.vscode.workspace.openTextDocument(uri);
    await this.vscode.window.showTextDocument(doc, { preview: true, viewColumn: this.vscode.ViewColumn.Beside });
    return document;
  }

  /** Close a preview document (keeps it registered until GC). */
  async close(uri: string): Promise<void> {
    this.store.remove(uri);
    const doc = this.vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri);
    if (doc) {
      await this.vscode.window.showTextDocument(doc, { preview: true });
    }
  }

  /** Get a registered document by uri string. */
  get(uri: string): DiffDocument | undefined {
    return this.store.get(uri);
  }

  /** All registered documents. */
  list(): readonly DiffDocument[] {
    return this.store.list();
  }

  /** Apply (accept) the pending patch associated with a document. */
  async acceptPatch(document: DiffDocument): Promise<boolean> {
    if (!document.pending) throw new DiffError('This diff is read-only; there is no patch to apply.');
    await this.accept(document);
    this.logger.info(`Patch accepted: ${document.uri}`);
    return true;
  }

  /** Reject (discard) the pending patch associated with a document. */
  async rejectPatch(document: DiffDocument): Promise<boolean> {
    if (!document.pending) throw new DiffError('This diff is read-only; there is no patch to reject.');
    await this.reject(document.files);
    this.logger.info(`Patch rejected: ${document.uri}`);
    return true;
  }
}
