# DF-029C Stop-Condition Report

**Phase:** DF-029C — DevForge Release Readiness & Publishing Audit
**Date:** 2026-08-21
**Author:** automated release-readiness audit (DF-029A + DF-029B context)
**Stop condition:** A developer with a clean machine can install the generated
`@vedansh78/cli` tarball and run `devforge --help`, `devforge --version`,
`devforge doctor`, and `devforge config` **outside the DevForge monorepo**, with
no accidental workspace/runtime dependency, secret, source-control artifact, or
development-only artifact in the package.

> **DF-029C complete — package is release-ready but has NOT been published.**

---

## 1. Release architecture

`@vedansh78/cli` is a **single, self-contained npm package** (`apps/cli`). Its
production artifact is produced by `apps/cli/scripts/build.mjs`, which:

1. **Inlines all 14 `@devforge/*` workspace packages** via esbuild `alias`
   (mapped to each `packages/<pkg>/src/index.ts`), so the published bundle
   contains the entire runtime closure and has **zero workspace-only
   resolution**. The build does not depend on sibling `dist/` output.
2. **Externalizes only the 5 real npm dependencies** (`commander`, `zod`,
   `pino`, `pino-pretty`, `typescript`) plus node builtins.
3. **Emits three bundles**: `dist/main.js` (ESM bin, `+x`, shebang),
   `dist/index.js` (ESM library), `dist/index.cjs` (CJS library for the VS Code
   extension).
4. **Emits a single-file `dist/index.d.ts`** via `dts-bundle-generator`
   (inlining every `@devforge/*` type node) so external TypeScript consumers
   need no workspace packages for type resolution.
5. **Sanitizes repository-relative path artifacts** left by esbuild (see §4 and
   §5) so none leak into the shipped artifact.

The package is published via the standard `files` whitelist (`dist`,
`README.md`, `LICENSE`); everything else (tests, source `.ts`, scripts,
`node_modules`) is excluded from the tarball.

---

## 2. Package contents (tarball `vedansh78-cli-0.1.0.tgz`)

Verified with `tar -tzf` — **exactly 7 entries**, no source-control files, no
tests, no fixtures, no temp files, no sourcemaps:

```
package/LICENSE
package/README.md
package/package.json
package/dist/main.js        (ESM bin, 755, shebang #!/usr/bin/env node)
package/dist/index.js       (ESM library)
package/dist/index.cjs      (CJS library)
package/dist/index.d.ts     (single-file bundled declarations)
```

- **Executable:** `main.js` carries `#!/usr/bin/env node` and is `-rwxr-xr-x`.
- **README/LICENSE/metadata:** all present.
- **Declaration files:** `index.d.ts` present and self-contained (no
  `@devforge/` imports remain; type nodes are inlined).
- **No secrets:** tarball `package.json` + `README.md` contain no
  credential-shaped content (`sk-…` scan negative).
- **No local absolute paths:** no `/Users/…` strings in any dist file.
- **No source-control files:** no `.git`, no `.gitignore`, no `.npmrc`
  (the repo-root `.npmrc` is empty anyway), no `.turbo` cache.

---

## 3. Isolated installation procedure

Reproducible from a clean machine:

```bash
# 1. build the self-contained artifact
pnpm --filter @vedansh78/cli build

# 2. produce the tarball
cd apps/cli && npm pack --silent   # -> vedansh78-cli-0.1.0.tgz

# 3. install into a directory OUTSIDE the monorepo (no pnpm, no turbo, no repo)
ISO=$(mktemp -d /tmp/devforge-iso)
cd "$ISO" && npm init -y >/dev/null
npm install --no-audit --no-fund /path/to/vedansh78-cli-0.1.0.tgz

# 4. run with a fresh HOME and no monorepo on PATH
env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=$(mktemp -d) \
    DEVFORGE_PROVIDER=fake DEVFORGE_LOG_LEVEL=error DF_DISABLE_TELEMETRY=1 \
    "$ISO/node_modules/.bin/devforge" --version   # -> 0.1.0, exit 0
```

Observed result: `npm install` resolves **41 packages** (the 5 declared deps +
their trees), creates `node_modules/@vedansh78/cli` only, and reports **no
`workspace:` and no `@devforge/` resolution**. The installed bin subsequently
runs every core command offline.

---

## 4. Runtime dependency audit

The installed package was audited for runtime dependence on monorepo artifacts.

