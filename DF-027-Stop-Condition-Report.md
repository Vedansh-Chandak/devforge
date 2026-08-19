# DF-027 Stop-Condition Report

**Phase:** DF-027 — model role wiring: consumers use ModelRouter roles instead of concrete model construction
**Date:** 2026-08-19
**Stop condition:** every model-consuming DevForge agent consumes the normalized `ModelRouter` role contract (`reasoning` / `coding` / `fast`) and never names, imports, or constructs concrete provider adapters outside the owning implementation package; deterministic tests green at package and root level; no commit made.

## 1. Objective and scope

Make all model-consuming agents (Brain, Planner, Autonomous, Multi-agent swarm, CLI wiring) consistently route through the DF-026C role router. Consumers stay provider-agnostic: they resolve `reasoning` / `coding` / `fast` via `ModelRouter.has/select` (or the minimal `RouterLike` structural contract) and never import or construct `OpenAICompatibleProvider`, `GeminiProvider`, `AnthropicProvider`, or `FakeModelProvider` in production code. Where a consumer already had correct role wiring (Planner `role`, CLI `createExecutorService`/`createPlannerService`, multi-agent `ROLE_MODEL_MAP`, streaming capability detection), DF-027 verified it, tightened it, and added deterministic tests plus an architectural guard.

Out of scope: new providers, provider failover, cloud, dashboard, sessions, RAG, embeddings, vector DB, fine-tuning, multi-agent networking, deployment, new UI, `ModelProvider` redesign, `ModelRouter` redesign, DF-028.

## 2. Files created (new)

- `packages/brain/src/__tests__/brain-role-routing.test.ts` — DF-027 role routing tests for the brain (5 tests: reasoning default, `role: 'fast'`, reasoning→fast selection fallback, unconfigured role → classified result, explicit provider backward compatibility).
- `packages/planner/src/__tests__/planner-router-wiring.test.ts` — planner wired through a real `ModelRouter` (4 tests: reasoning default, coding role, fast per-call override, deterministic fallback without a model source).
- `packages/integration-tests/src/provider-boundary.test.ts` — architectural guard (Phase 13) that scans consumer `src` trees for banned concrete-provider imports. Covers brain, planner, autonomous, multi-agent, execution, cli, github, vscode.
- `DF-027-Stop-Condition-Report.md` (this report).

## 3. Files changed (modified)

- `packages/brain/src/types.ts` — `BrainConfig` gains `role?: ModelSelectionRole` (default `'reasoning'`); docs describe the reasoning→fast selection fallback (role routing, never provider failover).
- `packages/brain/src/brain.ts` — `askRole` field; `resolveProvider()` resolves the configured role with a reasoning→fast selection fallback; explicit `provider` still wins (backward compatible).
- `packages/model-provider/src/router.ts` — `ModelRouter.normalizeComplete()` now carries `fakeResponse` through so role-specific fake configs construct deterministic fake providers (needed for deterministic role tests); all other router semantics unchanged.
- `packages/multi-agent/src/roles/model-roles.ts` — new `ModelRouterLike` interface (`has`/`select`) and `resolveConfiguredModelRole(role, router)` returning the single best model role for an agent role against a router.
- `packages/multi-agent/src/index.ts` — exports `resolveConfiguredModelRole` and `ModelRouterLike`.
- `packages/multi-agent/tests/model-roles.test.ts` — 4 DF-027 tests exercising `resolveConfiguredModelRole` against a real `ModelRouter`.
- `packages/model-provider/src/__tests__/streaming-contract.test.ts` — DF-027 router-streaming section (3 tests): capability preserved through routed providers, generate() fallback only when non-streaming, no fabricated streaming from generate-only providers.
- `apps/cli/src/commands/config.ts` — `handleConfig` now resolves and renders the effective role→provider mapping (`ResolvedRoutePayload`, `routes` in `--json`, `Resolved model routes` block in human output), secrets still masked.
- `apps/cli/src/services/environment.ts` — `runEnvironmentChecks` adds a `model-routes` health check that builds the router deterministically and reports `role → provider` resolution.
- `apps/cli/src/commands/explain.ts` — removed unused `FakeModelProvider`, `ModelProvider`, and `DevForgeBrain` imports (Phase 13 ban compliance).
- `apps/cli/__tests__/integration.test.ts` — DF-027 role-routing suite (5 tests: router role list/distinct providers, executor coding→CODING + reasoning→REASONING routing, planner reasoning routing, brain reasoning routing, no-fake-degradation) plus updated config/doctor tests asserting routes rendering and the `model-routes` check. `ConfigPayload` imported for typing.

