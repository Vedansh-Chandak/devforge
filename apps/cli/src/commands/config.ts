/**
 * @devforge/cli — config command (M1, DF-026C).
 *
 * Show the resolved configuration and which sources it came from. Secret
 * values (apiKey) are always masked. `--json` emits a structured object.
 */

import type { LightCliContext } from '../services/session.js';
import { loadConfig, userConfigPath } from '../services/config-loader.js';
import type { RoleModelsConfig } from '../types.js';

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

  const payload: ConfigPayload = {
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey ? '***' : undefined,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    temperature: config.temperature ?? 0.2,
    roleModels: config.roleModels,
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
  const width = Math.max(...pairs.map(([k]) => k.length), 0);
  return pairs.map(([k, v]) => `  ${k.padEnd(width)}  ${v}`).join('\n');
}