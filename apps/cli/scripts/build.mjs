/**
 * @vedansh78/cli — production build (DF-029A).
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
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const pkgVersion = JSON.parse(readFileSync(resolve(pkgRoot, 'package.json'), 'utf8')).version;

// Build into a private per-process temp dir so concurrent invocations (e.g. two
// test files' beforeAll, or the turbo `build` task racing a test) never corrupt
// each other's `dist/`. The verified artifact is atomically swapped into
// `dist/` at the end.
const finalDist = resolve(pkgRoot, 'dist');
const workDir = resolve(pkgRoot, `.build-tmp-${process.pid}`);
rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });
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
  // Inject the package version so the published artifact reports the correct
  // version without embedding the full package.json (which would leak the
  // `workspace:*` dev-dependency declarations into dist/).
  define: { 'process.env.DEVFORGE_PKG_VERSION': JSON.stringify(pkgVersion) },
};

// 1. Bundles
await build({
  ...common,
  entryPoints: [resolve(pkgRoot, 'src', 'main.ts')],
  outfile: resolve(workDir, 'main.js'),
});
await build({
  ...common,
  entryPoints: [resolve(pkgRoot, 'src', 'index.ts')],
  outfile: resolve(workDir, 'index.js'),
});
await build({
  ...common,
  format: 'cjs',
  entryPoints: [resolve(pkgRoot, 'src', 'index.ts')],
  outfile: resolve(workDir, 'index.cjs'),
});

// 2. Make the bin executable
chmodSync(resolve(workDir, 'main.js'), 0o755);

// 2b. Strip esbuild's monorepo path artifacts from the published dist:
//     (a) `// ../../packages/<pkg>/src/...` chunk-separator comments, and
//     (b) `"../../packages/<pkg>/src/..."` `__esm` chunk keys. Both reveal
//     the DevForge monorepo layout and must not ship (release-readiness: no
//     repository-relative paths in the artifact). Keys are replaced with
//     neutral unique tokens to preserve esbuild's module-initialization map.
for (const out of [resolve(workDir, 'main.js'), resolve(workDir, 'index.js'), resolve(workDir, 'index.cjs')]) {
  sanitizeRepoPaths(out);
}

// 3. Single-file self-contained declarations via dts-bundle-generator.
//    Inline every @devforge/* workspace package so consumers never need the
//    (unpublished) workspace packages for type resolution.
const dtsOut = resolve(workDir, 'index.d.ts');
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

// 4. Atomically swap the verified artifact into place.
rmSync(finalDist, { recursive: true, force: true });
renameSync(workDir, finalDist);

console.log('@vedansh78/cli build complete');

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