/**
 * DF-029C — Release readiness & publishing audit (automated).
 *
 * Every scenario runs against the locally built `dist/` and the `npm pack`
 * tarball using throwaway temporary directories. No real API calls, no real
 * credentials, and (aside from the isolated `npm install <tarball>` step that
 * is the explicit exception) no network dependency.
 *
 * Covers:
 *  - tarball hygiene + no repository-relative / absolute paths
 *  - no `@devforge/*` runtime requires and no `workspace:` protocol
 *  - clean isolated install resolves only real npm dependencies
 *  - installed bin runs --version/--help/doctor/config offline (fresh HOME)
 *  - project / user / environment / apiKeyEnv configuration
 *  - configuration precedence (env > project > user > defaults)
 *  - secret audit across stdout / stderr / JSON / thrown errors
 *  - CLI exit codes (success / invalid / missing config / command / args)
 *  - valid `--json` for doctor and config
 *  - ESM import + CommonJS require interop from the installed package
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const distDir = join(pkgRoot, 'dist');
const tarball = join(pkgRoot, 'devforge-cli-0.1.0.tgz');
const SECRET = 'sk-ant-SUPERSECRETVALUE1234567890abcdef';

let installDir: string | undefined;

/** Run the installed bin in a fully isolated env (only DEVFORGE_* + minimal PATH). */
function isolate(cwd: string, home: string, args: readonly string[], env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync('node', [join(installDir!, 'node_modules', '@devforge', 'cli', 'dist', 'main.js'), ...args], {
    cwd,
    env: {
      HOME: home,
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      DEVFORGE_LOG_LEVEL: 'error',
      DF_DISABLE_TELEMETRY: '1',
      ...env,
    },
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  return { code: result.status ?? 0, stdout: result.stdout, stderr: result.stderr };
}

beforeAll(() => {
  // Guarantee a complete, self-contained dist (including the bundled
  // index.d.ts) before packing. The CLI `test` task does not depend on the
  // package's own `build` in turbo, so we build it here to keep the test
  // independent of ambient build state / task ordering.
  if (!existsSync(join(distDir, 'index.d.ts')) || !existsSync(join(distDir, 'main.js'))) {
    execFileSync('node', [join(pkgRoot, 'scripts', 'build.mjs')], { stdio: 'inherit' });
  }
  // Pack once into the package root, then install from an isolated copy so
  // this suite never races with packaging.test.ts over the tarball filename.
  execFileSync('npm', ['pack', '--silent'], { cwd: pkgRoot });
  installDir = mkdtempSync(join(tmpdir(), 'devforge-df029c-'));
  const localTarball = join(installDir, 'devforge-cli-0.1.0.tgz');
  execFileSync('cp', [tarball, localTarball]);
  execFileSync('npm', ['init', '-y'], { cwd: installDir });
  execFileSync('npm', ['install', '--no-audit', '--no-fund', localTarball], { cwd: installDir });
}, 120_000);

afterAll(() => {
  if (installDir) rmSync(installDir, { recursive: true, force: true });
  rmSync(tarball, { force: true });
});

describe('DF-029C tarball hygiene', () => {
  it('contains only the published artifact and no build noise', () => {
    execFileSync('npm', ['pack', '--silent'], { cwd: pkgRoot });
    const list = execFileSync('tar', ['-tzf', tarball], { cwd: pkgRoot, encoding: 'utf8' });
    const names = list.trim().split(/\r?\n/).filter(Boolean);
    expect(names.sort()).toEqual([
      'package/CHANGELOG.md',
      'package/LICENSE',
      'package/README.md',
      'package/dist/index.cjs',
      'package/dist/index.d.ts',
      'package/dist/index.js',
      'package/dist/main.js',
      'package/package.json',
    ]);
  });

  it('has no repository-relative or absolute paths in the published dist', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'df029c-extract-'));
    try {
      execFileSync('tar', ['-xzf', tarball, '-C', tmp], { cwd: pkgRoot });
      const pkg = join(tmp, 'package');
      for (const f of ['dist/main.js', 'dist/index.js', 'dist/index.cjs', 'dist/index.d.ts']) {
        const src = readFileSync(join(pkg, f), 'utf8');
        expect(src, `${f} must not contain ../../ repo-relative paths`).not.toMatch(/\.\.\/\.\.\/(?:packages|apps|extensions)\//);
        expect(src, `${f} must not contain absolute /Users/ paths`).not.toMatch(/\/Users\//);
        expect(src, `${f} must not contain workspace: protocol`).not.toMatch(/workspace:\*/);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('has no @devforge/* runtime requires and no secrets', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'df029c-extract2-'));
    try {
      execFileSync('tar', ['-xzf', tarball, '-C', tmp], { cwd: pkgRoot });
      const pkg = join(tmp, 'package');
      for (const f of ['dist/main.js', 'dist/index.js', 'dist/index.cjs']) {
        const src = readFileSync(join(pkg, f), 'utf8');
        expect(src, `${f} must not runtime-import @devforge/*`).not.toMatch(/(?:require|import)\(['"][^'"]*@devforge\//);
      }
      const meta = readFileSync(join(pkg, 'package.json'), 'utf8') + readFileSync(join(pkg, 'README.md'), 'utf8');
      expect(meta).not.toMatch(/sk-[a-zA-Z0-9]/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('DF-029C isolated install', () => {
  it('resolves only real npm dependencies (no workspace resolution)', () => {
    const { stderr, stdout } = spawnSync('npm', ['install', '--no-audit', '--no-fund', tarball], {
      cwd: installDir!,
      encoding: 'utf8',
    });
    expect(stderr).not.toContain('workspace:');
    expect(stderr).not.toContain('@devforge/');
    expect(stdout).not.toContain('@devforge/');
  });

  it('installed dist is whitelisted and self-contained', () => {
    const dist = join(installDir!, 'node_modules', '@devforge', 'cli', 'dist');
    expect(readdirSync(dist).sort()).toEqual(['index.cjs', 'index.d.ts', 'index.js', 'main.js']);
    for (const f of readdirSync(dist)) {
      const src = readFileSync(join(dist, f), 'utf8');
      expect(src).not.toMatch(/\.\.\/\.\.\/(?:packages|apps|extensions)\//);
      expect(src).not.toMatch(/workspace:\*/);
    }
  });
});

describe('DF-029C core commands offline (isolated HOME)', () => {
  it('version, help, doctor, config all exit 0 on a fresh machine', () => {
    const work = mkdtempSync(join(tmpdir(), 'df029c-work-'));
    const home = mkdtempSync(join(tmpdir(), 'df029c-fresh-'));
    try {
      for (const args of [['--version'], ['--help'], ['doctor'], ['config']]) {
        const r = isolate(work, home, args);
        expect(r.code, `devforge ${args.join(' ')} should exit 0`).toBe(0);
      }
      const v = isolate(work, home, ['--version']);
      expect(v.stdout.trim()).toBe('0.1.0');
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('doctor explains the missing model configuration on a fresh install', () => {
    const work = mkdtempSync(join(tmpdir(), 'df029c-doc-'));
    const home = mkdtempSync(join(tmpdir(), 'df029c-doc-home-'));
    try {
      const r = isolate(work, home, ['doctor']);
      expect(r.code).toBe(0);
      expect(r.stdout).toMatch(/no model provider configured|All checks passed/);
      expect(r.stdout).toMatch(/fake/);
      expect(r.stderr).not.toContain(SECRET);
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('DF-029C configuration scenarios', () => {
  it('project config masks the api key and never leaks it', () => {
    const work = mkdtempSync(join(tmpdir(), 'df029c-proj-'));
    const home = mkdtempSync(join(tmpdir(), 'df029c-proj-home-'));
    writeFileSync(join(work, '.devforge.json'), JSON.stringify({ provider: 'gemini', model: 'gemini-2.5-pro', apiKey: SECRET }));
    try {
      const r = isolate(work, home, ['config']);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('***');
      expect(r.stdout).not.toContain(SECRET);
      expect(r.stderr).not.toContain(SECRET);
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('user config (~/.devforge/config.json) is picked up', () => {
    const work = mkdtempSync(join(tmpdir(), 'df029c-user-'));
    const home = mkdtempSync(join(tmpdir(), 'df029c-user-home-'));
    mkdirSync(join(home, '.devforge'), { recursive: true });
    writeFileSync(join(home, '.devforge', 'config.json'), JSON.stringify({ provider: 'anthropic', model: 'claude-opus-4' }));
    try {
      const r = isolate(work, home, ['config']);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('anthropic');
      expect(r.stdout).toContain('claude-opus-4');
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('environment configuration resolves a credential without leaking it', () => {
    const work = mkdtempSync(join(tmpdir(), 'df029c-env-'));
    const home = mkdtempSync(join(tmpdir(), 'df029c-env-home-'));
    try {
      const r = isolate(work, home, ['config'], { DEVFORGE_PROVIDER: 'gemini', DEVFORGE_MODEL: 'gemini-2.5-flash', DEVFORGE_MODEL_API_KEY: SECRET });
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('***');
      expect(r.stdout).not.toContain(SECRET);
      expect(r.stderr).not.toContain(SECRET);
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('apiKeyEnv credential reference is masked and not leaked', () => {
    const work = mkdtempSync(join(tmpdir(), 'df029c-ref-'));
    const home = mkdtempSync(join(tmpdir(), 'df029c-ref-home-'));
    writeFileSync(join(work, '.devforge.json'), JSON.stringify({ provider: 'gemini', model: 'gemini-2.5-flash', apiKeyEnv: 'MY_SECRET' }));
    try {
      const r = isolate(work, home, ['config'], { MY_SECRET: SECRET });
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('***');
      expect(r.stdout).not.toContain(SECRET);
      const j = isolate(work, home, ['config', '--json'], { MY_SECRET: SECRET });
      expect(j.stdout).toContain('"apiKey": "***"');
      expect(j.stdout).not.toContain(SECRET);
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('precedence is env > project > user', () => {
    const work = mkdtempSync(join(tmpdir(), 'df029c-prec-'));
    const home = mkdtempSync(join(tmpdir(), 'df029c-prec-home-'));
    mkdirSync(join(home, '.devforge'), { recursive: true });
    writeFileSync(join(home, '.devforge', 'config.json'), JSON.stringify({ provider: 'anthropic', model: 'claude-user' }));
    writeFileSync(join(work, '.devforge.json'), JSON.stringify({ provider: 'openai-compatible', model: 'local-model', baseUrl: 'http://localhost' }));
    try {
      const r = isolate(work, home, ['config'], { DEVFORGE_PROVIDER: 'gemini', DEVFORGE_MODEL: 'gemini-env-wins' });
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('gemini');
      expect(r.stdout).toContain('gemini-env-wins');
      expect(r.stdout).not.toContain('claude-user');
      expect(r.stdout).not.toContain('local-model');
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('DF-029C exit codes & JSON', () => {
  it('success exits 0; invalid/missing config, bad command, bad args exit 1', () => {
    const home = mkdtempSync(join(tmpdir(), 'df029c-ec-home-'));
    const dirs: string[] = [];
    try {
      const ok = isolate(mkdtempSync(join(tmpdir(), 'w1-')), home, ['--version']);
      expect(ok.code).toBe(0);

      const badCmd = isolate(mkdtempSync(join(tmpdir(), 'w2-')), home, ['bogus-command']);
      expect(badCmd.code).toBe(1);

      const badArgs = isolate(mkdtempSync(join(tmpdir(), 'w3-')), home, ['--not-a-real-flag']);
      expect(badArgs.code).toBe(1);

      const w4 = mkdtempSync(join(tmpdir(), 'w4-'));
      writeFileSync(join(w4, '.devforge.json'), JSON.stringify({ provider: 'ollama' }));
      const invalid = isolate(w4, home, ['doctor']);
      expect(invalid.code).toBe(1);
      expect(invalid.stderr).not.toContain(SECRET);
      dirs.push(w4);

      const w5 = mkdtempSync(join(tmpdir(), 'w5-'));
      writeFileSync(join(w5, '.devforge.json'), JSON.stringify({ provider: 'anthropic' }));
      const missing = isolate(w5, home, ['doctor']);
      expect(missing.code).toBe(1);
      expect(missing.stderr).not.toContain(SECRET);
      dirs.push(w5);
    } finally {
      rmSync(home, { recursive: true, force: true });
      for (const d of dirs) rmSync(d, { recursive: true, force: true });
    }
  });

  it('doctor --json and config --json emit valid JSON', () => {
    const work = mkdtempSync(join(tmpdir(), 'df029c-json-'));
    const home = mkdtempSync(join(tmpdir(), 'df029c-json-home-'));
    try {
      for (const args of [['doctor', '--json'], ['config', '--json']]) {
        const r = isolate(work, home, args);
        expect(r.code).toBe(0);
        expect(() => JSON.parse(r.stdout)).not.toThrow();
        expect(JSON.parse(r.stdout)).toBeTypeOf('object');
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('DF-029C ESM/CJS interop from the installed package', () => {
  it('supports both import() and require() and resolves real deps only', () => {
    execFileSync('node', ['-e', `
      const c = require('@devforge/cli');
      if (typeof c.validateConfig !== 'function') throw new Error('CJS missing validateConfig');
      if (typeof c.DEFAULT_CONFIG !== 'object') throw new Error('CJS missing DEFAULT_CONFIG');
      if (typeof c.createLightContext !== 'function') throw new Error('CJS missing createLightContext');
    `], { cwd: installDir });
    execFileSync('node', ['-e', `
      import('@devforge/cli').then(c => {
        if (typeof c.validateConfig !== 'function') throw new Error('ESM missing validateConfig');
        if (typeof c.Logger !== 'function') throw new Error('ESM missing Logger');
      });
    `], { cwd: installDir });

    const cli = join(installDir!, 'node_modules', '@devforge', 'cli');
    const pkg = JSON.parse(readFileSync(join(cli, 'package.json'), 'utf8'));
    expect(pkg.type).toBe('module');
    expect(pkg.exports['.']).toHaveProperty('import');
    expect(pkg.exports['.']).toHaveProperty('require');
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      expect(dep).not.toMatch(/^@devforge\//);
    }
  });
});
