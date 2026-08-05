/**
 * @devforge/cli — Workspace Service (M1).
 *
 * Discovers the repository context and provides Workspace, GitService,
 * and CommandRunner instances wired to the discovered root.
 */

import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import {
  Workspace,
  createGitService,
  createCommandRunner,
  WorkspaceOptions,
  GitServiceConfig,
  CommandRunnerConfig,
} from '@devforge/execution';
import type { GitService } from '@devforge/execution';

/** Discovered repository context for CLI commands. */
export interface RepositoryContext {
  /** Absolute path to the workspace root (git root or cwd). */
  root: string;
  /** Absolute path to git root, or null if not a git repo. */
  gitRoot: string | null;
  /** Whether a git repository was found. */
  hasGit: boolean;
  /** Current branch name, or null if unknown. */
  branch: string | null;
  /** Detected package manager. */
  packageManager: 'pnpm' | 'npm' | 'yarn' | null;
  /** Whether a package.json exists at root. */
  hasPackageJson: boolean;
  /** Package name from package.json (if present). */
  packageJsonName?: string;
  /** Whether the workspace appears to be a monorepo (pnpm-workspace.yaml). */
  isMonorepo: boolean;
  /** Whether a pnpm-workspace.yaml file exists. */
  hasWorkspaces: boolean;
  /** Whether a tsconfig.json exists. */
  tsconfig: boolean;
  /** Detected test framework. */
  testFramework: 'vitest' | 'jest' | 'mocha' | null;
  /** Detected build tool. */
  buildTool: 'tsc' | 'next' | 'vite' | 'webpack' | null;
  /** Detected build command (e.g., "pnpm build", "tsc --noEmit"). */
  buildCommand: string | null;
  /** Detected test command (e.g., "pnpm test", "vitest run"). */
  testCommand: string | null;
  /** Detected lint command (e.g., "pnpm lint", "eslint ."). */
  lintCommand: string | null;
  /** Workspace root (for monorepos, the workspace root). */
  workspaceRoot: string;
  /** Whether the root is a pnpm workspace. */
  isPnpmWorkspace: boolean;
  /** Whether the root is an npm/yarn workspace. */
  isNpmYarnWorkspace: boolean;
}

/** Service bundle for workspace operations. */
export interface WorkspaceService {
  readonly workspace: Workspace;
  readonly git: GitService;
  readonly runner: ReturnType<typeof createCommandRunner>;
  readonly context: RepositoryContext;
}

/**
 * Find the git repository root by walking up from the given path.
 * Returns null if no git repository is found.
 */