## 4. Role interface (Phase 2)

The router API is `ModelRouter.has(role)` / `select(role)` / `resolve(role)` / `configFor(role)` / `redactedConfigFor(role)` / `list()` from `@devforge/model-provider` (`router.ts`). `createModelRouter` is the construction facade; `createModelRouterFromConfig` in `packages/core/src/router.ts` is the app-level assembly boundary. CLI services use a structural `RouterLike { has; select }` so consumer code composes against the contract, never an adapter.

## 5. Brain role routing (Phase 3)

`DevForgeBrain` accepts `provider` XOR `router` (throws on both). When only a router is given, the generation provider resolves via the configured `role` (`'reasoning'` default, `'fast'` for lightweight brains). If the requested role is unconfigured but `fast` is and the request was `reasoning`, the fast role serves the brain — a **selection** fallback within the role contract, never a provider failover and never a silent swap to `FakeModelProvider`. Both absent → `undefined` → classified-only result. Tests in `brain-role-routing.test.ts` + `brain-router.test.ts` cover all paths; explicit fake-provider injection still works (backward compatibility).

## 6. Planner role routing (Phase 4)

`Planner` already exposed `role` (`'reasoning'` default) on both `PlannerConfig` and `PlanOptions`, with a deterministic model-free fallback. DF-027 verified the canonical consumer pattern — `generate` bound to `router.select(role)` at wiring time — and added router-wiring tests proving reasoning/coding/fast selection and the deterministic fallback. No provider `if/else` exists in the planner. Provider error propagation (AUTHENTICATION_ERROR, RATE_LIMITED, generic) is preserved and tested.

## 7. Autonomous role mapping (Phase 5)

`@devforge/autonomous` has no direct `@devforge/model-provider` dependency and never names adapters. It consumes injected `ReasoningModel`, `CodingModel`, `PatchEngine`, `Planner` primitives from `@devforge/execution`/`@devforge/planner`. The role mapping (repair diagnosis → REASONING, patch generation → CODING, planning → REASONING, decisions → FAST-capable) lives at the CLI wiring layer (`createExecutorService`: `source.select('coding')` → `ProviderCodingModel`, `source.select('reasoning')` → `ProviderReasoningModel`). Integration tests assert the coding model receives the CODING-role provider and the reasoning model the REASONING-role provider (distinct instances). Repair architecture is preserved intact: confidence gates, duplicate detection, rollback, verification, cancellation, and termination ordering all remain unchanged with existing unit coverage (244 tests).

## 8. Multi-agent role agents (Phase 6)

`packages/multi-agent` keeps `ROLE_MODEL_MAP` (PLANNER→reasoning, CODER→coding, REVIEWER→reasoning[fast], REPAIR→coding, TESTER→fast[reasoning], DOCUMENTATION→fast[reasoning]) and role agents stay backend-injectable and deterministic by default. Added `resolveConfiguredModelRole(role, router)` — the single best model role for an agent given a contracted `ModelRouterLike` (`has`/`select`) — so swarm wiring gains one deterministic helper and never constructs providers. Tests run against a real `ModelRouter` for preferred/fallback/undefined resolution.

## 9. Streaming consumers (Phase 7)

Streaming (`StreamingModelProvider`, `ModelStream`, `isStreamingModelProvider`, DF-026D) remains additive and optional. DF-027 adds router-flow tests proving stream capability propagates through routed providers unchanged, consumers fall back to `generate()` only when the routed provider is non-streaming, and no provider ever fabricates a stream it cannot produce. No consumer silently swaps a real provider for `FakeModelProvider` under any stream/failure path.

## 10. Dependency rules and provider boundary (Phases 9, 10, 13)

