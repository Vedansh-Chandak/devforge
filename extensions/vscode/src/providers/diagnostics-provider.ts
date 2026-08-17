/**
 * @devforge/vscode-extension — Diagnostics provider (DF-020).
 *
 * Converts structured engine diagnostics (verification/typecheck/lint output
 * from coding reports, plus doctor health-check failures) into VS Code
 * `DiagnosticCollection` entries and a diagnostics tree model. The pure
 * mapping functions are vscode-free and fully unit-testable.
 */

import type * as vscode from 'vscode';
import * as path from 'node:path';
import type { FindingNode } from './tree-provider.js';
import { shortId } from '../utils.js';

/** A single structured diagnostic signal (mirrors @devforge/execution). */
export interface DiagnosticSignal {
  readonly category: string;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  readonly code?: string;
}

/** A group of signals produced by one source (verification run, check, ...). */
export interface DiagnosticGroup {
  readonly source: string;
  readonly diagnostics: readonly DiagnosticSignal[];
}

/** Flatten diagnostic groups into a single signal list. */
export function flattenDiagnostics(groups: readonly DiagnosticGroup[]): readonly DiagnosticSignal[] {
  return groups.flatMap((group) => group.diagnostics);
}

/** Group signals by file path. Signals without a file map to the empty key. */
export function groupSignalsByFile(signals: readonly DiagnosticSignal[]): ReadonlyMap<string, readonly DiagnosticSignal[]> {
  const map = new Map<string, DiagnosticSignal[]>();
  for (const signal of signals) {
    const key = signal.file ?? '';
    const list = map.get(key) ?? [];
    list.push(signal);
    map.set(key, list);
  }
  return map;
}

/** Count signals by severity. */
export function countDiagnostics(signals: readonly DiagnosticSignal[]): { readonly errors: number; readonly warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const signal of signals) {
    if (signal.severity === 'error') errors += 1;
    else warnings += 1;
  }
  return { errors, warnings };
}

/** Convert diagnostic signals into tree finding nodes. */
export function toFindingNodes(signals: readonly DiagnosticSignal[]): readonly FindingNode[] {
  return signals.map((signal) => ({
    category: signal.category,
    file: signal.file ? signal.file : '(workspace)',
    line: signal.line,
    severity: signal.severity,
    message: signal.code ? `[${signal.code}] ${signal.message}` : signal.message,
  }));
}

/** Options for the diagnostics provider. */
export interface DiagnosticsProviderOptions {
  readonly vscode: typeof import('vscode');
  readonly workspaceRoot: string;
  readonly collectionName?: string;
}

/** Binds pure diagnostic data to a VS Code DiagnosticCollection. */
export class DiagnosticsProvider {
  private readonly vscodeNs: typeof import('vscode');
  private readonly workspaceRoot: string;
  private readonly collection: vscode.DiagnosticCollection;

  constructor(options: DiagnosticsProviderOptions) {
    this.vscodeNs = options.vscode;
    this.workspaceRoot = options.workspaceRoot;
    this.collection = options.vscode.languages.createDiagnosticCollection(
      options.collectionName ?? 'devforge',
    );
  }

  /** Create a vscode.Diagnostic from a signal. */
  toDiagnostic(signal: DiagnosticSignal): vscode.Diagnostic {
    const range = this.rangeFor(signal);
    const diagnostic = new this.vscodeNs.Diagnostic(
      range,
      signal.message,
      signal.severity === 'error'
        ? this.vscodeNs.DiagnosticSeverity.Error
        : this.vscodeNs.DiagnosticSeverity.Warning,
    );
    diagnostic.source = 'devforge';
    if (signal.code !== undefined) diagnostic.code = signal.code;
    return diagnostic;
  }

  /** Set diagnostics from signals, grouped by file, on the collection. */
  set(signals: readonly DiagnosticSignal[]): void {
    const grouped = groupSignalsByFile(signals);
    const entries: [vscode.Uri, vscode.Diagnostic[]][] = [];
    for (const [file, fileSignals] of grouped) {
      const uri = this.resolveUri(file);
      if (!uri) continue;
      entries.push([uri, fileSignals.map((s) => this.toDiagnostic(s))]);
    }
    this.collection.set(entries);
  }

  /** Clear all diagnostics from the collection. */
  clear(): void {
    this.collection.clear();
  }

  /** Resolve a workspace-relative file path to a file uri (or null). */
  private resolveUri(file: string): vscode.Uri | null {
    if (file === '') return null;
    try {
      return this.vscodeNs.Uri.file(path.isAbsolute(file) ? file : path.join(this.workspaceRoot, file));
    } catch {
      return null;
    }
  }

  private rangeFor(signal: DiagnosticSignal): vscode.Range {
    const line = Math.max(0, (signal.line ?? 1) - 1);
    const column = Math.max(0, (signal.column ?? 0) - 1);
    return new this.vscodeNs.Range(line, column, line, column + 1);
  }

  /** Create a diagnostic from a doctor health-check failure. */
  static fromHealthCheck(vscodeNs: typeof import('vscode'), name: string, detail: string): DiagnosticSignal {
    return {
      category: 'doctor',
      severity: 'error',
      message: `${name}: ${detail}`,
      file: '',
    };
  }

  /** Stable tree id for a signal (used by tests and the tree view). */
  static treeId(signal: DiagnosticSignal): string {
    return shortId(`${signal.category}:${signal.file ?? ''}:${signal.line ?? 0}:${signal.message}`);
  }
}