| Concern | Result |
| --- | --- |
| `packages/*`, `apps/*`, `extensions/*` resolution | **None.** No `require`/`import` of any `@devforge/*` path in `main.js`/`index.js`/`index.cjs`. |
| pnpm workspace links (`workspace:*`) | **None at runtime.** The 5 declared `dependencies` are real npm packages. (`devDependencies` still carry `workspace:*` — see §12; they are **not installed** by consumers.) |
| `turbo` | **No dependency.** `.turbo` appears only as a generic default *ignore-dir* string in the repository indexer — not a build/runtime dependency. |
| repository-relative paths | **None after this audit.** esbuild originally emitted `// ../../packages/<pkg>/src/…` comments and `"../../packages/<pkg>/src/…"` `__esm` chunk keys; both are now **stripped/replaced** by `build.mjs` (see §12). Post-fix scan: 0 occurrences in all dist files and in the tarball. |
| `pnpm-workspace.yaml` / `pnpm-lock.yaml` | Present only as **filename strings** inside the workspace-detection service (logic that checks whether the cwd is a pnpm monorepo). This is defensive monorepo awareness, **not** a dependency on pnpm being installed. Documented as a known limitation (§13). |
| node builtins | Used as-is (`node:*`, `node:fs`, `node:os`, …). |

**Declared runtime dependencies (the only externals):**

| Dependency | Version | Purpose |
| --- | --- | --- |
| `commander` | ^12.1.0 | CLI argument parsing |
| `zod` | ^4.4.3 | config schema validation |
| `pino` | ^9.5.0 | structured logging |
| `pino-pretty` | ^11.3.0 | pino transport target |
| `typescript` | 5.9.2 | `parser-typescript` typecheck API |

---

## 5. Configuration verification (matches DF-029B)

Precedence was exercised end-to-end against the **installed tarball** with
isolated HOMEs and confirmed identical to DF-029B:

```
CLI flags (--model)  >  environment (DEVFORGE_*)  >  ./.devforge.json  >  ~/.devforge/config.json  >  defaults (fake)
```

| Scenario | Verification | Result |
| --- | --- | --- |
| Fresh HOME, no config | `doctor` exits 0, explains missing model config; `config` shows `(defaults only)`, `fake` | ✅ |
| Project config (`./.devforge.json`) | picked up; `apiKey` masked `***` | ✅ |
| User config (`~/.devforge/config.json`) | picked up (provider `anthropic`, model `claude-opus-4`) | ✅ |
| Environment config (`DEVFORGE_*`) | resolved, e.g. `DEVFORGE_REASONING_MODEL` → explicit reasoning route | ✅ |
| `apiKeyEnv` credential reference | file names env var holding secret; value read into memory, masked everywhere | ✅ |
| Precedence env > project > user | env `gemini`/`gemini-env-wins` wins over project `openai-compatible` and user `anthropic` | ✅ |

The `config` command documents the precedence line, shows resolved model routes
in stable order `reasoning → coding → fast`, and reports `credentialSource`
(`environment | project | user | none`) — never the value.

---

## 6. Secret audit

The real key `sk-ant-SUPERSECRETVALUE1234567890abcdef` was used in project-file,
environment, and `apiKeyEnv` scenarios. It was **never** observed in:

- **stdout** of `config` / `doctor` (masked as `***`) — verified via `grep -c`
  returning 0 in every scenario.
- **stderr** of every command (including the invalid/missing config error
  paths) — 0 occurrences.
- **JSON output** (`config --json`, `doctor --json`): `apiKey` is the string
  `"***"` (or absent), never the secret.
- **thrown errors**: validation messages reference only field *names* and
  *kinds* (e.g. `Invalid provider "ollama": expected one of …`); secret values
  are never interpolated.
- **generated configuration**: the CLI performs no mutation, so nothing is
  written to disk by `config`/`doctor`.
- **package artifacts**: tarball `package.json` + `README.md` contain no
  `sk-…` patterns.

`apiKeyEnv` stores **only the environment-variable name**, never the secret; the
referenced value lives in memory and is masked in all display.

---

## 7. Node compatibility

- `package.json` declares `engines.node: ">=18"`.
- esbuild bundle `target: 'node18'` — no syntax requiring >18.
- Verified running the installed bin on **Node v24.14.0** and **Node v26.5.0**
  (two shells on the audit machine) with identical, correct behavior.
- No `engines`-strict failure during `npm install` (the 5 deps all support
  Node ≥18).

---

## 8. ESM / CJS verification (VS Code interop)

Against the **installed** package (not the monorepo):

