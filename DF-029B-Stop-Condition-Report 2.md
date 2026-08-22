# DF-029B — DevForge First-Run Setup & Model Configuration

**Status:** Complete. Fresh installation is understandable and configurable without
editing source code. Existing CLI behavior is preserved; all root verification is green.

---

## 1. Configuration Architecture

DF-029B builds on the **existing** architecture; no new provider was introduced, no
model-provider contract was changed, and Brain/Planner/Executor/Autonomous-Agent
behavior is untouched. Two existing layers do the heavy lifting:

- **`@devforge/cli` config loader** (`apps/cli/src/services/config-loader.ts`) —
  parses environment variables and the two config files, merges them over defaults,
  and validates the result into a `DevForgeConfig`. It now also resolves credential
  references and reports where the credential came from.
- **`@devforge/model-provider` `ModelRouter`** — the single source of truth for
  role → provider routing (`reasoning` / `coding` / `fast`). CLI commands never touch
  provider adapters directly; they always go through `createRouterFromConfig`.

A new thin CLI-side service, **`apps/cli/src/services/model-routes.ts`**, was added to
keep route resolution DRY and safe for *display* commands (`doctor`, `config`). It only
calls `createRouterFromConfig` + `redactModelConfig` and **never throws** — malformed
config yields an empty route list rather than crashing an inspection command.

```
config-loader (load/validate/precedence)
        │  DevForgeConfig
        ▼
model-routes.resolveModelRoutes(config)   ──► ResolvedRoutePayload[] (apiKey masked)
        │  uses createRouterFromConfig + redactModelConfig
        ▼
doctor / config handlers (display only, never mutate)
```

## 2. Precedence Rules (deterministic)

Verified by test `configuration precedence`. The effective order, highest wins:

```
CLI flags  (e.g. --model)            [applied post-load by session service]
    ↓
environment  (DEVFORGE_*)
    ↓
./.devforge.json   (project-local)
    ↓
~/.devforge/config.json   (user-global)
    ↓
defaults  (provider = fake)
```

Notes:
- The CLI-flag tier (`--model`) is applied in `createLightContext` after `loadConfig`
  returns, exactly as before this change.
- Environment canonical names (`DEVFORGE_MODEL_*`) take precedence over legacy aliases
  (`DEVFORGE_PROVIDER`, `DEVFORGE_API_KEY`, …) — unchanged from DF-026C.
- Within a single layer, `loadConfig` is a single deterministic object spread
  (`{ ...user, ...project, ...env }`), so there is never an ambiguous partial merge.
- Invalid configuration (bad provider/model) fails fast at `loadConfig` with a clear
  message; `doctor`/`config` never run on structurally invalid config (this is the
  existing, preserved behavior — see Known Limitations for the malformed-JSON case).

## 3. Supported Configuration Mechanisms

| Setting | Where | Notes |
|---|---|---|
| `provider` | env / files / flags | `fake \| gemini \| anthropic \| openai-compatible` |
| `model` | env / files / `--model` | required for real providers |
| `baseUrl` | env / files | required for `openai-compatible` |
| `apiKey` | env `DEVFORGE_MODEL_API_KEY` / `DEVFORGE_API_KEY`, or file | secret; masked/redacted everywhere |
| `apiKeyEnv` | file only (NEW) | **credential reference** — names an env var holding the secret. The secret itself never touches disk. Explicit `apiKey` wins when both present. |
| `reasoning` / `coding` / `fast` | env `DEVFORGE_{ROLE}_MODEL`, or `roleModels` in files | per-role model selection |
| `timeout` / `timeoutMs` | env / files | forwarded to the provider |
| `retry` / `maxRetries` | env / files | forwarded to the provider (where the adapter supports retries) |
| `temperature`, `maxRepairAttempts`, `workspace`, `logLevel` | env / files | non-provider settings |

Non-interactive / CI configuration is fully supported: a CI job can run entirely from
`DEVFORGE_*` environment variables (including `DEVFORGE_REASONING_MODEL` etc.) with no
config file and no TTY. No command reads stdin, so the flow is fully automatable.

A separate mutating/interactive `setup` command was **deliberately not added** — it would
surprise users by writing files (requirement 7) and is unnecessary because env vars and
editing `./.devforge.json` already cover mutation. `devforge config` is inspection-only.

## 4. First-Run Behavior

