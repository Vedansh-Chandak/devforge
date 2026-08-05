/**
 * @devforge/cli — status command (M1).
 *
 * Print workspace, provider, selected model, repository, branch, engine version.
 */
import type { CliContext } from '../routing/context.js';
import { renderStatus } from '../utils/output.js';

/** Handler for `devforge status`. */
export async function handleStatus(ctx: CliContext): Promise<string> {
  const { config, repository, services, options } = ctx;

  const lines: readonly [string, string][] = [
    ['Workspace', repository.root],
    ['Workspace root', repository.workspaceRoot],
    ['Git repository', repository.hasGit ? 'yes' : 'no'],
    ['Git branch', repository.branch ?? 'unknown'],
    ['Package manager', repository.packageManager ?? 'unknown'],
    ['Package.json', repository.hasPackageJson ? `yes (${repository.packageJsonName ?? 'unnamed'})` : 'no'],
    ['Monorepo', repository.isMonorepo ? 'yes' : 'no'],
    ['pnpm workspace', repository.isPnpmWorkspace ? 'yes' : 'no'],
    ['npm/yarn workspace', repository.isNpmYarnWorkspace ? 'yes' : 'no'],
    ['Provider', config.provider],
    ['Model', config.model ?? '(default)'],
    ['Temperature', String(config.temperature ?? 0.2)],
    ['Max repair attempts', String(config.maxRepairAttempts ?? 3)],
    ['Engine version', '0.1.0'],
    ['Build command', repository.buildCommand ?? 'not detected'],
    ['Test command', repository.testCommand ?? 'not detected'],
    ['Lint command', repository.lintCommand ?? 'not detected'],
    ['tsconfig.json', repository.tsconfig ? 'yes' : 'no'],
    ['Test framework', repository.testFramework ?? 'none detected'],
    ['Build tool', repository.buildTool ?? 'none detected'],
  ];

  let output = `📊 DevForge Status\n\n${renderStatus(lines)}`;

  if (options.debug) {
    output += `\n\nConfig sources:\n  Provider: ${config.provider}`;
    if (config.provider === 'openai-compatible') {
      output += `\n  Base URL: ${config.baseUrl}`;
      output += `\n  Model: ${config.model}`;
    }
  }

  return output;
}