- `extensions/vscode`: verified zero model-provider imports (chat provider is webview/client based) — no changes required, documented as future work.
- `apps/cli/src/commands/explain.ts`: removed stale `FakeModelProvider`/`ModelProvider`/`DevForgeBrain` imports — the one concrete-provider import found in production consumer code.
- `packages/integration-tests/src/provider-boundary.test.ts` scans 8 consumer trees and bans `OpenAICompatibleProvider`, `GeminiProvider`, `AnthropicProvider`, `FakeModelProvider`, `createModelProvider`, `createModelProviderFromConfig` imports from any module except `@devforge/model-provider`. Green.

## 11. Failure semantics (Phase 11)

No automatic provider failover exists anywhere in the codebase (grepped: no failover/retry-with-another-provider logic). `AUTHENTICATION_ERROR`, `RATE_LIMITED`, `TIMEOUT`, `NETWORK_ERROR`, `PROVIDER_ERROR`, `CANCELLED`, etc. remain real failures with their retryable flags preserved end-to-end (Planner `MODEL_ERROR` mapping, Execution `CodingModelError`/`ReasoningError` translation, Brain `provider_error`, error envelope matrix in hardening tests). Routing resolves a role deterministically; a real provider config disables the fake fallback so unconfigured roles fail loudly rather than degrade to fake.

## 12. Deterministic tests (Phase 12)

No network and no real LLM anywhere: fake/scripted providers, real `ModelRouter` over fake configs, and injected primitives drive every assertion. Added + verified per package:

- model-provider: 436 tests (including new router-streaming + router `fakeResponse` passthrough)
- brain: 131 (incl. 5 new role-routing)
- planner: 61 (incl. 4 new router-wiring)
- autonomous: 244 (existing repair/cancel/rollback suite untouched)
- multi-agent: 314 (incl. 4 new `resolveConfiguredModelRole`)
- cli: 78 (incl. 5 new role-routing wiring + updated config/doctor)
- integration-tests: 50 (incl. 5 existing hardening + 1 new provider-boundary guard)

## 13. Package verification

Green for every touched package: `@devforge/model-provider`, `@devforge/brain`, `@devforge/planner`, `@devforge/autonomous`, `@devforge/multi-agent`, `@devforge/cli`, `@devforge/integration-tests` (`test`, `check-types`).

## 14. Root verification

`pnpm check-types` → 26/26 tasks; `pnpm build` → 26/26; `pnpm test` (forced) → 46/46; `pnpm lint` → 3/3. Lint is only configured for `@repo/ui`, `web`, `@devforge/api` (no-op); none of the DF-027-touched packages are in lint scope.

## 15. Backward compatibility status

- Brain: `provider` injection unchanged; `router`-only path now honors `role` with reasoning→fast selection fallback (strict superset of prior behavior).
- Planner: `PlannerConfig`/`PlanOptions` unchanged; role default remains `'reasoning'`.
- Router: `fakeResponse` now flows through `normalizeComplete` (observable only for fake role configs; all real-provider configs unchanged). 433→436 model-provider tests green.
- Multi-agent: additive `resolveConfiguredModelRole`; existing exports unchanged.
- CLI: `config`/`doctor` gain role-route output; payload adds `routes` field; existing fields unchanged.
- Execution/Autonomous/VS Code: zero behavioral changes.

## 16. Known limitations

- VS Code extension does not yet surface role-routed model selection in its UI (webview/client architecture); role wiring for the extension is future work, tracked in this report rather than implemented.
- The CLI `config --json routes` resolves providers via router factory; a malformed model config yields an empty `routes` array rather than an error (config display must never crash).
- The provider-boundary guard is a filesystem scan; it cannot prove semantics (e.g., dynamic `import('<adapter path>')`). It complements, not replaces, design review.
- Lint is not configured for the touched packages (repo-wide lint coverage still limited to 3 packages).

## 17. Remaining scope after DF-027

- DF-028 and later phases: dashboard/cloud/sessions/RAG/embeddings/vector-DB/fine-tuning/networking/deployment, and any redesign of `ModelProvider`/`ModelRouter`.
- VS Code UI surfacing of per-role model selection.
- Expanding repo-wide lint/`typecheck` coverage to all packages if desired.