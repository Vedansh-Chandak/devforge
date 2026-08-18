# DF-026C Stop-Condition Report

**Phase:** DF-026C — application-level configuration & routing over the normalized model-provider system
**Date:** 2026-08-18
**Stop condition:** all application wiring runs through the normalized `ModelConfig`/`ModelRouter`; gemini + anthropic reachable via `DEVFORGE_MODEL_*` config; tests green; no commit made.

## 1. Objective and scope

Connect the DF-026B concrete adapters (openai-compatible, gemini, anthropic,
fake) to DevForge's application-level configuration (`@devforge/config`,
`@devforge/core`, `@devforge/cli`) and deterministic role-based routing
(reasoning / coding / fast). Deliverables in order: normalized config module,
unified provider factory, `ModelRouter`, core config/schema/env/factory, Brain
router injection, Planner role + error propagation, CLI wiring, multi-agent
role mapping, CLI `config`/`doctor`, documentation, tests, backward-compat,
and this report. Stop after DF-026C — no commit.

## 2. Files created (new)

- `packages/model-provider/src/model-config.ts` — provider-neutral config shape
  (`ModelProviderKind`, `ModelConfig`, `FakeResponseConfig`, `RoleModelConfigMap`,
  `parseModelConfigEnv`, `mergeModelConfig`, `validateModelConfig`,
  `redactModelConfig`, `isMissingModel`, `roleLabel`, `MODEL_SECRET_KEYS`).
- `packages/model-provider/src/router.ts` — `ModelRouter`, `ModelRouterError`,
  `isModelRouterError`, `createModelRouter`, `resolveRoleConfig`,
  `ResolvedModelRoute`, `ModelRouteSource`.
- `packages/model-provider/src/__tests__/{model-config,router,factory-config}.test.ts`.
- `packages/config/src/model-config.ts` + `src/model-config.test.ts` — re-export
  surface so `@devforge/config` is the single configuration import.
- `packages/core/src/router.ts` + `src/__tests__/router.test.ts` —
  `createModelRouterFromConfig` (app config → ModelRouter).
- `packages/brain/src/__tests__/brain-router.test.ts` — router injection tests.
- `packages/planner/src/__tests__/planner-role.test.ts` — role + error-code tests.
- `packages/multi-agent/src/roles/model-roles.ts` + `tests/model-roles.test.ts` —
  agent role → model role mapping (`ROLE_MODEL_MAP`, `modelRoleFor`,
  `resolveModelRolesFor`).
- `apps/cli/src/__tests__/cli-config.test.ts` — CLI config/factory/router/env tests.
- `DF-026C-Stop-Condition-Report.md` (this report).

## 3. Files changed (modified)

- `packages/model-provider/src/factory.ts` — added normalized-config overload
  `createModelProvider(config, fetchFn?)` + `createModelProviderFromConfig`;
  kept the legacy `createModelProvider(kind, config, fetchFn)`.
- `packages/model-provider/src/model-config.ts` — added `fakeResponse` passthrough
  so the fake provider can keep canned responses (core behavior parity).
- `packages/model-provider/src/index.ts` — re-export router + model-config + factory.
- `packages/model-provider/README.md` — DF-026C usage docs (factory + router + env).
- `packages/config/package.json` — added `@devforge/model-provider` dependency.
- `packages/config/src/index.ts` — `export * from './model-config.js'`.
- `packages/config/src/runtime-config.ts` — `ProviderKind` + `RoleModels` +
  `maxRetries` + role env vars (`DEVFORGE_REASONING/CODING/FAST_MODEL`),
  validation, `readFromEnv` role parsing.
- `packages/core/src/types.ts` — `ProviderKind` + `GeminiProviderConfig` +
  `AnthropicProviderConfig` + `RoleModelsConfig` + `DevForgeEnvConfig` role vars.
- `packages/core/src/config.ts` — zod schemas (gemini/anthropic/maxRetries/
  roleModels), `parseEnvConfig` (DEVFORGE_MODEL canonical + roles),
  `buildProviderConfigFromEnv` for all 4 kinds, `mergeConfig` role merging.
- `packages/core/src/provider-factory.ts` — `createModelProvider` now delegates to
  the normalized `createModelProviderFromConfig`; added `createRawModelProvider`.
