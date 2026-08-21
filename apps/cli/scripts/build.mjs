/**
 * @devforge/cli — production build (DF-029A).
 *
 * Produces a self-contained, publishable artifact:
 *
 *   dist/main.js      ESM bundle, platform=node, shebang, bin entry (self-contained)
 *   dist/index.js     ESM bundle, library entry (self-contained)
 *   dist/index.cjs    CJS bundle, library entry (VS Code / CommonJS interop)
 *   dist/index.d.ts   Single-file, self-contained type declarations
 *
 * All `@devforge/*` workspace packages are INLINED via esbuild aliases so the
 * published tarball has zero workspace-only resolution. Only real npm deps
 * (commander, zod, pino, pino-pretty, typescript) and node builtins stay
 * external. Declarations are similarly inlined into one index.d.ts via
 * dts-bundle-generator.
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const bin = resolve(pkgRoot, 'node_modules', '.bin');

/** Declared runtime (non-workspace) dependencies — the only external imports. */
const external = ['commander', 'zod', 'pino', 'pino-pretty', 'typescript'];

/** Workspace packages in the CLI's transitive dependency closure. */
const workspacePackages = [
  'brain',
  'config',
  'errors',
  'execution',
  'knowledge-graph',
  'logger',
  'model-provider',
  'parser-typescript',
  'planner',
  'prompt-composer',
  'repository-indexer',
  'runtime',
  'symbol-graph',
  'tools',
];

/** Alias every workspace package to its TypeScript source entry. */
const alias = Object.fromEntries(
  workspacePackages.map((name) => [
    `@devforge/${name}`,
    resolve(pkgRoot, '..', '..', 'packages', name, 'src', 'index.ts'),
  ]),
);

const common = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  external,
  alias,
  sourcemap: false,
  logLevel: 'info',
  absWorkingDir: pkgRoot,
};

// 1. Clean
rmSync(resolve(pkgRoot, 'dist'), { recursive: true, force: true });
mkdirSync(resolve(pkgRoot, 'dist'), { recursive: true });

// 2. Bundles
await build({
  ...common,
  entryPoints: [resolve(pkgRoot, 'src', 'main.ts')],
  outfile: resolve(pkgRoot, 'dist', 'main.js'),
});
await build({
  ...common,
  entryPoints: [resolve(pkgRoot, 'src', 'index.ts')],
  outfile: resolve(pkgRoot, 'dist', 'index.js'),
});
await build({
  ...common,
  format: 'cjs',
  entryPoints: [resolve(pkgRoot, 'src', 'index.ts')],
  outfile: resolve(pkgRoot, 'dist', 'index.cjs'),
});

// 3. Make the bin executable
chmodSync(resolve(pkgRoot, 'dist', 'main.js'), 0o755);

// 3b. Strip esbuild's monorepo path artifacts from the published dist:
//     (a) `// ../../packages/<pkg>/src/...` chunk-separator comments, and
//     (b) `"../../packages/<pkg>/src/..."` `__esm` chunk keys. Both reveal
//     the DevForge monorepo layout and must not ship (release-readiness: no
//     repository-relative paths in the artifact). Keys are replaced with
//     neutral unique tokens to preserve esbuild's module-initialization map.
for (const out of [resolve(pkgRoot, 'dist', 'main.js'), resolve(pkgRoot, 'dist', 'index.js'), resolve(pkgRoot, 'dist', 'index.cjs')]) {
  sanitizeRepoPaths(out);
}

// 4. Single-file self-contained declarations via dts-bundle-generator.
//    Inline every @devforge/* workspace package so consumers never need the
//    (unpublished) workspace packages for type resolution.
const dtsOut = resolve(pkgRoot, 'dist', 'index.d.ts');
execFileSync(
  resolve(bin, 'dts-bundle-generator'),
  [
    '--external-inlines', ...workspacePackages.map((n) => `@devforge/${n}`),
    '--no-check',
    '--no-banner',
    '--project', resolve(pkgRoot, 'tsconfig.build.json'),
    '-o', dtsOut,
    resolve(pkgRoot, 'src', 'index.ts'),
  ],
  { stdio: 'inherit' },
);

fixDeclarations(dtsOut);

console.log('@devforge/cli build complete');

/**
 * dts-bundle-generator inlines module-namespace values by hoisting their
 * members but drops the `typeof <namespace>` binding used by
 * src/services/session.ts (`output`, `progress`). Replace them with explicit
 * structural types built from the already-hoisted top-level declarations.
 */
/**
 * Remove every repository-relative path reference esbuild leaves in the
 * bundle: `// ../../packages/...` separator comments AND the
 * `"../../packages/..."` `__esm` chunk keys. Both point at the DevForge
 * monorepo source tree; neither is required at runtime. Chunk keys are
 * replaced with neutral unique tokens (`df-mod-<n>`) so esbuild's lazy
 * module-initialization map stays consistent.
 */
function sanitizeRepoPaths(file) {
  const src = readFileSync(file, 'utf8');
  const pathRe = /"\.\.\/\.\.\/(?:packages|apps|extensions)\/[^"]+\.(?:ts|tsx|mts|cts|js|mjs|cjs|json)"/g;
  let n = 0;
  const out = src
    .replace(pathRe, () => `"df-mod-${n++}"`)
    .split('\n')
    .filter((line) => !/^\/\/ \.\.[^ \n]*\.(?:ts|tsx|mts|cts|js|mjs|cjs|json)\s*$/.test(line))
    .join('\n');
  writeFileSync(file, out);
}

function fixDeclarations(file) {
  const src = readFileSync(file, 'utf8');
  const outputModule =
    '{ color: typeof color; writeJson: typeof writeJson; renderPlan: typeof renderPlan; ' +
    'renderPlanResult: typeof renderPlanResult; renderCodingReport: typeof renderCodingReport; ' +
    'renderExecutionReport: typeof renderExecutionReport; renderStatus: typeof renderStatus; };';
  const progressModule =
    '{ Spinner: typeof Spinner; withSpinner: typeof withSpinner; };';
  const out = src
    .replace(/readonly output: typeof output;/g, `readonly output: ${outputModule}`)
    .replace(/readonly progress: typeof progress;/g, `readonly progress: ${progressModule}`);
  if (out === src) {
    throw new Error('build: declaration fix found no `output`/`progress` namespace refs to replace');
  }
  writeFileSync(file, out);
  console.log('  index.d.ts declaration namespace refs normalized');
}