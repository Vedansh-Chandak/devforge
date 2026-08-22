# DF-030 Release-Readiness Report

**Phase:** DF-030 — DevForge First Public Release Preparation
**Date:** 2026-08-21
**Package:** `@devforge/cli`
**Prerequisite phases:** DF-029A (packaging), DF-029B (first-run config), DF-029C (release audit) — all complete and green.

> **`npm publish` was NOT executed.** This phase prepares the release; publishing
> is left as an explicit, human-controlled action (see *Publish commands* below).

---

## 1. Release version

- **Chosen version: `0.1.0`.**
- Rationale: `0.1.0` was the established development version across DF-029A/B/C
  and was **never published**, so there is no existing released version to
  overwrite. `0.1.0` is an honest, conventional first public semver for an early
  but fully functional tool. Bumping to `1.0.0` is a product decision intentionally
  left to the human; it can be applied by editing `apps/cli/package.json` before
  publishing.
- The `CHANGELOG.md` entry is tagged `[0.1.0]` and links to a
  `v0.1.0` GitHub release/tag (to be created by the human at publish time).

---

## 2. Package metadata

`apps/cli/package.json` (audited and updated):

| Field | Value |
| --- | --- |
| `name` | `@devforge/cli` |
| `version` | `0.1.0` |
| `description` | "DevForge — autonomous coding agent CLI. Ask, plan, review, fix, explain, and run DevForge from your terminal." |
| `license` | `MIT` |
| `type` | `module` |
| `repository` | `{ "type": "git", "url": "git+https://github.com/Vedansh-Chandak/devforge.git" }` |
| `homepage` | `https://github.com/Vedansh-Chandak/devforge#readme` |
| `bugs` | `{ "url": "https://github.com/Vedansh-Chandak/devforge/issues" }` |
| `bin` | `{ "devforge": "./dist/main.js" }` |
| `main` | `./dist/index.cjs` |
| `module` | `./dist/index.js` |
| `types` | `./dist/index.d.ts` |
| `exports` | `types` / `import` / `require` / `default` → `index.d.ts` / `index.js` / `index.cjs` |
| `engines` | `{ "node": ">=18" }` |
| `publishConfig` | `{ "access": "public" }` |
| `files` | `["dist", "README.md", "LICENSE", "CHANGELOG.md"]` |
| `dependencies` (runtime, real npm only) | `commander ^12.1.0`, `zod ^4.4.3`, `pino ^9.5.0`, `pino-pretty ^11.3.0`, `typescript 5.9.2` |

`repository` / `homepage` / `bugs` were **added** this phase using the real
upstream remote (`git remote -v` → `github.com/Vedansh-Chandak/devforge`). No URL
was guessed.

> Note: `devDependencies` still contain `workspace:*` entries for the 14
> `@devforge/*` packages and `@repo/typescript-config`. These are **dev-only**
> and are never installed by consumers (verified below). When publishing with
> `pnpm publish`, pnpm rewrites `workspace:*` to resolved version ranges. They do
> not affect the installable artifact.

---

## 3. Included artifacts (tarball `devforge-cli-0.1.0.tgz`)

`npm pack` produces exactly **8** entries (verified with `tar -tzf`):

```
package/CHANGELOG.md
package/LICENSE
package/README.md
package/dist/index.cjs      # CommonJS library (VS Code interop)
package/dist/index.d.ts     # single-file bundled type declarations
package/dist/index.js       # ESM library
package/dist/main.js        # ESM bin (executable, shebang #!/usr/bin/env node)
package/package.json
```

No tests, no `.ts` sources, no source-control files (`.git`), no `.env*`, no
sourcemaps, no temporary files, no secrets.

---

## 4. Installation instructions

From the published registry (post-publish):

```bash
npm install -g @devforge/cli     # global
npx @devforge/cli <command>      # without installing
```

Requires **Node.js >= 18**.

From the generated tarball (this audit):

```bash
npm install --no-audit --no-fund ./apps/cli/devforge-cli-0.1.0.tgz
```

---

## 5. First-run instructions

DevForge runs **offline out of the box** using the built-in `fake` provider
(no API key). Immediately verify:

