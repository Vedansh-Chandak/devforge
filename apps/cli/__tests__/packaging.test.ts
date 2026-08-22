/**
 * DF-029A — CLI packaging & npm readiness.
 *
 * Validates the production artifact exactly as npm would consume it:
 *
 *  - `pnpm build` produces a self-contained dist/ (no workspace-only resolution)
 *  - `npm pack` tarball excludes tests, fixtures, env, secrets, and build noise
 *  - a clean `npm install <tarball>` in an isolated temp dir resolves only real
 *    npm dependencies
 *  - the installed `devforge` bin runs `--version`, `--help`, `status`,
 *    `config show`, and `doctor` offline under the fake provider
 *  - the installed package supports BOTH ESM `import` and CommonJS `require`
 *    (VS Code extension interop) and resolves types from `index.d.ts`
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const distDir = join(pkgRoot, 'dist');
const tarball = join(pkgRoot, 'devforge-cli-0.1.0.tgz');

let installDir: string | undefined;

afterAll(() => {
  if (installDir) rmSync(installDir, { recursive: true, force: true });
  rmSync(tarball, { force: true });
});

// Guarantee a complete, self-contained dist (including the bundled index.d.ts)
// before the packaging assertions run. The CLI `test` task does not depend on
// the package's own `build` in turbo, so we build it here. The build always
// wipes `dist/` first, so the artifact set is deterministic and free of any
// stale/duplicate files regardless of ambient build state.
beforeAll(() => {
  execFileSync('node', [join(pkgRoot, 'scripts', 'build.mjs')], { stdio: 'inherit' });
});

function run(cmd: string, args: readonly string[], opts: { cwd: string; env?: NodeJS.ProcessEnv }) {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return { code: result.status ?? 0, stdout: result.stdout, stderr: result.stderr };
}

describe('DF-029A CLI packaging (npm readiness)', () => {
  it('build output is self-contained (no workspace-only runtime resolution)', () => {
    for (const file of ['main.js', 'index.js', 'index.cjs']) {
      const source = readFileSync(join(distDir, file), 'utf8');
      // Bundled output must inline every @devforge/* package.
      expect(
        source.match(/from ['"]@devforge\/[a-z-]+['"];?/),
        `${file} must not import @devforge/* at runtime`,
      ).toBeNull();
      // Declared npm deps are the only externalized imports.
      for (const dep of ['commander', 'zod', 'pino', 'pino-pretty', 'typescript']) {
        expect(source, `${file} should still resolve ${dep}`).toContain(dep);
      }
    }
    // Single-file declarations must not reference the (unpublished) workspace.
    const dts = readFileSync(join(distDir, 'index.d.ts'), 'utf8');
    expect(dts.match(/from ['"](?:@devforge\/|\.\/)[^'"]+/)).toBeNull();
  });

  it('tarball contains only the published artifact (no tests/env/secrets/build noise)', () => {
    const { stdout } = run('npm', ['pack', '--silent'], { cwd: pkgRoot });
    expect(installDir || stdout).toBeTruthy();
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
    const file = lines[lines.length - 1];
    expect(file).toContain('devforge-cli-0.1.0.tgz');

    const { stdout: list } = run('tar', ['-tzf', file], { cwd: pkgRoot });
    const names = list.trim().split(/\r?\n/);
    for (const name of names) {
      expect(name, `prohibited file in tarball: ${name}`).not.toMatch(
        /\.(?:test|spec)\.ts|__tests__|\.env|mock-repository|\.map$|(?<!\.d)\.ts$/,
      );
      expect(name).not.toMatch(/sk-ant-|api[_-]?key|secret|credential|\.pem/i);
    }
    expect(names).toContain('package/dist/main.js');
    expect(names).toContain('package/dist/index.js');
    expect(names).toContain('package/dist/index.cjs');
    expect(names).toContain('package/dist/index.d.ts');
    expect(names).toContain('package/README.md');
    expect(names).toContain('package/LICENSE');
  });

  it('clean npm install in an isolated dir resolves only real npm deps', () => {
    installDir = mkdtempSync(join(tmpdir(), 'devforge-clean-pkg-'));
    run('npm', ['init', '-y'], { cwd: installDir });
    const { stderr, code } = run(
      'npm',
      ['install', '--no-audit', '--no-fund', tarball],
      { cwd: installDir },
    );
    expect(code, `npm install failed: ${stderr}`).toBe(0);
    expect(stderr).not.toContain('workspace:');
    expect(stderr).not.toContain('@devforge/');
  });

  it('installed bin runs version, help, status, config, and doctor offline', () => {
    expect(installDir).toBeTruthy();
    const bin = join(installDir, 'node_modules', '.bin', 'devforge');
    const env = {
      DEVFORGE_PROVIDER: 'fake',
      DEVFORGE_LOG_LEVEL: 'error',
      DF_DISABLE_TELEMETRY: '1',
    };

    const version = run(bin, ['--version'], { cwd: installDir as string, env });
    expect(version.code).toBe(0);
    expect(version.stdout.trim()).toBe('0.1.0');

    const help = run(bin, ['--help'], { cwd: installDir as string, env });
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('devforge');

    const status = run(bin, ['status', '--json'], { cwd: installDir as string, env });
    expect(status.code).toBe(0);
    expect(status.stdout).toContain('Provider');

    const config = run(bin, ['config', 'show'], { cwd: installDir as string, env });
    expect(config.code).toBe(0);
    expect(config.stdout).toContain('fake');

    const doctor = run(bin, ['doctor'], { cwd: installDir as string, env });
    expect(doctor.code).toBe(0);
    expect(doctor.stdout).toContain('All checks passed');
  });

  it('installed package supports ESM import AND CJS require and typed lookup', () => {
    expect(installDir).toBeTruthy();
    const cjs = join(installDir as string, 'probe.cjs');
    execFileSync('node', ['-e', `
      const cli = require('@devforge/cli');
      if (typeof cli.validateConfig !== 'function') throw new Error('CJS missing validateConfig');
      if (typeof cli.DEFAULT_CONFIG !== 'object') throw new Error('CJS missing DEFAULT_CONFIG');
      console.log('cjs-ok');
    `], { cwd: installDir as string });
    execFileSync('node', ['-e', `
      import('@devforge/cli').then(cli => {
        if (typeof cli.createLightContext !== 'function') throw new Error('ESM missing createLightContext');
        if (typeof cli.Logger !== 'function') throw new Error('ESM missing Logger');
        console.log('esm-ok');
      });
    `], { cwd: installDir as string });

    const pkg = JSON.parse(readFileSync(join(installDir as string, 'node_modules/@devforge/cli/package.json'), 'utf8'));
    expect(pkg.type).toBe('module');
    expect(pkg.exports['.']).toHaveProperty('import');
    expect(pkg.exports['.']).toHaveProperty('require');
    expect(pkg.exports['.'].types).toContain('index.d.ts');
    // Declared dependencies are real npm packages, not workspace.
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      expect(dep, `dependency ${dep} must not be a workspace package`).not.toMatch(/^@devforge\//);
    }
  });

  it('installed dist references no workspace dirs and no leaked declarations', () => {
    expect(installDir).toBeTruthy();
    const dist = join(installDir as string, 'node_modules/@devforge/cli/dist');
    const files = readdirSync(dist);
    // Only the four bundled artifacts ship.
    expect(files.sort()).toEqual(['index.cjs', 'index.d.ts', 'index.js', 'main.js']);
  });
});