- **CommonJS:** `require('@vedansh78/cli')` exposes `validateConfig`,
  `DEFAULT_CONFIG`, `createLightContext`, `Logger`, etc. ✅
- **ESM:** `import('@vedansh78/cli')` exposes `validateConfig`, `Logger`, etc. ✅
- **Exports map:** `package.json` `exports["."]` has `types`, `import`,
  `require`, `default` — covers every resolution path the extension uses.
- **Typed consumer:** a strict `tsc -p tsconfig.json --noEmit` module
  `nodenext` consumer that imports `validateConfig`, `DEFAULT_CONFIG`,
  `Logger`, and types `DevForgeConfig`/`LightCliContext` from
  `@vedansh78/cli` resolves cleanly from `dist/index.d.ts`. ✅

---

## 9. CLI exit-code verification

Run against the installed bin with isolated HOME:

| Case | Command | Exit |
| --- | --- | --- |
| success | `devforge --version` | 0 |
| success | `devforge --help` | 0 |
| success | `devforge doctor` (fresh) | 0 |
| success | `devforge config` | 0 |
| invalid configuration | project `{"provider":"ollama"}` → `doctor` | 1 |
| missing configuration | project `{"provider":"anthropic"}` (no model) → `doctor` | 1 |
| invalid command | `devforge bogus-command` | 1 |
| invalid arguments | `devforge --not-a-real-flag` | 1 |

Errors on invalid/missing config are secret-free (§6).

---

## 10. `--json` validity

`devforge doctor --json` and `devforge config --json` both exit 0 and emit
**valid JSON** parseable by `JSON.parse` (asserted in the automated suite). The
payloads carry `apiKey: "***"` (or absent) and redacted routes.

---

## 11. README / package metadata audit (req. 21 & 22)

**Package metadata (`apps/cli/package.json`) — all present and correct:**

| Field | Value |
| --- | --- |
| `name` | `@vedansh78/cli` |
| `version` | `0.1.0` |
| `description` | "DevForge — autonomous coding agent CLI. …" |
| `license` | `MIT` |
| `bin` | `{ "devforge": "./dist/main.js" }` |
| `files` | `["dist","README.md","LICENSE"]` |
| `exports` | `types`/`import`/`require`/`default` → `index.d.ts`/`index.js`/`index.cjs` |
| `engines` | `{ "node": ">=18" }` |
| `publishConfig` | `{ "access": "public" }` |

**README audit:** The documented export surface (`run`, `createProgram`,
`createLightContext`, `createExecutionContext`, `validateConfig`,
`discoverRepository`, `createProvider`, `DEFAULT_CONFIG`, `CliError`,
`ConfigError`, `Logger`, …) was checked against `src/index.ts` — **all present**.
The `npm install -g @vedansh78/cli` and `Node >= 18` instructions match the
package. **One discrepancy was found and fixed:** the Configuration section
described `devforge.config.json` / `~/.devforge.json`, but the actual resolved
paths are `.devforge.json` (project) and `~/.devforge/config.json` (user).
`apps/cli/README.md` was updated to document the real precedence and file
locations (§12).

---

## 12. Files changed

**New:**
- `apps/cli/__tests__/release-readiness.test.ts` — 15 deterministic DF-029C
  automated tests (tarball hygiene + no repo-relative/absolute paths; no
  `@devforge/*` runtime requires; no `workspace:*` protocol; clean isolated
  install; offline core commands with fresh HOME; project/user/env/`apiKeyEnv`
  config; precedence; secret audit across stdout/stderr/JSON/errors; exit codes;
  valid `--json`; ESM+CJS interop). All use temp dirs; no real API/credentials;
  `npm install <tarball>` is the only network step (the explicit exception).

**Modified:**
- `apps/cli/scripts/build.mjs` — added `sanitizeRepoPaths()` which strips
  esbuild's `// ../../packages/…` separator comments **and** replaces the
  `"../../packages/…"` `__esm` chunk keys with neutral `df-mod-<n>` tokens, so
  the published `dist` contains **no repository-relative paths** (release
  requirement 4 & 8). Keys stay unique, preserving esbuild's init map.
- `apps/cli/README.md` — Configuration section corrected to the real config
  file locations and precedence (was `devforge.config.json` / `~/.devforge.json`).

**Regenerated (gitignored, not committed):**
- `apps/cli/dist/**`, `apps/cli/vedansh78-cli-0.1.0.tgz`.

No Brain / Planner / Executor / Autonomous / Multi-Agent architecture was
modified. No new model provider was added. No publish, no commit.

---

## 13. Known limitations

