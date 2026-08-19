/**
 * @devforge/cli — config command (M1, DF-026C).
 *
 * Show the resolved configuration and which sources it came from. Secret
 * values (apiKey) are always masked. `--json` emits a structured object.
 */

import type { LightCliContext } from '../services/session.js';
import { loadConfig, userConfigPath } from '../services/config-loader.js';
import { createRouterFromConfig } from '../services/brain.js';
import type { RoleModelsConfig } from '../types.js';
import type { ModelSelectionRole } from '@devforge/model-provider';

/** Structured resolved route for one role (apiKey always masked). */
export interface ResolvedRoutePayload {
  readonly role: ModelSelectionRole;
  readonly source: string;
  readonly provider: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
}

/** Structured config payload for `--json` (apiKey always masked). */
export interface ConfigPayload {
  readonly provider: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly temperature: number;
  readonly roleModels?: RoleModelsConfig;
  readonly routes?: readonly ResolvedRoutePayload[];
  readonly maxRepairAttempts?: number;
  readonly workspace?: string;
  readonly logLevel: string;
  readonly sources: readonly string[];
}

/** Handler for `devforge config`. */
export async function handleConfig(ctx: LightCliContext): Promise<string | ConfigPayload> {
  const { config, options } = ctx;
  const { sources } = await loadConfig(ctx.cwd);
  const userPath = userConfigPath();

  // Resolve the effective role→provider mapping (DF-027). Provider adapters
  // are constructed lazily by resolve(); only normalized (redacted) fields are
  // surfaced here, so no secret material is rendered.
  const routes = resolveRoutes(config);

  const payload: ConfigPayload = {
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey ? '***' : undefined,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    temperature: config.temperature ?? 0.2,
    roleModels: config.roleModels,
    routes,
    maxRepairAttempts: config.maxRepairAttempts,
    workspace: config.workspace,
    logLevel: config.logLevel,
    sources,
  };

  if (options.json) {
    return payload;
  }

  const lines: readonly (readonly [string, string])[] = [
    ['Provider', config.provider],
    ['Model', config.model ?? '(default)'],
    ['Base URL', config.baseUrl ?? '(default)'],
    ['API key', config.apiKey ? '***' : '(none)'],
    ['Timeout (ms)', String(config.timeoutMs ?? 'default')],
    ['Max retries', String(config.maxRetries ?? 'default')],
    ['Temperature', String(config.temperature ?? 0.2)],
    ...roleModelLines(config.roleModels),
    ['Max repair attempts', String(config.maxRepairAttempts ?? 3)],
    ['Workspace', config.workspace ?? '(auto)'],
    ['Log level', config.logLevel],
  ];

  let output = `⚙️  DevForge Config\n\n${renderKeyValue(lines)}`;

  output += `\n\nResolved model routes:\n`;
  output += routes.length > 0 ? `${renderKeyValue(routeLines(routes))}` : `  (none)\n`;

  output += `\n\nConfig sources:\n`;
  if (sources.length === 0) {
    output += `  (defaults only)\n`;
  }
  for (const source of sources) {
    output += `  - ${source}\n`;
  }
  if (userPath) {
    output += `\nUser config path: ${userPath}\n`;
  }
  output += `Project config path: ${ctx.cwd}/.devforge.json\n`;

  return output;
}

/** Build the effective role→provider mapping, redacted for display (DF-027). */
function resolveRoutes(config: LightCliContext['config']): readonly ResolvedRoutePayload[] {
  try {
    const router = createRouterFromConfig(config as never);
    const roles = router.list();
    return roles.map((role) => {
      const resolved = router.resolve(role);
      const redacted = router.redactedConfigFor(role);
      return {
        role,
        source: resolved.source,
        provider: redacted?.provider ?? 'unknown',
        model: redacted?.model,
        baseUrl: redacted?.baseUrl,
        apiKey: redacted?.apiKey,
      };
    });
  } catch {
    // Routing is best-effort here: config display must never crash on a
    // malformed model configuration.
    return [];
  }
}

/** Human rows for the resolved model routes (DF-027). */
function routeLines(routes: readonly ResolvedRoutePayload[]): readonly (readonly [string, string])[] {
  return routes.map((route) => {
    const target = route.model ? `${route.provider} / ${route.model}` : route.provider;
    return [`Route · ${route.role}`, `${target}  (${route.source})`];
  });
}

/** Human rows for the role-specific models (DF-026C). */
function roleModelLines(
  roleModels: LightCliContext['config']['roleModels'],
): readonly (readonly [string, string])[] {
  if (!roleModels) return [];
  const lines: (readonly [string, string])[] = [];
  for (const role of ['reasoning', 'coding', 'fast'] as const) {
    if (roleModels[role] !== undefined) {
      lines.push([`Role · ${role}`, roleModels[role]!]);
    }
  }
  return lines;
}

/** Render key/value pairs, aligned on the key column. */
function renderKeyValue(pairs: readonly (readonly [string, string])[]): string {
  if (pairs.length === 0) return '';
  const width = Math.max(...pairs.map(([k]) => k.length), 0);
  return pairs.map(([k, v]) => `  ${k.padEnd(width)}  ${v}`).join('\n');
}