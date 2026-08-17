import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildRepositoryTree,
  buildTaskHistoryTree,
  buildDiagnosticsTree,
  buildDoctorTree,
  DevForgeTreeProvider,
} from '../../src/providers/tree-provider.js';
import * as vscode from '../mocks/vscode.js';
import { RepositoryContext, DevForgeSession } from '../../src/types.js';
import { HealthCheckLike } from '../../src/services/devforge-client.js';

const REPO: RepositoryContext = {
  root: '/repo',
  hasGit: true,
  branch: 'main',
  packageManager: 'pnpm',
  hasPackageJson: true,
  packageJsonName: 'devforge',
  isMonorepo: true,
  isPnpmWorkspace: true,
  tsconfig: true,
  testFramework: 'vitest',
  buildTool: 'tsc',
  buildCommand: 'pnpm build',
  testCommand: 'pnpm test',
  lintCommand: 'pnpm lint',
};

const SESSION: DevForgeSession = {
  id: 's1',
  workspaceRoot: '/repo/packages/app',
  createdAt: 1,
  tasks: [
    { id: 't1', command: 'ask', args: ['q'], startedAt: 1, durationMs: 10, ok: true, summary: 'ask "q"' },
    { id: 't2', command: 'run', args: ['x'], startedAt: 2, durationMs: 5, ok: false, summary: 'run: boom' },
  ],
};

const CHECKS: HealthCheckLike[] = [
  { name: 'git', ok: true, detail: 'present' },
  { name: 'model', ok: false, detail: 'missing key', fix: 'set DEVFORGE_API_KEY' },
];

describe('buildRepositoryTree', () => {
  it('exposes repository facts as children', () => {
    const tree = buildRepositoryTree(REPO);
    expect(tree.id).toBe('repository');
    expect(tree.label).toBe('Repository Context');
    expect(tree.children).toHaveLength(13);
  });

  it('reports the workspace root', () => {
    const tree = buildRepositoryTree(REPO);
    expect(tree.description).toBe('/repo');
    expect(tree.children.find((c) => c.label === 'Workspace root')?.description).toBe('/repo');
  });

  it('reports git branch and package manager', () => {
    const tree = buildRepositoryTree(REPO);
    const get = (label: string) => tree.children.find((c) => c.label === label)?.description;
    expect(get('Branch')).toBe('main');
    expect(get('Package manager')).toBe('pnpm');
  });

  it('reports detected commands', () => {
    const tree = buildRepositoryTree(REPO);
    const get = (label: string) => tree.children.find((c) => c.label === label)?.description;
    expect(get('Build command')).toBe('pnpm build');
    expect(get('Test command')).toBe('pnpm test');
  });
});

describe('buildTaskHistoryTree', () => {
  it('renders an empty history', () => {
    const tree = buildTaskHistoryTree([]);
    expect(tree.children).toHaveLength(0);
  });

  it('labels sessions by their last path segment', () => {
    const tree = buildTaskHistoryTree([SESSION]);
    expect(tree.children[0]?.label).toBe('app');
    expect(tree.children[0]?.description).toBe('2 task(s)');
  });

  it('nests tasks under sessions', () => {
    const tree = buildTaskHistoryTree([SESSION]);
    const tasks = tree.children[0]?.children ?? [];
    expect(tasks).toHaveLength(2);
    expect(tasks[0]?.label).toBe('ask "q"');
    expect(tasks[0]?.icon).toBe('check');
    expect(tasks[1]?.icon).toBe('error');
  });
});

describe('buildDiagnosticsTree', () => {
  it('renders an empty diagnostics tree', () => {
    const tree = buildDiagnosticsTree([]);
    expect(tree.description).toBe('0 finding(s)');
    expect(tree.children).toHaveLength(0);
  });

  it('groups findings by category', () => {
    const tree = buildDiagnosticsTree([
      { category: 'lint', file: 'a.ts', line: 1, severity: 'error', message: 'bad' },
      { category: 'lint', file: 'b.ts', line: 2, severity: 'warning', message: 'warn' },
      { category: 'doctor', file: 'x', severity: 'error', message: 'health' },
    ]);
    expect(tree.children).toHaveLength(2);
    const lint = tree.children.find((c) => c.label.startsWith('lint'));
    expect(lint?.children).toHaveLength(2);
  });

  it('uses severity icons for findings', () => {
    const tree = buildDiagnosticsTree([
      { category: 'c', file: 'f', line: 1, severity: 'error', message: 'e' },
      { category: 'c', file: 'g', line: 2, severity: 'warning', message: 'w' },
      { category: 'c', file: 'h', line: 3, severity: 'info', message: 'i' },
    ]);
    const icons = tree.children[0]?.children.map((n) => n.icon);
    expect(icons).toEqual(['error', 'warning', 'info']);
  });
});

describe('buildDoctorTree', () => {
  it('says all ok when every check passes', () => {
    const tree = buildDoctorTree([CHECKS[0]!]);
    expect(tree.description).toBe('all ok');
  });

  it('says some failed otherwise', () => {
    const tree = buildDoctorTree(CHECKS);
    expect(tree.description).toBe('some failed');
    const failed = tree.children.find((c) => c.label === 'model');
    expect(failed?.icon).toBe('error');
    expect(failed?.tooltip).toBe('set DEVFORGE_API_KEY');
  });
});

describe('DevForgeTreeProvider', () => {
  beforeEach(() => vscode.__resetMocks());

  function makeProvider(): DevForgeTreeProvider {
    return new DevForgeTreeProvider(vscode as unknown as typeof import('vscode'));
  }

  it('starts with an empty model', () => {
    const provider = makeProvider();
    expect(provider.model.label).toBe('No data');
    expect(provider.getChildren()).toHaveLength(1);
  });

  it('setModel replaces the model and fires the change event', () => {
    const provider = makeProvider();
    const listener = vi.fn();
    provider.onDidChangeTreeData(listener);
    provider.setModel(buildRepositoryTree(REPO));
    expect(provider.model.label).toBe('Repository Context');
    expect(listener).toHaveBeenCalled();
  });

  it('getTreeItem builds a vscode TreeItem with label and state', () => {
    const provider = makeProvider();
    const node = buildRepositoryTree(REPO);
    const item = provider.getTreeItem(node);
    expect(item.label).toBe('Repository Context');
    expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Expanded);
    expect(item.id).toBe('repository');
  });

  it('getTreeItem assigns description, tooltip, icon and command', () => {
    const provider = makeProvider();
    const node = {
      id: 'n',
      label: 'N',
      description: 'd',
      tooltip: 'tip',
      collapsibleState: 'none' as const,
      icon: 'folder',
      command: { command: 'devforge.ask', title: 'Ask', arguments: [1] },
      children: [],
    };
    const item = provider.getTreeItem(node);
    expect(item.description).toBe('d');
    expect(item.tooltip).toBe('tip');
    expect(item.iconPath).toBeInstanceOf(vscode.ThemeIcon);
    expect(item.command).toMatchObject({ command: 'devforge.ask', title: 'Ask' });
  });

  it('getChildren returns children for a node or the root model', () => {
    const provider = makeProvider();
    provider.setModel(buildRepositoryTree(REPO));
    expect(provider.getChildren(provider.model)).toHaveLength(13);
    expect(provider.getChildren()).toEqual([provider.model]);
  });

  it('getParent returns null', () => {
    expect(makeProvider().getParent(providerPlaceholder())).toBeNull();
  });

  function providerPlaceholder() {
    return buildRepositoryTree(REPO);
  }
});
