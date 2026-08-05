/**
 * @devforge/cli — doctor command (M1).
 *
 * Run health checks: workspace, provider, git, node, pnpm, configuration.
 */

import { execSync } from 'node:child_process';
import type { CliContext } from '../routing/context.js';
import { color } from '../utils/output.js';

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
 * Run the full set of health checks.
 * Returns a list of checks and whether all passed.
 */
export function runHealthChecks(ctx: CliContext): {
  checks: readonly HealthCheck[];
  allOk: boolean;
} {
  const { config, repository, services } = ctx;
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

  // Repository detection
  const repoOk = repository.hasGit || repository.hasPackageJson;
  checks.push({
    name: 'repository',
    ok: repoOk,
    detail: repoOk
      ? `detected at ${repository.root} (${repository.packageManager ?? 'no package manager'})`
      : `no repository detected at ${repository.root}`,
    fix: repoOk ? undefined : 'Run inside a git repo or project with package.json',
  });

  // tsconfig for TypeScript projects
  if (repository.tsconfig) {
    const tscCheck = runCheck('tsc --version');
    checks.push({
      name: 'typescript',
      ok: tscCheck.ok,
      detail: tscCheck.ok ? tscCheck.output : 'tsc not found',
      fix: tscCheck.ok ? undefined : 'Install TypeScript: pnpm add -D typescript',
    });
  }

  // Test framework if detected
  if (repository.testFramework) {
    const testCheck = runCheck(`${repository.testFramework} --version 2>/dev/null || echo 'not found'`);
    checks.push({
      name: 'test-framework',
      ok: testCheck.ok && !testCheck.output.includes('not found'),
      detail: testCheck.output.includes('not found') ? `${repository.testFramework} not found` : testCheck.output,
      fix: testCheck.output.includes('not found') ? `Install ${repository.testFramework}: pnpm add -D ${repository.testFramework}` : undefined,
    });
  }

  // Lint tool if detected
  if (repository.lintCommand?.includes('eslint')) {
    const eslintCheck = runCheck('eslint --version');
    checks.push({
      name: 'eslint',
      ok: eslintCheck.ok,
      detail: eslintCheck.ok ? eslintCheck.output : 'eslint not found',
      fix: eslintCheck.ok ? undefined : 'Install ESLint: pnpm add -D eslint',
    });
  }

  // Build tool if detected
  if (repository.buildTool) {
    const buildCheck = runCheck(`${repository.buildTool} --version 2>/dev/null || echo 'not found'`);
    checks.push({
      name: 'build-tool',
      ok: buildCheck.ok && !buildCheck.output.includes('not found'),
      detail: buildCheck.output.includes('not found') ? `${repository.buildTool} not found` : buildCheck.output,
      fix: buildCheck.output.includes('not found') ? `Install ${repository.buildTool}: pnpm add -D ${repository.buildTool}` : undefined,
    });
  }

  return {
    checks,
    allOk: checks.every(c => c.ok),
  };
}

/** Handler for `devforge doctor`. */
export async function handleDoctor(ctx: CliContext): Promise<string> {
  const { checks, allOk } = runHealthChecks(ctx);

  const lines = checks.map(c => {
    const status = c.ok ? `${color.green('✓')} ${color.bold(c.name)}` : `${color.red('✗')} ${color.bold(c.name)}`;
    const fix = c.fix ? ` ${color.yellow('→')} ${color.dim(c.fix)}` : '';
    return `${status}  ${c.detail}${fix}`;
  });

  const summary = allOk
    ? `${color.green('All checks passed.')}`
    : `${color.red('Some checks failed.')} ${color.yellow('See fixes above.')}`;

  return `${summary}\n\n${lines.join('\n')}`;
}