```bash
devforge --version
devforge doctor
devforge status
```

`devforge doctor` performs health checks and, on an unconfigured machine,
explains what provider/model setup is needed — it never crashes and exits
successfully. To use a real model provider, configure it (see §6).

---

## 6. Supported configuration

Precedence (highest wins):

1. CLI flags (`--model`)
2. Environment variables (`DEVFORGE_*`)
3. Project file `./.devforge.json` (cwd)
4. User file `~/.devforge/config.json`
5. Built-in defaults (provider `fake`)

Providers: `fake` (offline default), `gemini`, `anthropic`, `openai-compatible`
(requires `baseUrl`). Per-role models via `reasoning` / `coding` / `fast` and
`DEVFORGE_REASONING_MODEL` / `DEVFORGE_CODING_MODEL` / `DEVFORGE_FAST_MODEL`.

Credentials are never stored on disk or printed. Use `apiKeyEnv` to name an
environment variable that holds the secret; an explicit `apiKey` value wins over
`apiKeyEnv`. All display masks the key as `***`.

`devforge config` shows the resolved config, per-role model routes, credential
source, and precedence; `--json` (also on `doctor`) emits structured, masked
output.

---

## 7. Verification results

| Scope | Command | Result |
| --- | --- | --- |
| CLI | `pnpm --filter @devforge/cli check-types` | ✅ pass |
| CLI | `pnpm --filter @devforge/cli build` | ✅ self-contained, sanitized |
| CLI | `pnpm --filter @devforge/cli test` | ✅ **158 / 158** (143 prior + 15 DF-029C + updated assertions) |
| Root | `pnpm check-types` | ✅ **26 / 26** |
| Root | `pnpm build` | ✅ **26 / 26** |
| Root | `pnpm test` | ✅ **46 / 46** (includes CLI 158/158) |
| Root | `pnpm lint` | ✅ **3 / 3** |
| VS Code | `pnpm --filter @devforge/vscode-extension check-types` | ✅ pass (against new `dist`) |

All green. Note: `pnpm test` previously raced with an incomplete `dist` because
the CLI `test` task does not depend on the package's own `build` in turbo; this
was fixed by making the packaging tests guarantee a complete `dist` in
`beforeAll` (see §12). After the fix, `pnpm test` is deterministically green.

---

## 8. Isolated installation results

Performed in a directory **outside the monorepo** (`/tmp/...`), with `env -i`
(isolated environment), `HOME` set to a fresh temp dir, and no monorepo path on
`PATH`:

- `npm install --no-audit --no-fund devforge-cli-0.1.0.tgz` → exit 0, **41 packages**
  resolved (the 5 real runtime deps + their trees).
- `node_modules/@devforge` contains **only `cli`** — no sibling workspace links.
- Install resolution logs contain **no `@devforge/` and no `workspace:`**.
- `devforge --version` → `0.1.0`, exit 0.
- `devforge --help` → exit 0.
- `devforge doctor` → exit 0 (explains offline `fake` provider).
- `devforge config` → exit 0 (masked API key, resolved routes).

The package is **independently runnable outside the DevForge monorepo**.

---

## 9. Security checks

- **No secrets in the artifact.** Scanned `package.json`, `README.md`,
  `CHANGELOG.md`, and all `dist` files for credential-shaped content. The only
  `sk-…` match is the **secret-redaction regex** (`replace(/\bsk-ant-[…]/…)`)
  used to mask Anthropic keys in output — a security control, not a leaked secret.
- **No local absolute paths.** No `/Users/…` strings in `dist`.
- **No repository-relative paths.** No `../../packages|apps|extensions/…` strings
  (stripped by `build.mjs`, verified 0 occurrences).
- **No `workspace:*` protocol at runtime.** The 5 declared `dependencies` are
  real npm packages; no `@devforge/*` appears in `require`/`import` of the
  bundles. (`devDependencies` carry `workspace:*` but are never installed by
  consumers.)
- **No test / source-control / temp artifacts** in the tarball.
- **Secrets never exposed at runtime.** Verified in DF-029C (and re-affirmed):
  project-file, environment, and `apiKeyEnv` credentials are masked in stdout,
  stderr, `--json`, and thrown errors.