- `packages/core/src/index.ts` — new exports (`createRawModelProvider`,
  `createModelRouterFromConfig`, gemini/anthropic config types, `RoleModelsConfig`).
- `packages/core/src/app.ts` — brain now receives the router built from config.
- `packages/core/src/__tests__/core.test.ts` — updated the two tests that treated
  `anthropic` as an unknown provider (phase invalidated that assumption);
  added gemini/anthropic/roleModels coverage.
- `packages/brain/src/types.ts` — added `ModelRouterInterface` +
  `BrainConfig.router` (mutually exclusive with `provider`).
- `packages/brain/src/brain.ts` — constructor guard, `resolveProvider()`.
- `packages/planner/src/types.ts` — `PlanningError.providerCode`,
  `PlanResult` `role` field.
- `packages/planner/src/planner.ts` — `PlannerConfig.role`/`PlanOptions.role`,
  distinguishable `ModelProviderError` code propagation.
- `packages/multi-agent/src/index.ts` + `package.json` — export mapping + dep.
- `apps/cli/src/types.ts` — 4 provider kinds, `maxRetries`, `RoleModelsConfig`,
  `CliOptions.model`.
- `apps/cli/src/services/config-loader.ts` — provider validation for all kinds,
  canonical `DEVFORGE_MODEL_*` env (legacy aliases kept), role env parsing,
  `maxRetries`/`roleModels` validation.
- `apps/cli/src/services/brain.ts` — `createProvider` delegates to unified factory;
  new `createRouterFromConfig`; `createBrainService` accepts optional shared router.
- `apps/cli/src/services/executor.ts` — `ModelSource` (provider or router):
  coding→`coding` role, reasoning→`reasoning` role.
- `apps/cli/src/services/planner.ts` — planner source accepts router, routes to
  `reasoning`.
- `apps/cli/src/services/session.ts` — one shared router across brain/planner/executor.
- `apps/cli/src/services/environment.ts` — provider-kind-aware `configuration`
  check via `validateModelConfig`, new `model-config` role check.
- `apps/cli/src/services/orchestrator.ts` — global `--model` option; `--json` path
  unchanged (secret redaction already applied in `printResult`).
- `apps/cli/src/commands/config.ts` — role rows, max retries, structured `--json`
  payload (apiKey always masked).
- `apps/cli/src/commands/doctor.ts` — `--json` structured output.
- `pnpm-lock.yaml` — new workspace dep edges.

## 4. Normalized config design (`model-config.ts`)

- `ModelProviderKind = 'openai-compatible' | 'gemini' | 'anthropic' | 'fake'`.
- `ModelConfig`: provider + model/baseUrl/apiKey/timeoutMs/maxRetries (+
  `fakeResponse` for the fake provider). Provider-neutral — no request formats.
- `parseModelConfigEnv` maps `DEVFORGE_MODEL_PROVIDER`, `DEVFORGE_MODEL`,
  `DEVFORGE_MODEL_BASE_URL`, `DEVFORGE_MODEL_API_KEY`, `DEVFORGE_MODEL_TIMEOUT_MS`,
  `DEVFORGE_MODEL_MAX_RETRIES` plus role vars `DEVFORGE_REASONING_MODEL`,
  `DEVFORGE_CODING_MODEL`, `DEVFORGE_FAST_MODEL`. Never throws; malformed numerics
  are skipped.
- `validateModelConfig`: `provider` required + known; `model` required for non-fake;
  `baseUrl` required + http(s) for openai-compatible (optional for gemini/anthropic);
  `apiKey` string; `timeoutMs` non-negative number; `maxRetries` non-negative int.
- `redactModelConfig` masks `apiKey` → `"***"` (never printed/logged).
- `mergeModelConfig(base, override)` merges role overrides over the default.

## 5. Unified factory (`factory.ts`)

- `createModelProvider(config: ModelConfig, fetchFn?)` — the single
  application-facing entry point; validates first (`INVALID_REQUEST`,
  non-retryable) then maps to the right adapter.
- `createModelProviderFromConfig` — named alias used by the router and core.
- Legacy `createModelProvider(kind, config, fetchFn?)` preserved verbatim
  (DF-026B consumers unaffected).