`devforge doctor` on a fresh, unconfigured installation (no config files, no env):

- **Does not crash.** The offline `fake` provider is a valid, credential-free operational
  mode, so `doctor` exits `0` and reports `All checks passed`. Requirement 5's "must not
  crash merely because no model API key is configured" is satisfied — and existing
  DF-029A behavior (fresh install → green doctor) is preserved.
- **Clearly explains the model state.** A dedicated `model-configuration` check is added
  with human text such as:
  `no model provider configured (running on the offline fake provider); reasoning/coding/fast fall back to fake`
  and a remediation `fix` line:
  `Set DEVFORGE_MODEL_PROVIDER (gemini | anthropic | openai-compatible), DEVFORGE_MODEL, and DEVFORGE_MODEL_API_KEY; or create a .devforge.json with {"provider": "...", "model": "..."}; or keep the offline fake provider for testing`
- **`--json`** emits a structured `modelConfiguration` object: `configured`, `provider`,
  `model`, `hasCredential`, `configuredRoles`, `missingRoles`, and redacted `routes`.
- Genuine misconfiguration (e.g. a real provider with no credentials, or an invalid
  provider/model) is still surfaced — either by the `provider` check (missing credential)
  or by a hard config-load error, with clear, secret-free guidance.

`devforge config` shows the resolved configuration, the **resolved model routes**
(`Route · reasoning → gemini / gemini-2.5-pro (explicit)` etc.), the credential source,
and the precedence line, all with `apiKey` masked as `***`.

## 5. Model Routing Behavior

Deterministic and delegated entirely to `ModelRouter` (`@devforge/model-provider`):

- Default route = the top-level `provider`/`model`/`baseUrl`/`apiKey` block.
- Per-role override = `roleModels.{reasoning,coding,fast}` (from file) merged over the
  default; `source` is reported as `explicit`.
- A role with no explicit entry inherits the default route (`source: default`).
- Offline `fake` fallback only applies when `provider === 'fake'` (test/dev) — real
  providers never silently downgrade to fake.
- `resolveModelRoutes` and `summarizeRoleRoutes` always return roles in stable order
  `['reasoning','coding','fast']`.

This means `Reasoning → Gemini / model-name` style resolution is reproducible and is what
`config`/`doctor` render.

## 6. Secret-Handling Decisions

- **Never printed:** `config`/`doctor` render `apiKey` as `***` only; the value is never
  written to stdout/stderr or logs.
- **Never in errors:** Validation errors reference only field *names* and *kinds*
  (e.g. `Invalid provider "ollama": expected one of …`); secret values are never
  interpolated. The full load error path was tested to confirm a `sk-…` value in a config
  file does not leak into the thrown message.
- **Never in JSON:** `--json` payloads carry `apiKey: '***'` (or `undefined` when unset)
  and per-route `apiKey: '***'`. The orchestrator also runs `redactSecrets` on the final
  serialized output as a backstop.
- **Never on disk:** the new `apiKeyEnv` mechanism stores only the *name* of an env var,
  not the secret. The referenced value is read into memory at load time and masked in all
  display.
- **Credential metadata only:** config/`doctor` report `credentialSource`
  (`environment | project | user | none`) — never the value.
- **No commit of credentials:** nothing in this change writes files under source control;
  config files live in the project dir or `~/.devforge/`, both outside the repo by default.

## 7. Test Coverage

New suite `apps/cli/src/__tests__/first-run-config.test.ts` (**35 tests**) plus the
existing 108 CLI tests. Total CLI = **143** passing. The matrix maps directly to
requirement 13:

- empty / unconfigured installation (defaults, doctor explains, config safe, `--json`)
- valid configuration (gemini + role models route deterministically; doctor "configured")
- invalid provider (clean error, no secret leak)
- invalid model (openai-compatible without baseUrl; gemini without model)
- missing credential (loads; `provider` check flags missing key; no crash)
- environment credential (resolves, masked everywhere, `credentialSource: environment`)
- `apiKeyEnv` credential reference (resolves, masked; explicit `apiKey` wins; missing var → no credential, no crash; invalid name rejected)
- secret masking (real key absent from doctor/config text **and** JSON; every route `apiKey: '***'`)
- role routing (distinct models per role; partial roles fall back to default; stable order)
- reasoning / coding / fast configuration (`hasExplicitModelConfig`, `summarizeRoleRoutes`)
- JSON output (doctor `--json` shape; config `--json` shape incl. `credentialSource`)
- configuration precedence (env > project > user > defaults, each tier fall-back)
- malformed config (invalid JSON ignored → defaults; wrong-typed values → validation error, no secret leak)
- CI / non-interactive mode (env-only end-to-end, no stdin, `--json` machine-readable)
- doctor output / config output (human text assertions)
- clean temporary HOME / config directory (`userConfigPath` inside temp HOME; user config picked up; doctor+config run cleanly)

