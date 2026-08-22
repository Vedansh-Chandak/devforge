/**
 * @vedansh78/cli — engine version.
 *
 * Injected at build time via an esbuild `define` (see scripts/build.mjs) so the
 * published binary always reports the packaged version without hardcoding it in
 * source or embedding the full package.json (which would leak `workspace:*`
 * dev-dependency declarations into the artifact).
 *
 * Falls back to reading package.json at runtime when the define is absent (e.g.
 * running source directly via tsx in dev).
 */
import { readFileSync } from 'node:fs';

function resolveVersion(): string {
  const injected = process.env.DEVFORGE_PKG_VERSION;
  if (injected) return injected;
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

/** The packaged engine version. */
export const ENGINE_VERSION: string = resolveVersion();