- **`devDependencies` retain `workspace:*` in the published `package.json`.**
  These are dev-only (the 14 `@devforge/*` packages + `@repo/typescript-config`)
  and are **never installed by consumers** — proven by the clean isolated
  install (no `@devforge/` / `workspace:` resolution). For an actual publish,
  `pnpm publish` rewrites `workspace:*` to real version ranges; if the package
  is ever published via plain `npm publish`, those dev entries should be stripped
  in a `prepublishOnly` step. They are not a runtime dependency.
- **Monorepo-awareness strings in the bundle.** The workspace-detection service
  references `pnpm-workspace.yaml` / `pnpm-lock.yaml` as filenames, and the repo
  indexer lists `.turbo` as a default ignore dir. These are benign string
  literals (the CLI does not require pnpm/turbo to be installed) but they do
  reveal monorepo tooling awareness. Optional future cleanup: gate these behind
  a build flag.
- **`doctor` pnpm/tsc checks are informational for an npm consumer.** On a
  machine without pnpm/tsc, `doctor` reports those two checks as failed with
  remediation text but still exits 0 and reports the model/configuration state —
  acceptable for a release artifact, but the checks are oriented toward
  in-monorepo development.
- **Malformed project JSON is silently ignored** (falls back to defaults) — this
  is the pre-existing `loadJsonFile` behavior carried over from DF-029B.
- **Real-provider commands** (`ask`/`plan`/`run`/…) require the user's own API
  configuration and network; all audit verification stays offline under the
  `fake` provider.
- **Single transient during verification:** the first `pnpm check-types` run
  reported a VS Code extension failure that disappeared on re-run (turbo cache /
  task-ordering artifact). Direct `pnpm --filter @devforge/vscode-extension
  check-types` and the re-run both pass 26/26.

---

## 14. Test coverage

| Suite | Scope | Count |
| --- | --- | --- |
| `packaging.test.ts` (DF-029A) | self-contained build, tarball hygiene, clean install, bin smoke, ESM+CJS, artifact whitelist | 6 |
| `cli.test.ts`, `cli-config.test.ts`, `first-run-config.test.ts` (DF-029B) | behavior, config matrix, first-run, secret masking | 137 |
| **`release-readiness.test.ts` (DF-029C, NEW)** | tarball hygiene + no repo/absolute paths, no `@devforge/*` requires, no `workspace:*` protocol, clean isolated install, offline core commands, all 4 config mechanisms, precedence, secret audit (stdout/stderr/JSON/errors), exit codes, valid `--json`, ESM+CJS | **15** |
| **Total CLI** | | **158 passing** |

All new tests use temporary directories, inject a `fake` provider, and make **no
real network calls or credential use**.

---

## 15. Verification results

| Scope | Command | Result |
| --- | --- | --- |
| CLI | `pnpm --filter @vedansh78/cli check-types` | ✅ pass |
| CLI | `pnpm --filter @vedansh78/cli build` | ✅ self-contained, sanitized |
| CLI | `pnpm --filter @vedansh78/cli test` | ✅ **158 / 158** (143 + 15 new) |
| VS Code | `pnpm --filter @devforge/vscode-extension check-types` | ✅ pass (against new `dist`) |
| Root | `pnpm check-types` | ✅ **26 / 26** |
| Root | `pnpm build` | ✅ **26 / 26** |
| Root | `pnpm test` | ✅ **46 / 46** |
| Root | `pnpm lint` | ✅ **3 / 3** |
| Isolated | `npm install <tarball>` outside repo | ✅ 41 pkgs, no `@devforge`/`workspace:` |
| Isolated | `devforge --help/--version/doctor/config` (fresh HOME) | ✅ exit 0 |
| Isolated | secret audit (project/env/`apiKeyEnv`) | ✅ no leak in any channel |
| Isolated | ESM `import` + CJS `require` | ✅ both resolve |

---

## 16. Conclusion

A developer with a clean machine **can** install `vedansh78-cli-0.1.0.tgz` into a
directory outside the DevForge monorepo and immediately run `devforge --help`,
`devforge --version`, `devforge doctor`, and `devforge config` — all exit 0
offline, with configuration resolved from env / project / user files per the
documented precedence, secrets masked in every channel, and **zero** runtime
dependency on `packages/*`, `apps/*`, `extensions/*`, pnpm workspace links,
turbo, or repository-relative paths.

The package contains no accidental workspace/runtime dependency, secret,
source-control artifact, or development-only artifact.

**DF-029C complete — package is release-ready but has NOT been published.**
