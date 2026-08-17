/**
 * @devforge/cli — Environment checks (DF-017.1).
 *
 * Lightweight, dependency-free checks that determine what tooling, repository,
 * and provider state are available WITHOUT initializing the AI/execution stack.
 * Used by `createLightContext()` so `config`, `status`, and `doctor` never spin
 * up brain/planner/executor.
 */

import { execSync } from 'node:child_process';
import type { DevForgeConfig } from '../types.js';
import type { RepositoryContext } from './workspace.js';

/** A single environment/health check result. */
export interface HealthCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly fix?: string;
}

/** Run a shell command and return success + trimmed output (best-effort). */
function runCheck(cmd: string): { ok: boolean; output: string } {
  try {
    const out = execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 });
    return { ok: true, output: out.trim().split('\n')[0] ?? '' };
  } catch (error) {
    const e = error as { stderr?: string; stdout?: string };
    const detail = e.stderr?.trim().split('\n')[0] ?? e.stdout?.trim().split('\n')[0] ?? String(error);
    return { ok: false, output: detail };
  }
}

/**
 * Run the shared, on-disk/PATH environment checks. This covers everything a
 * lightweight command needs without touching any model or execution service:
 * workspace presence, git, node, pnpm, configuration, and provider readiness.
 */
export function runEnvironmentChecks(
  repository: RepositoryContext,
  config: DevForgeConfig,
): readonly HealthCheck[] {
  const checks: HealthCheck[] = [];

  // Workspace
  checks.push({
    name: 'workspace',
    ok: repository.hasGit || repository.hasPackageJson,
    detail: repository.hasGit
      ? `detected git repo at ${repository.root}`
      : repository.hasPackageJson
        ? `detected package.json at ${repository.root}`
        : `no project files found at ${repository.root}`,
    fix: repository.hasGit || repository.hasPackageJson ? undefined : 'Run in a git repository or directory with package.json',
  });

  // Git
  const gitCheck = runCheck('git --version');
  checks.push({
    name: 'git',
    ok: gitCheck.ok,
    detail: gitCheck.ok ? gitCheck.output : 'git not found on PATH',
    fix: gitCheck.ok ? undefined : 'Install git: https://git-scm.com/downloads',
  });

  // Node
  const nodeCheck = runCheck('node --version');
  checks.push({
    name: 'node',
    ok: nodeCheck.ok,
    detail: nodeCheck.ok ? nodeCheck.output : 'node not found on PATH',
    fix: nodeCheck.ok ? undefined : 'Install Node.js >= 18: https://nodejs.org/',
  });

  // pnpm
  const pnpmCheck = runCheck('pnpm --version');
  checks.push({
    name: 'pnpm',
    ok: pnpmCheck.ok,
    detail: pnpmCheck.ok ? pnpmCheck.output : 'pnpm not found on PATH',
    fix: pnpmCheck.ok ? undefined : 'Install pnpm: https://pnpm.io/installation',
  });

  // Configuration
  const configOk = config.provider === 'fake'
    ? true
    : !!(config.model && config.baseUrl);
  checks.push({
    name: 'configuration',
    ok: configOk,
    detail: configOk
      ? `${config.provider} provider configured`
      : 'openai-compatible provider must set model and baseUrl',
    fix: configOk ? undefined : 'Set DEVFORGE_MODEL_NAME and DEVFORGE_MODEL_BASE_URL, or use provider: fake',
  });

  // Provider availability (mock check — real calls would need credentials)
  const providerAvailable = config.provider === 'fake' || !!(config.apiKey || config.baseUrl);
  checks.push({
    name: 'provider',
    ok: providerAvailable,
    detail: providerAvailable
      ? `${config.provider} provider ${config.model ?? '(default)'} configured`
      : 'no credentials configured for provider',
    fix: providerAvailable ? undefined : 'Set DEVFORGE_MODEL_API_KEY or DEVFORGE_MODEL_BASE_URL for local provider',
  });

  return checks;
}

/** Whether a given command name is lightweight (no AI/execution stack). */
export function isLightweightCommand(name: string): boolean {
  return name === 'config' || name === 'status' || name === 'doctor' || name === 'help' || name === 'version';
}