export function findGitRoot(startPath: string): string | null {
  let current = path.resolve(startPath);
  while (true) {
    const gitDir = path.join(current, '.git');
    if (existsSync(gitDir)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Find the workspace root (pnpm-workspace.yaml, npm/yarn workspaces config, or git root).
 */
export function findWorkspaceRoot(startPath: string): string {
  let current = path.resolve(startPath);
  while (true) {
    const pnpmWorkspace = path.join(current, 'pnpm-workspace.yaml');
    const packageJson = path.join(current, 'package.json');
    if (existsSync(pnpmWorkspace)) return current;
    if (existsSync(packageJson)) {
      try {
        const pkg = JSON.parse(readFileSync(packageJson, 'utf-8'));
        if (pkg.workspaces) return current;
      } catch {
        // ignore parse errors
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

/**
 * Discover the repository context from a starting directory.
 * Walks up to find git root, then inspects the root for package.json,
 * pnpm-workspace.yaml, tsconfig.json, test frameworks, and build tools.
 */
export async function discoverRepository(cwd: string): Promise<RepositoryContext> {
  const cwdHasPackageJson = existsSync(path.join(cwd, 'package.json'));
  
  // Find git root by walking up
  const gitRoot = findGitRoot(cwd);
  const hasGit = gitRoot !== null;
  
  // Root is cwd if it has package.json, otherwise git root, otherwise cwd
  const root = cwdHasPackageJson ? cwd : (gitRoot ?? cwd);
  const workspaceRoot = findWorkspaceRoot(root);

  const packageJsonPath = path.join(root, 'package.json');
  let hasPackageJson = false;
  let packageJsonName: string | undefined;
  let packageManager: 'pnpm' | 'npm' | 'yarn' | null = null;
  let buildCommand: string | null = null;
  let testCommand: string | null = null;
  let lintCommand: string | null = null;
  let isPnpmWorkspace = false;
  let isNpmYarnWorkspace = false;

  if (existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      hasPackageJson = true;
      packageJsonName = pkg.name;
      if (pkg.packageManager) {
        const m = String(pkg.packageManager).toLowerCase();
        if (m.startsWith('pnpm')) packageManager = 'pnpm';
        else if (m.startsWith('npm')) packageManager = 'npm';
        else if (m.startsWith('yarn')) packageManager = 'yarn';
      }
      // Detect build/test/lint commands from scripts
      const scripts = pkg.scripts ?? {};
      if (scripts.build) {
        buildCommand = `${packageManager ?? 'npm'} run build`;
      }
      if (scripts.test) {
        testCommand = `${packageManager ?? 'npm'} run test`;
      }
      if (scripts.lint) {
        lintCommand = `${packageManager ?? 'npm'} run lint`;
      }
    } catch {
      // ignore parse errors
    }
  }

  // Infer package manager from lockfiles if not in package.json
  if (!packageManager) {
    if (existsSync(path.join(root, 'pnpm-lock.yaml'))) packageManager = 'pnpm';
    else if (existsSync(path.join(root, 'package-lock.json'))) packageManager = 'npm';
    else if (existsSync(path.join(root, 'yarn.lock'))) packageManager = 'yarn';
  }

  // Check for pnpm workspace
  const hasWorkspaces = existsSync(path.join(root, 'pnpm-workspace.yaml'));
  isPnpmWorkspace = hasWorkspaces;

  // Check for npm/yarn workspaces
  if (hasPackageJson) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      if (pkg.workspaces) {
        isNpmYarnWorkspace = true;
      }
    } catch {
      // ignore
    }
  }

  const isMonorepo = hasWorkspaces || isNpmYarnWorkspace || (hasPackageJson && packageJsonName?.includes('@') === true);

  const tsconfig = existsSync(path.join(root, 'tsconfig.json'));

  // Detect test framework from devDependencies or scripts
  let testFramework: RepositoryContext['testFramework'] = null;
  let buildTool: RepositoryContext['buildTool'] = null;

  if (hasPackageJson) {
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.vitest) testFramework = 'vitest';
      else if (deps.jest) testFramework = 'jest';
      else if (deps.mocha) testFramework = 'mocha';

      if (deps.typescript || pkg.scripts?.build?.includes('tsc') || pkg.scripts?.typecheck?.includes('tsc')) {
        buildTool = 'tsc';
      } else if (deps.next) buildTool = 'next';
      else if (deps.vite) buildTool = 'vite';
      else if (deps.webpack) buildTool = 'webpack';
    } catch {
      // ignore
    }
  }

  // Fallback build/test/lint commands if not from package.json
  if (!buildCommand) {
    if (tsconfig) buildCommand = 'tsc --noEmit';
  }
  if (!testCommand) {
    if (testFramework === 'vitest') testCommand = 'vitest run';
    else if (testFramework === 'jest') testCommand = 'jest';
    else if (testFramework === 'mocha') testCommand = 'mocha';
  }
  if (!lintCommand) {
    if (existsSync(path.join(root, 'eslint.config.js')) || existsSync(path.join(root, '.eslintrc')) || existsSync(path.join(root, '.eslintrc.js')) || existsSync(path.join(root, '.eslintrc.json'))) {
      lintCommand = 'eslint .';
    }
  }

  let branch: string | null = null;
  if (hasGit) {
    try {
      // Use git directly to get branch
      const { execSync } = await import('node:child_process');
      branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: root,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      branch = null;
    }
  }

  return {
    root,
    gitRoot,
    hasGit,
    branch,
    packageManager,
    hasPackageJson,
    packageJsonName,
    isMonorepo,
    hasWorkspaces,
    tsconfig,
    testFramework,
    buildTool,
    buildCommand,
    testCommand,
    lintCommand,
    workspaceRoot,
    isPnpmWorkspace,
    isNpmYarnWorkspace,
  };
}

/**
 * Create a fully-wired WorkspaceService for the given context.
 * Builds Workspace, GitService, and CommandRunner sharing the same workspace root.
 */
export function createWorkspaceService(context: RepositoryContext): WorkspaceService {
  const workspaceRoot = context.root;

  const workspace = new Workspace({ root: workspaceRoot } as WorkspaceOptions);
  const runner = createCommandRunner({ workspaceRoot } as CommandRunnerConfig);
  const git = createGitService({ workspaceRoot, runner } as GitServiceConfig);

  return {
    workspace,
    git,
    runner,
    context,
  };
}