All tests use temp directories and inject fake providers / `ModelRouter`; **no network
calls** are made (provider adapters are constructed but never `generate`).

## 8. Files Changed

- `apps/cli/src/commands/doctor.ts` — rewritten handler; added `model-configuration`
  first-run check + `ModelConfigurationSummary` type + `buildModelConfigurationSummary`.
- `apps/cli/src/commands/config.ts` — uses shared `model-routes` resolver; shows
  `credentialSource`; prints precedence line; `ResolvedRoutePayload` re-exported for
  backward compat.
- `apps/cli/src/services/model-routes.ts` — **NEW** shared, non-throwing route
  resolution + `summarizeRoleRoutes` + `hasExplicitModelConfig`.
- `apps/cli/src/services/config-loader.ts` — `apiKeyEnv` validation/resolution,
  `credentialSource` return, precedence documentation.
- `apps/cli/src/types.ts` — `RawDevForgeConfig.apiKeyEnv` added.
- `apps/cli/src/services/index.ts` — exports `model-routes` service + `CredentialSource`.
- `apps/cli/src/index.ts` — exports new types/services (`ResolvedRoutePayload`,
  `RoleRouteStatus`, `ModelConfigurationSummary`, `ConfigPayload`, `CredentialSource`,
  `resolveModelRoutes`, …).
- `apps/cli/src/__tests__/first-run-config.test.ts` — **NEW** (35 tests).

## 9. Verification Results

| Scope | Command | Result |
|---|---|---|
| CLI | `pnpm --filter @devforge/cli check-types` | ✅ pass |
| CLI | `pnpm --filter @devforge/cli build` | ✅ pass |
| CLI | `pnpm --filter @devforge/cli test` | ✅ **143/143** (108 existing + 35 new) |
| Root | `pnpm check-types` | ✅ **26/26** |
| Root | `pnpm build` | ✅ **26/26** |
| Root | `pnpm test` | ✅ **46/46** |
| Root | `pnpm lint` | ✅ **3/3** |

Stop conditions met:
- Fresh install with no configuration does not crash ✅
- `devforge doctor` clearly explains missing model configuration ✅
- `devforge config` displays resolved routes safely (masked) ✅
- Reasoning/coding/fast routes resolve deterministically ✅
- Credentials are never leaked (text, JSON, errors, disk) ✅
- Configuration precedence is deterministic and documented ✅
- CI / non-interactive usage works ✅
- Existing tests remain green ✅
- New tests cover the configuration matrix ✅
- Root verification completely green ✅

## 10. Known Limitations

- **Malformed JSON project file is silently ignored** (treated as "no file"). This is
  the existing `loadJsonFile` behavior; it prevents a typo from bricking the CLI, but
  means a user with a syntax error in `.devforge.json` gets quiet fallback to defaults
  rather than an explicit error. (Wrong *typed* values — e.g. `timeoutMs: "soon"` — are
  still rejected with a clear validation error.)
- **No interactive `setup` wizard.** Mutation is via env vars or editing
  `./.devforge.json` / `~/.devforge/config.json`. This is intentional per requirement 7
  (avoid unexpected file mutation). If a guided wizard is desired later, it should be a
  separate explicit command and opt-in.
- **`credentialSource` is coarse** (environment / project / user / none). It does not
  distinguish two environment variables (`DEVFORGE_MODEL_API_KEY` vs legacy
  `DEVFORGE_API_KEY`) or whether a `project` credential came via `apiKey` vs `apiKeyEnv`.
- **No secrets-manager integration.** `apiKeyEnv` covers "reference a secret already in
  an env var" (e.g. CI vault injection) but there is no native support for cloud secret
  stores; that would be a new system and is out of scope for DF-029B.
- **Does not publish or modify Brain/Planner/Executor/Autonomous-Agent.** Per
  requirements, those behaviors are unchanged.
