/**
 * @devforge/vscode-extension — Tree provider (DF-020).
 *
 * Provides the Task History, Repository Context, and Diagnostics trees. The
 * tree *models* are pure data (vscode-free) so they are trivially testable;
 * the provider adapts them to `vscode.TreeView`s.
 */

import type * as vscode from 'vscode';
import type { DevForgeSession, RepositoryContext } from '../types.js';
import type { HealthCheckLike } from '../services/devforge-client.js';
import { shortId } from '../utils.js';

/** A serializable tree node. */
export interface TreeNode {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly tooltip?: string;
  readonly collapsibleState: 'none' | 'collapsed' | 'expanded';
  /** Codicon name or path shown next to the label. */
  readonly icon?: string;
  /** Optional command executed on click. */
  readonly command?: { readonly command: string; readonly title: string; readonly arguments: readonly unknown[] };
  readonly children: readonly TreeNode[];
}

/** Map serializable collapsible states to the vscode enum keys. */
const COLLAPSIBLE_STATE_KEY = {
  none: 'None',
  collapsed: 'Collapsed',
  expanded: 'Expanded',
} as const;

/** A review/diagnostic finding shown in the diagnostics tree. */
export interface FindingNode {
  readonly category: string;
  readonly file: string;
  readonly line?: number;
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
}

/** Build the repository-context tree model from a RepositoryContext. */
export function buildRepositoryTree(repository: RepositoryContext): TreeNode {
  const entries: readonly (readonly [string, string])[] = [
    ['Workspace root', repository.root],
    ['Git repository', repository.hasGit ? 'yes' : 'no'],
    ['Branch', repository.branch ?? 'unknown'],
    ['Package manager', repository.packageManager ?? 'unknown'],
    ['package.json', repository.hasPackageJson ? (repository.packageJsonName ?? 'yes') : 'no'],
    ['Monorepo', repository.isMonorepo ? 'yes' : 'no'],
    ['pnpm workspace', repository.isPnpmWorkspace ? 'yes' : 'no'],
    ['tsconfig.json', repository.tsconfig ? 'yes' : 'no'],
    ['Test framework', repository.testFramework ?? 'none'],
    ['Build tool', repository.buildTool ?? 'none'],
    ['Build command', repository.buildCommand ?? 'not detected'],
    ['Test command', repository.testCommand ?? 'not detected'],
    ['Lint command', repository.lintCommand ?? 'not detected'],
  ];
  return {
    id: 'repository',
    label: 'Repository Context',
    description: repository.root,
    collapsibleState: 'expanded',
    icon: 'folder',
    children: entries.map(([label, value]) => ({
      id: shortId(label),
      label,
      description: value,
      collapsibleState: 'none' as const,
      icon: 'info',
      children: [],
    })),
  };
}

/** Build the task-history tree model from sessions. */
export function buildTaskHistoryTree(sessions: readonly DevForgeSession[]): TreeNode {
  return {
    id: 'history',
    label: 'Task History',
    collapsibleState: 'expanded',
    icon: 'history',
    children: sessions.map((session) => ({
      id: session.id,
      label: session.workspaceRoot.split(/[\\/]/).pop() ?? session.workspaceRoot,
      description: `${session.tasks.length} task(s)`,
      tooltip: session.workspaceRoot,
      collapsibleState: session.tasks.length > 0 ? 'collapsed' : 'none',
      icon: 'device-desktop',
      children: session.tasks.map((task) => ({
        id: task.id,
        label: task.summary,
        description: task.ok ? `ok · ${task.durationMs}ms` : 'failed',
        tooltip: `devforge ${task.command} ${task.args.join(' ')}`,
        collapsibleState: 'none',
        icon: task.ok ? 'check' : 'error',
        children: [],
      })),
    })),
  };
}

/** Build the diagnostics tree model from findings. */
export function buildDiagnosticsTree(findings: readonly FindingNode[]): TreeNode {
  const byCategory = new Map<string, FindingNode[]>();
  for (const finding of findings) {
    const list = byCategory.get(finding.category) ?? [];
    list.push(finding);
    byCategory.set(finding.category, list);
  }
  const severityIcon: Record<FindingNode['severity'], string> = {
    error: 'error',
    warning: 'warning',
    info: 'info',
  };
  return {
    id: 'diagnostics',
    label: 'Diagnostics',
    description: `${findings.length} finding(s)`,
    collapsibleState: findings.length > 0 ? 'expanded' : 'none',
    icon: 'lightbulb',
    children: [...byCategory.entries()].map(([category, items]) => ({
      id: shortId(`cat-${category}`),
      label: `${category} (${items.length})`,
      collapsibleState: 'collapsed',
      icon: 'symbol-class',
      children: items.map((finding) => ({
        id: shortId(`${finding.file}:${finding.line ?? 0}:${finding.message}`),
        label: finding.message,
        description: finding.file + (finding.line !== undefined ? `:${finding.line}` : ''),
        collapsibleState: 'none',
        icon: severityIcon[finding.severity],
        children: [],
      })),
    })),
  };
}

/** Build a diagnostics tree model from doctor health checks. */
export function buildDoctorTree(checks: readonly HealthCheckLike[]): TreeNode {
  return {
    id: 'doctor',
    label: 'Health Checks',
    description: checks.every((c) => c.ok) ? 'all ok' : 'some failed',
    collapsibleState: 'expanded',
    icon: 'pulse',
    children: checks.map((check) => ({
      id: shortId(check.name),
      label: check.name,
      description: check.detail,
      tooltip: check.fix,
      collapsibleState: 'none',
      icon: check.ok ? 'pass' : 'error',
      children: [],
    })),
  };
}

/** A vscode tree data provider backed by a pure tree model. */
export class DevForgeTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly vscodeNs: typeof import('vscode');
  private readonly onDidChangeEmitter: vscode.EventEmitter<TreeNode | undefined | null>;
  readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined | null>;
  private _model: TreeNode = {
    id: 'empty',
    label: 'No data',
    collapsibleState: 'none',
    children: [],
  };

  constructor(vscodeNs: typeof import('vscode')) {
    this.vscodeNs = vscodeNs;
    this.onDidChangeEmitter = new vscodeNs.EventEmitter<TreeNode | undefined | null>();
    this.onDidChangeTreeData = this.onDidChangeEmitter.event;
  }

  /** Replace the model and notify listeners. */
  setModel(model: TreeNode): void {
    this._model = model;
    this.onDidChangeEmitter.fire(undefined);
  }

  /** The current model (for tests). */
  get model(): TreeNode {
    return this._model;
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    const item = new this.vscodeNs.TreeItem(
      node.label,
      this.vscodeNs.TreeItemCollapsibleState[COLLAPSIBLE_STATE_KEY[node.collapsibleState]],
    );
    item.id = node.id;
    item.description = node.description;
    item.tooltip = node.tooltip;
    if (node.icon) {
      item.iconPath = new this.vscodeNs.ThemeIcon(node.icon);
    }
    if (node.command) {
      item.command = {
        command: node.command.command,
        title: node.command.title,
        arguments: [...node.command.arguments],
      };
    }
    return item;
  }

  getChildren(node?: TreeNode): TreeNode[] {
    return node ? [...node.children] : [this._model];
  }

  getParent(node: TreeNode): TreeNode | null {
    return null;
  }
}
