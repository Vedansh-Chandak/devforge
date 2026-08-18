/**
 * @devforge/cli — doctor command (M1).
 *
 * Run health checks: workspace, provider, git, node, pnpm, configuration,
 * plus tool-specific checks using the shared environment service.
 */

import { execSync } from 'node:child_process';
import type { LightCliContext } from '../services/session.js';
import { color } from '../services/output.js';

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
 * Run tool-specific health checks that depend on the detected repository
 * (typescript, test framework, eslint, build tool). The shared environment
 * checks (workspace/git/node/pnpm/configuration/provider) are already computed
 * by the light context.
 */
function runToolChecks(repository: LightCliContext['repository']): HealthCheck[] {
  const checks: HealthCheck[] = [];

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

  return checks;
}

/**
 * Run the full set of health checks.
 * Returns a list of checks and whether all passed.
 */
export function runHealthChecks(ctx: LightCliContext): {
  checks: readonly HealthCheck[];
  allOk: boolean;
} {
  const { services } = ctx;
  const checks: HealthCheck[] = [
    ...services.environment,
    ...runToolChecks(ctx.repository),
  ];

  return {
    checks,
    allOk: checks.every((c) => c.ok),
  };
}

/** Handler for `devforge doctor`. */
export async function handleDoctor(ctx: LightCliContext): Promise<string | { checks: readonly HealthCheck[]; allOk: boolean }> {
  const { checks, allOk } = runHealthChecks(ctx);

  if (ctx.options.json) {
    return { checks, allOk };
  }

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