- `fakeResponse` passthrough keeps core's canned fake responses working through
  the normalized path.

## 6. ModelRouter behavior (`router.ts`)

- Roles: `reasoning | coding | fast` (stable order in `MODEL_ROLES`).
- Resolution fallback: explicit role config → default config → FakeModelProvider
  only when `allowFakeFallback: true` (test/dev).
- No silent downgrade: a real-provider routing failure throws
  `ModelRouterError('MODEL_NOT_CONFIGURED' | 'INVALID_PROVIDER_CONFIG')`; a
  runtime API failure surfaces as the provider's real error.
- Per-role provider cache: identical roles yield identical instances.
- `configFor`/`redactedConfigFor`/`resolve`/`list`/`has` for introspection;
  `fetchFn` injectable for deterministic tests.
- Role configs inherit the default (provider, baseUrl, apiKey, …) and override
  only `model` — verified in core + CLI router tests.

## 7. Core application wiring (`@devforge/core`)

- Config schema + env parsing accept all four providers; `roleModels` merged from
  explicit config then env.
- `provider-factory.ts` delegates to the normalized factory (single construction
  path); `createRawModelProvider` returns the raw `ModelProvider`.
- `createModelRouterFromConfig(model, roleModels)` builds the router;
  `allowFakeFallback` only when the default provider is `fake`.
- `app.ts` (composition root) passes the router to `DevForgeBrain`.

## 8. Brain integration (additive)

- `ModelRouterInterface` in brain types (`has`/`select`/`configFor?`/`resolve?`).
- `BrainConfig.router` is mutually exclusive with `provider` (throws when both);
  explicit `provider` still wins/works for legacy callers.
- `ask()` resolves its generation provider via `router.select('reasoning')` when
  only a router is configured. No change to the reasoning loop or result shapes.

## 9. Planner integration (additive)

- `PlannerConfig.role` (default `reasoning`) + per-call `PlanOptions.role`;
  `PlanResult` success carries the `role`.
- `PlanningError.providerCode` propagates distinguishable model error codes
  (`AUTHENTICATION_ERROR`, `RATE_LIMITED`, …) with `retryable` from the error;
  generic errors keep `MODEL_ERROR` without a `providerCode`.

## 10. CLI wiring

- `config-loader`: 4 provider kinds; canonical `DEVFORGE_MODEL_*` env with legacy
  aliases (`DEVFORGE_PROVIDER`, `DEVFORGE_BASE_URL`, `DEVFORGE_API_KEY`,
  `DEVFORGE_TIMEOUT_MS`) preserved; role env vars → `roleModels`.
- `services/brain.ts`: `createProvider` now uses the unified factory; new
  `createRouterFromConfig`; `createBrainService` shares one router across services.
- `services/executor.ts` + `services/planner.ts`: accept `ModelProvider | Router`
  (`ModelSource`); routing maps coding→`coding`, reasoning→`reasoning`; a plain
  provider keeps legacy single-provider behavior.
- `services/session.ts`: one router built once, shared by brain/planner/executor.
- `services/environment.ts`: `configuration` check now provider-kind-aware via
  `validateModelConfig`; new `model-config` check validates role models.
- Commands: `config` shows role rows + max retries, emits structured JSON with
  `apiKey` always masked; `doctor` emits structured JSON; global `--model` option
  overrides the model id for display/checks.

## 11. Multi-agent integration (additive)

- `roles/model-roles.ts`: `ROLE_MODEL_MAP` — PLANNER→reasoning (fallback fast),
  CODER→coding (fallback reasoning), REVIEWER→reasoning (fallback fast),
  REPAIR→coding (fallback reasoning), TESTER→fast, DOCUMENTATION→fast.
- `resolveModelRolesFor(role, routerHas)` returns preferred-then-fallback model
  roles that are actually configured. Role agents remain provider-agnostic
  (injectable deterministic backends); the mapping is pure metadata for the
  swarm/executor layer.

## 12. Env-var surface (final)