---

## 10. Known limitations

- **`devDependencies` retain `workspace:*` in the published `package.json`.**
  Harmless for consumers (devDeps aren't installed), but `pnpm publish` should be
  used (it rewrites them) rather than plain `npm publish`, which would leave
  `workspace:*` strings in the published devDependencies.
- **`doctor` runs `pnpm`/`tsc` environment checks.** On a standalone install
  without pnpm/tsc, these two checks are reported as failed with remediation
  text, but `doctor` still exits 0 and reports the model/configuration state.
  Documented in the README troubleshooting section.
- **Version `0.1.0` is a deliberate first-public choice.** Bumping to `1.0.0`
  (if desired for a "stable" signal) is a one-line `package.json` edit before
  publish.
- **Real-provider commands** (`ask`/`plan`/`explain`/`review`/`fix`/`run`)
  require the user's own provider configuration and network; all audit
  verification stays offline under the `fake` provider.

---

## 11. Files changed (this phase)

**New:**
- `apps/cli/CHANGELOG.md` — first-release notes (`0.1.0`).
- `DF-030-Release-Readiness-Report.md` (repo root).

**Modified:**
- `apps/cli/package.json` — added `repository`, `homepage`, `bugs`; added
  `CHANGELOG.md` to `files`. Version kept `0.1.0`.
- `apps/cli/README.md` — expanded and corrected release documentation:
  install (`npm -g` / `npx`), first-run, full command table (added `explain`),
  global options, provider configuration (env + file + `apiKeyEnv`), `doctor`,
  `config`, supported Node version, troubleshooting, accurate programmatic API.
- `apps/cli/__tests__/release-readiness.test.ts` — updated the tarball-contents
  assertion to the new 8-entry expected list (CHANGELOG.md added).
- `apps/cli/__tests__/packaging.test.ts` — added a `beforeAll` that guarantees a
  complete `dist` (including `index.d.ts`) before packaging assertions, so the
  test no longer depends on ambient/turbo build ordering.

**Regenerated (gitignored, not committed):**
- `apps/cli/dist/**`, `apps/cli/devforge-cli-0.1.0.tgz`.

No Brain / Planner / Executor / Autonomous / Multi-Agent architecture was
modified. No new provider was added. No publish, no commit.

---

## 12. Publish commands (for the human — NOT executed)

The package is built and packed. To publish:

```bash
# 1. (optional) preview what will be published
cd apps/cli
npm pack                       # already done: devforge-cli-0.1.0.tgz
npm publish --dry-run          # inspect the tarball that would be sent

# 2. authenticate (one time)
npm login                      # or: pnpm login

# 3. publish — recommended via pnpm so workspace:* devDependencies are
#    rewritten to real version ranges:
pnpm publish --access public --no-git-checks

#    Alternative (npm): npm publish --access public
#    (leaves workspace:* in devDependencies; harmless since devDeps are
#     not installed by consumers)
```

After publishing, create the GitHub release/tag `v0.1.0` referenced by
`CHANGELOG.md`.

---

## 13. Conclusion

`@devforge/cli@0.1.0` is prepared for its first public release:

- Metadata is complete and accurate (`name`, `version`, `description`,
  `license`, `repository`, `homepage`, `bugs`, `bin`, `exports`, `files`,
  `engines`, `publishConfig`).
- The tarball contains exactly the intended 8 artifacts; no secrets, no
  repository-relative/absolute paths, no `workspace:*` runtime dependency, no
  test/source-control/temp files.
- It installs and runs completely independently outside the monorepo on a clean
  machine (`--help`, `--version`, `doctor`, `config` all exit 0).
- Release documentation (install, first-run, provider config, `doctor`,
  `config`, Node support, usage, troubleshooting) and a `CHANGELOG.md` are in
  place and verified against actual behavior.
- All verification is green: CLI `check-types`/`build`/`test` (158/158), root
  `check-types` 26/26, `build` 26/26, `test` 46/46, `lint` 3/3.

**`npm publish` was NOT executed. The package is ready for a human-controlled
`npm publish` / `pnpm publish`.**
