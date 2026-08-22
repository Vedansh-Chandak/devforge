# DF-031 — Release Checklist: DevForge CLI 0.1.0

**Goal:** Prepare the Git repository for the first *human-controlled* public
release of `@vedansh78/cli@0.1.0`.

**Hard constraints (enforced):**
- No `npm publish` / `pnpm publish` executed by this phase.
- No Git tag created automatically.
- No commit created automatically.
- No features, providers, or architecture changes (Brain / Planner / Executor
  / Autonomous / Multi-Agent untouched).

---

## PRE-RELEASE

### Verification (run & observed this phase)

| Scope | Command | Result |
| --- | --- | --- |
| Root | `pnpm check-types` | ✅ 26 / 26 |
| Root | `pnpm build` | ✅ 26 / 26 |
| Root | `pnpm test` | ✅ 46 / 46 |
| Root | `pnpm lint` | ✅ 3 / 3 |
| CLI | `pnpm --filter @vedansh78/cli build` | ✅ self-contained, sanitized |
| CLI | `npm pack --dry-run` | ✅ 8 files, see below |

### Package audit

`npm pack --dry-run` produced exactly **8** files (matches `files`
in `apps/cli/package.json`):

```
CHANGELOG.md      3.2 kB
LICENSE           1.1 kB
README.md         7.5 kB
dist/index.cjs  493.6 kB   (CommonJS library, VS Code interop)
dist/index.d.ts  79.2 kB   (single-file bundled types)
dist/index.js   488.5 kB   (ESM library)
dist/main.js    487.3 kB   (ESM bin, executable shebang)
package.json      2.1 kB
```

- No `.ts` sources, no tests, no `.git`, no `.env*`, no sourcemaps, no temp files.
- Security scan of `dist`: no `/Users/` paths, no `../../packages|apps|extensions`
  repo-relative paths, no `workspace:*` protocol refs (the `workspace:` hits are
  ordinary object property keys). The only secret-shaped string is the
  redaction regex used to mask Anthropic keys in output — a control, not a leak.

### Version

- `apps/cli/package.json` → `"version": "0.1.0"` ✅
- npm registry (`npm view @vedansh78/cli version`) → **404 Not Found** ✅
  (package has NOT been published yet).

### Git review

Reviewed working-tree changes produced by DF-030 (release-readiness only):

- **Modified tracked:**
  - `apps/cli/package.json` — added `description`, `license`, `repository`,
    `homepage`, `bugs`, `engines`, `exports` (ESM/CJS), `files`, `publishConfig`,
    `scripts.build` (esbuild), real-deps moved to `dependencies`; removed
    `"private": true`. Intentional.
  - `apps/cli/src/commands/config.ts`, `doctor.ts`, `index.ts`,
    `src/services/config-loader.ts`, `src/services/index.ts`, `src/types.ts` —
    DF-029B first-run credential/config reporting. Display-only, secrets masked.
  - `pnpm-lock.yaml` — lockfile update for new/moved deps.
- **New (untracked, intended for release):**
  - `apps/cli/README.md`, `apps/cli/LICENSE`, `apps/cli/CHANGELOG.md`
  - `apps/cli/scripts/build.mjs`, `apps/cli/tsconfig.build.json`
  - `apps/cli/src/services/model-routes.ts`
  - `apps/cli/src/__tests__/first-run-config.test.ts`
  - `apps/cli/__tests__/packaging.test.ts`, `apps/cli/__tests__/release-readiness.test.ts`
  - `DF-030-Release-Readiness-Report.md` (repo root)

**Notes / cautions:**
- `apps/cli/dist/**` is gitignored (root `.gitignore`) → not committed. Correct.
- `apps/cli/vedansh78-cli-0.1.0.tgz` (a prior `npm pack` artifact) was **removed**
  by this phase to keep the tree clean. It is NOT gitignored, so before running
  `git add -A`, confirm **no `*.tgz`** is present/staged. (It is only regenerated
  by `npm pack`, which runs after the commit — so it will not appear at commit time.)
- All changes are confined to packaging, release docs, and first-run display. No
  Brain/Planner/Executor/Autonomous/Multi-Agent code modified. No providers added.

---

## HUMAN ACTION

> Run these yourself. They are provided verbatim — do **not** ask the agent to
> execute them.

### 1. Commit (on the current branch, e.g. `feature/df-027-model-role-wiring`)

```bash
git status
git add -A
git commit -m "chore: prepare DevForge CLI 0.1.0 release"
git push
```

### 2. Open & merge the PR into `main`

Create the PR from the pushed branch and merge it into `main`.

### 3. Tag (after the PR is merged into `main`)

```bash
git checkout main
git pull --ff-only
git tag -a v0.1.0 -m "DevForge CLI v0.1.0"
git push origin v0.1.0
```

### 4. Publish (human-controlled, explicit)

```bash
cd apps/cli
npm login          # one-time auth, if not already logged in
npm publish --access public
```

> **Note on `npm` vs `pnpm`:** the published `package.json` retains
> `workspace:*` entries in `devDependencies` (dev-only; never installed by
> consumers). `npm publish` leaves those strings as-is (harmless), while
> `pnpm publish --access public --no-git-checks` rewrites them to resolved
> version ranges. Either works; `npm publish --access public` is used above per
> the release plan.

---

## POST-RELEASE

After the tag is pushed and `npm publish` succeeds, verify the live package:

```bash
npm install -g @vedansh78/cli@0.1.0
devforge --version        # expect: 0.1.0
devforge doctor           # expect: exit 0 (offline fake provider on fresh install)
devforge config           # expect: exit 0 (masked API key, resolved routes)
devforge --help           # expect: exit 0
```

Then create the GitHub release for tag `v0.1.0` (referenced by `CHANGELOG.md`).
