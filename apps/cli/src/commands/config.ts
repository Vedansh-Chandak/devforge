/**
 * @devforge/cli — config command (M1).
 *
 * Show the resolved configuration and which sources it came from.
 */

import type { LightCliContext } from '../services/session.js';
import { loadConfig, userConfigPath } from '../services/config-loader.js';

/** Handler for `devforge config`. */
export async function handleConfig(ctx: LightCliContext): Promise<string> {
  const { config } = ctx;
  const { sources } = await loadConfig(ctx.cwd);
  const userPath = userConfigPath();

  const lines: readonly [string, string][] = [
    ['Provider', config.provider],
    ['Model', config.model ?? '(default)'],
    ['Base URL', config.baseUrl ?? '(default)'],
    ['API key', config.apiKey ? '***' : '(none)'],
    ['Temperature', String(config.temperature ?? 0.2)],
    ['Max repair attempts', String(config.maxRepairAttempts ?? 3)],
    ['Timeout (ms)', String(config.timeoutMs ?? 'default')],
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

/** Render key/value pairs, aligned on the key column. */
function renderKeyValue(pairs: readonly (readonly [string, string])[]): string {
  const width = Math.max(...pairs.map(([k]) => k.length), 0);
  return pairs.map(([k, v]) => `  ${k.padEnd(width)}  ${v}`).join('\n');
}