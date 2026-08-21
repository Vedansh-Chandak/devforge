/**
 * @devforge/cli — doctor command (M1, DF-029B).
 *
 * Run health checks: workspace, provider, git, node, pnpm, configuration,
 * plus tool-specific checks using the shared environment service.
 *
 * First-run behavior (DF-029B): on an unconfigured installation `doctor`
 * clearly explains whether a model provider is configured, which roles are
 * configured, what is missing, and how to configure it. It never crashes
 * merely because no model API key is configured.
 */

import { execSync } from 'node:child_process';
import type { LightCliContext } from '../services/session.js';
import { color } from '../services/output.js';
import { runModelSmoke } from '../services/model-smoke.js';
import {
  resolveModelRoutes,
  summarizeRoleRoutes,
  hasExplicitModelConfig,
} from '../services/model-routes.js';
import type { ResolvedRoutePayload, RoleRouteStatus } from '../services/model-routes.js';

export interface HealthCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly fix?: string;
}

/** Structured model-configuration summary for `doctor --json` (DF-029B). */
export interface ModelConfigurationSummary {
  /** True when any explicit model configuration is present (not pure defaults). */
  readonly configured: boolean;
  readonly provider: string;
  readonly model?: string;
  /** True when a credential of some kind is present (value never included). */
  readonly hasCredential: boolean;
  /** Roles that currently resolve to a route. */
  readonly configuredRoles: readonly string[];
  /** Roles with no resolvable route. */
  readonly missingRoles: readonly string[];
  /** Redacted role→provider routes. */
  readonly routes: readonly ResolvedRoutePayload[];
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

/** Build the DF-029B model-configuration summary (secrets never included). */
export function buildModelConfigurationSummary(config: LightCliContext['config']): {
  summary: ModelConfigurationSummary;
  roleStatus: readonly RoleRouteStatus[];
} {
  const routes = resolveModelRoutes(config);
  const explicit = hasExplicitModelConfig(config);
  // A role resolved only via the offline fake fallback (with no explicit config)
  // is not considered genuinely configured for first-run reporting.
  const roleStatus = summarizeRoleRoutes(routes).map((r) => ({
    ...r,
    configured: r.configured && (r.provider !== 'fake' || explicit),
  }));
  const configuredRoles = roleStatus.filter((r) => r.configured).map((r) => r.role);
  const missingRoles = roleStatus.filter((r) => !r.configured).map((r) => r.role);

  const summary: ModelConfigurationSummary = {
    configured: explicit,
    provider: config.provider,
    model: config.model,
    hasCredential: config.apiKey !== undefined || config.baseUrl !== undefined,
    configuredRoles,
    missingRoles,
    routes,
  };

  return { summary, roleStatus };
}

/**
 * Human-readable detail for the model-configuration check. Explains whether a
 * model provider is configured and which roles resolve — without ever
 * including secret material.
 */
function buildModelConfigurationDetail(
  config: LightCliContext['config'],
  routes: readonly ResolvedRoutePayload[],
  roleStatus: readonly RoleRouteStatus[],
): string {
  const providerLabel = config.provider === 'fake' && !hasExplicitModelConfig(config)
    ? 'none (defaults to fake)'
    : config.provider;

  if (routes.length > 0 && hasExplicitModelConfig(config)) {
    const routeSummary = roleStatus
      .map((r) => `${r.role} → ${r.provider}${r.model ? ` / ${r.model}` : ''}`)
      .join(', ');
    return `model provider "${providerLabel}" configured; roles: ${routeSummary}`;
  }

  if (config.provider === 'fake') {
    return 'no model provider configured (running on the offline fake provider); reasoning/coding/fast fall back to fake';
  }

  // A real provider is set but no role could be resolved.
  const missing = roleStatus.filter((r) => !r.configured).map((r) => r.role);
  const missingPart = missing.length > 0 ? ` unresolved roles: ${missing.join(', ')}` : '';
  return `model provider "${providerLabel}" is set but no model routes resolve${missingPart}`;
}

/** Actionable fix text for the model-configuration check (DF-029B). */
function buildModelConfigurationFix(
  config: LightCliContext['config'],
): string | undefined {
  if (hasExplicitModelConfig(config)) return undefined;

  const steps: string[] = [
    'Set DEVFORGE_MODEL_PROVIDER (gemini | anthropic | openai-compatible), DEVFORGE_MODEL, and DEVFORGE_MODEL_API_KEY',
    'or create a .devforge.json with {"provider": "...", "model": "..."}',
    'or keep the offline fake provider for testing',
  ];
  return steps.join('; ');
}

/**
 * Handler for `devforge doctor`.
 *
 * On an unconfigured installation clearly explains:
 *   - whether a model provider is configured
 *   - which roles are configured
 *   - what is missing
 *   - how the user can configure it
 *
 * It MUST NOT crash merely because no model API key is configured.
 *
 * @param models When enabling `--models`, performs an opt-in live smoke test of
 *   every configured model route (never runs by default / in CI / offline).
 */
export async function handleDoctor(
  ctx: LightCliContext,
  models = false,
): Promise<string | { checks: readonly HealthCheck[]; allOk: boolean; modelConfiguration: ModelConfigurationSummary }> {
  const base = runHealthChecks(ctx);
  const { summary, roleStatus } = buildModelConfigurationSummary(ctx.config);

  // Dedicated first-run check (DF-029B): explain the model configuration state.
  // It is informational — `doctor` must never fail merely because no real model
  // is configured, since the offline `fake` provider is a valid credential-free
  // operational mode. Genuine misconfiguration (invalid provider/model) is
  // already rejected at config load time, so by the time `doctor` runs the
  // config is always structurally valid. Missing *credentials* for a real
  // provider are surfaced by the separate `provider` check below.
  const modelConfiguredCheck: HealthCheck = {
    name: 'model-configuration',
    ok: true,
    detail: buildModelConfigurationDetail(ctx.config, summary.routes, roleStatus),
    fix: buildModelConfigurationFix(ctx.config),
  };

  const smokeChecks = models
    ? await runModelSmoke(ctx.config, { signal: ctx.signal })
    : [];
  const checks = [...base.checks, ...smokeChecks, modelConfiguredCheck];
  const allOk = checks.every((c) => c.ok);

  if (ctx.options.json) {
    return { checks, allOk, modelConfiguration: summary };
  }

  const lines = checks.map(c => {
    const status = c.ok ? `${color.green('✓')} ${color.bold(c.name)}` : `${color.red('✗')} ${color.bold(c.name)}`;
    const fix = c.fix ? ` ${color.yellow('→')} ${color.dim(c.fix)}` : '';
    return `${status}  ${c.detail}${fix}`;
  });

  const summaryLine = allOk
    ? `${color.green('All checks passed.')}`
    : `${color.red('Some checks failed.')} ${color.yellow('See fixes above.')}`;

  return `${summaryLine}\n\n${lines.join('\n')}`;
}
