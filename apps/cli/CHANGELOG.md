# Changelog

All notable changes to `@vedansh78/cli` are documented here. This project
follows [Semantic Versioning](https://semver.org/).

## [0.1.1] — 2026-08-22 — Package identity fix (publish scope)

This patch corrects the published package identity so the CLI can be installed
from npm. There are **no command, architecture, model, or provider changes**;
the `devforge` binary and all runtime behavior are identical to `0.1.0`.

- Published package renamed from `@devforge/cli` to `@vedansh78/cli` (the
  publishable npm scope). Install with `npm install -g @vedansh78/cli` or
  run with `npx @vedansh78/cli`.
- All `@devforge/*` workspace packages remain internal build-time inputs and are
  still bundled into the published artifact. Internal package names are unchanged.
- Shipped tarball: `vedansh78-cli-0.1.1.tgz`.

## [0.1.0] — 2026-08-21 — First public release

This is the first public, installable release of the DevForge CLI. The package
is fully self-contained: every `@devforge/*` workspace package is bundled into
the published artifact at build time, so installing the tarball requires no
access to the DevForge monorepo.

### Commands

- `devforge status` — print workspace, provider, selected model, repository,
  branch, and engine version.
- `devforge doctor` — run environment health checks (workspace, provider, git,
  node, configuration, model routes). On an unconfigured installation it clearly
  explains whether a model provider is configured, which roles are configured,
  what is missing, and how to configure it. Never crashes merely because no API
  key is set.
- `devforge config` — show the resolved configuration, the model routes per
  role, the credential source, and the precedence used. API keys are always
  masked. `--json` emits a structured object.
- `devforge plan <goal>` — Brain → Planner → print an execution plan (does not
  execute).
- `devforge ask <question>` — full autonomous pipeline (Repository Discovery →
  Indexer → Brain → Planner → Executor → Workspace → Verification).
- `devforge explain <topic>` — Repository Indexer → Parser → Knowledge Graph →
  Brain → Markdown explanation.
- `devforge review` — Git status/diff → Brain → reasoning model review
  (bugs, style, security, performance, missing tests).
- `devforge fix <goal>` — autonomous coding: analyze → generate patches → apply
  → verify → repair.
- `devforge run <goal>` — Planner → Executor (generate a plan, then execute it).

### Configuration

- Precedence (highest wins): CLI flags (`--model`) → environment (`DEVFORGE_*`)
  → project file `./.devforge.json` → user file `~/.devforge/config.json` →
  built-in defaults.
- Providers: `fake` (offline, default, no credentials), `gemini`, `anthropic`,
  `openai-compatible` (requires `baseUrl`).
- Credentials are never stored in the package or printed. Use the `apiKeyEnv`
  field to reference an environment variable that holds the secret; the value is
  read into memory and masked in all display.
- `--json` on `doctor` and `config` produces machine-readable output.

### Packaging

- Self-contained ESM bin (`dist/main.js`), ESM library (`dist/index.js`),
  CommonJS library (`dist/index.cjs`) for VS Code interop, and a single-file
  bundled `dist/index.d.ts`.
- Declared runtime dependencies are only the real npm packages:
  `commander`, `zod`, `pino`, `pino-pretty`, `typescript`.
- Requires Node.js >= 18.

### Programmatic API

`run`, `createProgram`, `createLightContext`, `createExecutionContext`,
`validateConfig`, `discoverRepository`, `createProvider`, `DEFAULT_CONFIG`,
`CliError`, `ConfigError`, `Logger`, and related types are exported for embedding
DevForge in other tools (e.g. the VS Code extension).

[0.1.0]: https://github.com/Vedansh-Chandak/devforge/releases/tag/v0.1.0
[0.1.1]: https://github.com/Vedansh-Chandak/devforge/releases/tag/v0.1.1
