/**
 * @devforge/cli — Environment checks (DF-017.1).
 *
 * Lightweight, dependency-free checks that determine what tooling, repository,
 * and provider state are available WITHOUT initializing the AI/execution stack.
 * Used by `createLightContext()` so `config`, `status`, and `doctor` never spin
 * up brain/planner/executor.
 */

import { execSync } from 'node:child_process';
import { validateModelConfig } from '@devforge/config';
import { createRouterFromConfig } from './brain.js';
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

  // Configuration — provider-aware validation using the shared normalized
  // model-config validator (DF-026C).
  const normalized = {
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
  };
  type ModelValidation =
    | { readonly ok: false; readonly issues: readonly { readonly path: string; readonly message: string }[] }
    | { readonly ok: true };
  const modelValidation: ModelValidation =
    config.provider === 'fake' ? { ok: true } : validateModelConfig(normalized);
  const modelConfigOk = modelValidation.ok;
  const modelConfigErrors = modelConfigOk
    ? []
    : modelValidation.issues.map((issue) => `${issue.path} ${issue.message}`).join(', ');
  checks.push({
    name: 'configuration',
    ok: modelConfigOk,
    detail: modelConfigOk
      ? `${config.provider} provider configured`
      : `${config.provider} provider invalid: ${modelConfigErrors}`,
    fix: modelConfigOk
      ? undefined
      : 'Set DEVFORGE_MODEL (and DEVFORGE_MODEL_BASE_URL for openai-compatible), or use provider: fake',
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

  // Model-config: role-specific model ids must be non-empty strings.
  const roleIssues: string[] = [];
  for (const role of ['reasoning', 'coding', 'fast'] as const) {
    const roleModel = config.roleModels?.[role];
    if (roleModel !== undefined && roleModel.trim().length === 0) {
      roleIssues.push(`${role} model is empty`);
    }
  }
  const roleModelsOk = roleIssues.length === 0;
  const configuredRoles = (['reasoning', 'coding', 'fast'] as const)
    .filter((role) => config.roleModels?.[role] !== undefined)
    .map((role) => `${role}=${config.roleModels?.[role]}`);
  checks.push({
    name: 'model-config',
    ok: roleModelsOk,
    detail: roleModelsOk
      ? `role models configured: ${configuredRoles.join(', ') || 'none'}`
      : roleIssues.join('; '),
    fix: roleModelsOk ? undefined : 'Set DEVFORGE_REASONING_MODEL / DEVFORGE_CODING_MODEL / DEVFORGE_FAST_MODEL to non-empty values',
  });

  // Model-routes: every role must resolve to a provider (DF-027). Building the
  // router is deterministic and makes no network calls; a real provider config
  // surfaces routing errors instead of silently degrading to the fake fallback.
  const router = createRouterFromConfig(config);
  const routesOk = router.list().length > 0;
  checks.push({
    name: 'model-routes',
    ok: routesOk,
    detail: routesOk
      ? `roles → providers: ${router
          .list()
          .map((role) => `${role} → ${router.redactedConfigFor(role)?.provider ?? 'unknown'}`)
          .join(', ')}`
      : 'no model role can be resolved',
    fix: routesOk
      ? undefined
      : 'Set DEVFORGE_MODEL_* environment variables, create a .devforge.json, or use provider: fake',
  });

  return checks;
}

/** Whether a given command name is lightweight (no AI/execution stack). */
export function isLightweightCommand(name: string): boolean {
  return name === 'config' || name === 'status' || name === 'doctor' || name === 'help' || name === 'version';
}