`DEVFORGE_MODEL_PROVIDER`, `DEVFORGE_MODEL` (canonical; `DEVFORGE_MODEL_NAME`
legacy alias retained in core), `DEVFORGE_MODEL_BASE_URL`, `DEVFORGE_MODEL_API_KEY`,
`DEVFORGE_MODEL_TIMEOUT_MS`, `DEVFORGE_MODEL_MAX_RETRIES`, `DEVFORGE_REASONING_MODEL`,
`DEVFORGE_CODING_MODEL`, `DEVFORGE_FAST_MODEL`. CLI legacy aliases
(`DEVFORGE_PROVIDER`, `DEVFORGE_BASE_URL`, `DEVFORGE_API_KEY`,
`DEVFORGE_TIMEOUT_MS`) still accepted; canonical names take precedence.

## 13. Security / redaction decisions

- API keys never printed: CLI `config` masks `apiKey` as `***` in human and JSON
  output; router `redactedConfigFor` masks to `***`; environment checks never
  echo keys; `printResult` still applies `redactSecrets`.
- `ModelRouterError` messages carry no secrets.
- Planner errors pass through `ModelProviderError.message` (already redacted by
  adapters); tests assert no key leaks.

## 14. Test counts

| Package | Before | After |
| --- | --- | --- |
| model-provider | 310 / 14 files | 366 / 17 files |
| config | 20 / 2 files | 32 / 3 files |
| core | 31 / 1 file | 36 / 2 files |
| brain | — | 126 / 4 files (added 5) |
| planner | — | 57 / 4 files (added 6) |
| multi-agent | — | 310 / 18 files (added 10) |
| cli | — | 71 / 4 files (added 18) |

New suites: `model-config.test.ts`, `router.test.ts`, `factory-config.test.ts`
(model-provider); `model-config.test.ts` (config); `router.test.ts` (core);
`brain-router.test.ts` (brain); `planner-role.test.ts` (planner);
`model-roles.test.ts` (multi-agent); `cli-config.test.ts` (cli). All model calls
use injected fetch/mock or the fake provider — no real API calls anywhere.

## 15. Package verification

Each touched package passes `check-types`, `build`, and `test`:
model-provider (366), config (32), core (36), brain (126), planner (57),
multi-agent (310), cli (71).

## 16. Root verification

- `pnpm check-types`: 26/26 packages pass.
- `pnpm build`: 26/26 pass (includes vscode-extension).
- `pnpm test`: 46/46 task targets pass (includes vscode-extension, 311 tests).
- `pnpm lint`: 3/3 pass (`--max-warnings 0`).

## 17. Backward compatibility status

- `createModelProvider(kind, config, fetchFn?)` signature + all adapter
  constructors unchanged; only tests reference concrete adapters (allowed).
- `@devforge/config` `redactSecrets` still exported (consumers: CLI
  `errors.ts`, `orchestrator.ts`); config package consumers unaffected.
- Core `createModelProvider(config)` keeps its exact signature/behavior for the
  four providers; `ModelProviderInterface` return type unchanged.
- Brain `provider` option still supported; `router` is additive.
- Planner deterministic path unchanged; role/providerCode are additive fields.
- CLI legacy env aliases and `createProvider` remain.
- No public exports removed from any package.

## 18. Known limitations

- Streaming is not implemented: `generate()` is request/response. Surfacing
  streams cleanly requires a contract extension — tracked as future work
  (DF-026D candidate); `ModelCapabilities.supportsStreaming` remains the flag.
- Fake fallback is only reachable when the config provider is `fake`; a real
  provider config never degrades to fake (by design).
- Legacy env aliases are tolerated but deprecated; docs steer to the canonical
  `DEVFORGE_MODEL_*` names.
- Role routing chooses the *same* adapter for all roles (config inheritance);
  a role switching adapters is out of scope for DF-026C.

## 19. Streaming decision (stop-condition gate)

Streaming was deferred, not skipped: the normalized contract is untouched, so
nothing downstream regresses. Documented as DF-026D follow-up, satisfying the
phase's "only if clean; otherwise document" rule.

## 20. Remaining scope after DF-026C

- Streaming support over the normalized contract (DF-026D).
- Optional `ModelCapabilities` / `ModelProviderInfo` surfacing from adapters.
- Swarm-layer wiring that actually selects model-backed paths via
  `resolveModelRolesFor` (mapping is shipped; no consumer changes needed yet).

No commits were made.
