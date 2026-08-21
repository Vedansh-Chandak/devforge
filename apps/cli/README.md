# @devforge/cli

**DevForge — autonomous coding agent CLI.**

A single, self-contained command-line tool that answers questions, plans, reviews,
fixes, and runs autonomous coding tasks in your repository.

## Install

Requires **Node.js >= 18**.

```bash
npm install -g @devforge/cli
```

Or run without installing:

```bash
npx @devforge/cli <command>
```

After install, the `devforge` command is available on your `PATH`.

## First run

DevForge works out of the box in **offline mode** using the built-in `fake`
provider, which needs no API key. Verify your installation immediately:

```bash
devforge --version
devforge doctor
devforge status
```

`devforge doctor` runs environment health checks. On a fresh, unconfigured
machine it will tell you that no model provider is configured and explain how to
set one up — it does **not** crash, and it exits successfully. To use a real
model provider (Gemini, Anthropic, or an OpenAI-compatible endpoint), follow the
provider configuration below.

## Commands

| Command | Description |
| --- | --- |
| `devforge status` | Print workspace, provider, selected model, repository, branch, engine version. |
| `devforge doctor` | Run environment health checks (workspace, provider, git, node, configuration, model routes). |
| `devforge config` | Show the resolved configuration, per-role model routes, and credential source. API keys are masked. |
| `devforge plan <goal>` | Brain → Planner → print an execution plan (does not execute). |
| `devforge ask <question>` | Full autonomous pipeline: Repository Discovery → Indexer → Brain → Planner → Executor → Workspace → Verification. |
| `devforge explain <topic>` | Repository Indexer → Parser → Knowledge Graph → Brain → Markdown explanation. |
| `devforge review` | Git status/diff → Brain → reasoning review (bugs, style, security, performance, missing tests). |
| `devforge fix <goal>` | Autonomous coding: analyze → generate patches → apply → verify → repair. |
| `devforge run <goal>` | Planner → Executor (generate a plan, then execute it). |

Global options:

| Flag | Description |
| --- | --- |
| `-j, --json` | Machine-readable JSON output on stdout (supported by `doctor` and `config`). |
| `-d, --debug` | Debug logging. |
| `-y, --yes` | Auto-approve confirmation steps (autonomous mode). |
| `-m, --model <id>` | Override the model id. |
| `-h, --help` | Show help. |

`devforge config` and `devforge config show` are equivalent (showing the resolved
config is the default action).

## Provider configuration

Configuration is resolved with the following precedence (highest wins):

1. CLI flags (e.g. `--model`)
2. Environment variables (`DEVFORGE_*`)
3. Project file `./.devforge.json` in the current working directory
4. User file `~/.devforge/config.json`
5. Built-in defaults (provider `fake`, offline)

### Supported providers

| `provider` | Needs `model` | Needs `baseUrl` | Notes |
| --- | --- | --- | --- |
| `fake` | no | no | Offline, default. No credentials. Good for trying DevForge locally. |
| `gemini` | yes | no | Set `model` to a Gemini model id. |
| `anthropic` | yes | no | Set `model` to a Claude model id. |
| `openai-compatible` | yes | yes | Point `baseUrl` at your OpenAI-compatible endpoint. |

### Via environment variables

```bash
export DEVFORGE_MODEL_PROVIDER=gemini
export DEVFORGE_MODEL=gemini-2.5-pro
export DEVFORGE_MODEL_API_KEY=your-key-here
# optional per-role models:
export DEVFORGE_REASONING_MODEL=gemini-2.5-pro
export DEVFORGE_CODING_MODEL=gemini-2.5-flash
export DEVFORGE_FAST_MODEL=gemini-2.5-flash
```

### Via a project or user config file

`.devforge.json` (project) or `~/.devforge/config.json` (user):

```json
{
  "provider": "gemini",
  "model": "gemini-2.5-pro",
  "reasoning": "gemini-2.5-pro",
  "coding": "gemini-2.5-flash",
  "fast": "gemini-2.5-flash"
}
```

### Credentials — never stored on disk

The API key itself is **never written to a config file or printed**. To keep the
secret out of your config file, use `apiKeyEnv` to name an environment variable
that holds the key:

```json
{
  "provider": "gemini",
  "model": "gemini-2.5-pro",
  "apiKeyEnv": "DEVFORGE_API_KEY"
}
```

At load time DevForge reads `DEVFORGE_API_KEY` from the environment into memory
and masks it everywhere it is displayed. An explicit `apiKey` value in the config
file wins over `apiKeyEnv`.

## `devforge doctor`

`devforge doctor` checks that your environment can run DevForge: it verifies the
workspace, git, Node version, provider configuration, and resolved model routes,
and prints a `model-configuration` summary with remediation steps when something
is missing. With `fake` (the default) it reports that you are running offline and
exits successfully. Use `devforge doctor --json` for machine-readable output.

> Note: when DevForge is installed standalone (not from the monorepo), the
> `pnpm` and `tsc` checks are informational only — DevForge runs fine without
> them. They matter for developing DevForge itself.

## `devforge config`

`devforge config` prints:

- the resolved `Provider`, `Model`, `Base URL`, and masked `API key`
- `Resolved model routes` per role (`reasoning` / `coding` / `fast`)
- `Config sources` (which files / env contributed)
- `Precedence` line documenting the resolution order
- `credentialSource` (`environment` / `project` / `user` / `none`)

`devforge config --json` emits the same information as structured JSON, with the
API key always masked.

## Supported Node version

DevForge requires **Node.js >= 18**. The published bundle targets Node 18 and is
verified on Node 24 and Node 26.

## Troubleshooting

- **`doctor` says a model provider is not configured.** You are on the `fake`
  provider (offline). To use a real model, set `provider`/`model` via env vars or
  a `.devforge.json` file as shown above.
- **`Invalid provider "…"` / `provider "…" requires a "model"`.** Your config has
  a real provider but is missing the required `model` (and, for
  `openai-compatible`, `baseUrl`). Add it and re-run `devforge doctor`.
- **`devforge config` shows `(none)` for the API key but I set one.** If you used
  `apiKeyEnv`, make sure the named environment variable is exported in the shell
  that runs `devforge`. `devforge config` will still report the credential source
  and mask the value.
- **Command requires network access.** `ask`, `plan`, `explain`, `review`, `fix`,
  and `run` call your configured model provider; they need a valid provider and
  (for real providers) network access and credentials. Use `fake` to explore
  offline.

## Programmatic API

```js
// ESM
import { createLightContext, validateConfig } from '@devforge/cli';

// CommonJS
const { createLightContext, validateConfig } = require('@devforge/cli');
```

Export surface: `run`, `createProgram`, `createLightContext`,
`createExecutionContext`, `validateConfig`, `discoverRepository`,
`createProvider`, `DEFAULT_CONFIG`, `CliError`, `ConfigError`, `Logger`, and more.

## Development

This package is part of the DevForge monorepo. The published artifact is fully
self-contained: all `@devforge/*` workspace packages are bundled at build time so
the installed tarball has zero workspace-only dependencies.

```bash
pnpm --filter @devforge/cli build      # bundle ESM/CJS + typed index.d.ts
pnpm --filter @devforge/cli test       # unit + e2e smoke tests
pnpm --filter @devforge/cli check-types
```

See [`CHANGELOG.md`](./CHANGELOG.md) for release notes.
