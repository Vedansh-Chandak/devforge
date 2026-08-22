# DF-026A Stop-Condition Report

Production-grade, provider-agnostic core for `@devforge/model-provider`.
Additive — every existing public export and behaviour is preserved; no new
concrete provider adapters were added and no network code was introduced.

## Objective

Build the normalized core layer of the model-provider package so any future
adapter (DF-026B) can be implemented against shared primitives: role-based
model selection, retry, timeout + cancellation, config validation, secret
redaction, and structured-output validation. All with deterministic,
provider-agnostic tests.

## Files changed / added

Modified (additive):
- `packages/model-provider/src/types.ts` — `ModelSelectionRole`,
  `ModelCapabilities`, `ModelProviderInfo`; optional `ModelRequest` fields
  (`timeoutMs`, `maxRetries`, `responseFormat`, `metadata`); optional
  `ModelResponse.id`. All existing fields unchanged.
- `packages/model-provider/src/index.ts` — exports the new modules/types.
- `packages/model-provider/src/__tests__/provider.test.ts` — added concurrent
  request + extended-request-field tests.
- `packages/model-provider/package.json` — new runtime dep
  `@devforge/errors` (workspace, for `redactSecretText` reuse).
- `pnpm-lock.yaml` — dependency graph update.

Added:
- `packages/model-provider/src/selection.ts` — `selectModel` /
  `selectModelName` / `resolveRoleModel`, `ModelSelection`, `RoleModelMap`.
- `packages/model-provider/src/retry.ts` — `retry`, `shouldRetry`,
  `isRetryableCode`, `DEFAULT_RETRYABLE_CODES`, `normalizePolicy`,
  `computeBackoff`, `defaultSleep`; injected `sleep`/`random` for determinism.
- `packages/model-provider/src/timeout.ts` — `withTimeout` with internal
  deadline vs external-abort distinction.
- `packages/model-provider/src/redact.ts` — reuses `@devforge/errors`
  `redactSecretText` (single source of truth) + `redactSecrets` for explicit
  secret values.
- `packages/model-provider/src/validate.ts` — `validateProviderConfig`,
  `assertValidProviderConfig`, `isHttpUrl`.
- `packages/model-provider/src/structured.ts` — compact JSON-schema subset,
  `validateStructuredOutput`, `assertStructuredOutput`, `parseJsonContent`,
  `stripCodeFence`.
- Tests: `src/__tests__/{selection,retry,timeout,redact,validate,structured}.test.ts`.

## Architecture decisions

- **Provider-agnostic primitives**: none of the new modules references a
  concrete vendor. `OpenAICompatibleProvider` and `FakeModelProvider` are
  unchanged and still pass their suites; adapters will be rewired onto these
  primitives in DF-026B.
- **Redaction reuse**: `redactSecretText` is imported from `@devforge/errors`
  rather than duplicated, per the existing-solutions preflight rule.
- **Retry contract** (matches DF-025): only `retryable` model errors with a
  code in the retryable set are retried; `CANCELLED` is never retried; an
  unknown thrown value is never retried; exhaustion re-throws the last error
  unchanged (preserving its `retryable` flag); external abort during a backoff
  → `CANCELLED`.
- **Timeout vs cancellation**: `withTimeout` rejects `TIMEOUT` (retryable)
  when the internal deadline fires first and `CANCELLED` (non-retryable) when
  the external signal fires first; the losing outcome is suppressed.
- **Determinism**: `sleep` and `random` are injectable in `retry`; validation
  and structured-output validation are pure functions; model selection sorts
  by priority then stable declaration order.
- **Public API**: strictly additive. Existing consumers (brain, planner,
  execution, prompt-composer, core, cli, integration-tests) typecheck against
  the rebuilt dist unchanged.

## Test coverage

Package: **188 tests, 188 passing** across 8 suites (was 76 → +112 new).

- `selection.test.ts` (15) — role selection, multi-role models, priority,
  stable tie-break, determinism, fallbacks, empty inputs.
- `retry.test.ts` (28) — success path, retry + recovery, exhaustion,
  non-retryable / CANCELLED / plain-error exclusion, `retryableCodes` override,
  `maxRetries: 0`, exponential backoff + cap, `onRetry` reporting, abort
  during backoff, pre-aborted signal, determinism, `defaultSleep`,
  `shouldRetry` / `isRetryableCode` / `normalizePolicy` / `computeBackoff`.
- `timeout.test.ts` (13) — success before deadline, TIMEOUT on deadline,
  message contents, work-rejection propagation, external abort → CANCELLED,
  pre-aborted signal, TIMEOUT vs CANCELLED race ordering, disabled deadline
  (`<=0`), signal handed to work, work-signal aborted on timeout,
  post-completion abort is inert.
- `redact.test.ts` (11) — bearer tokens, API-key headers, env interpolations,
  URL credentials, private keys, benign-text passthrough, explicit value
  redaction, min-length guard, determinism.
- `validate.test.ts` (22) — valid configs, required model, bad types,
  http(s) baseUrl rules, timeoutMs / maxRetries bounds, apiKey, headers,
  multi-issue aggregation, throwing wrapper, `isHttpUrl`.
- `structured.test.ts` (19) — code-fence stripping, JSON parsing, valid /
  invalid / missing-required / type-mismatch / nested-object / array-item /
  integer-vs-number / union / extra-property cases, deterministic results,
  throwing wrapper.
- `provider.test.ts` (30) — existing contract preserved + concurrent requests
  (correct results, history recording) + extended request fields incl.
  structured-output schema.
- `openai-compatible.test.ts` (50) — unchanged, all green.

## Security decisions

- API keys and structured secrets are never serialized into diagnostics;
  `redactSecrets` / `redactSecretText` cover structural redaction and explicit
  secret-value replacement.
- Config validation never logs or echoes the `apiKey` value.
- New `metadata` on `ModelRequest` is documented as safe/non-secret only.

## Verification (2026-08-17)

- `pnpm --filter @devforge/model-provider check-types` — clean
- `pnpm --filter @devforge/model-provider build` — clean
- `pnpm --filter @devforge/model-provider test` — 188/188
- Root `pnpm check-types` — 26/26 successful
- Root `pnpm build` — 26/26 successful
- Root `pnpm test` — 46/46 tasks successful

## Remaining for DF-026B

- Rewire `OpenAICompatibleProvider` onto `withTimeout` / `retry` /
  `validateProviderConfig` / `redactSecrets`.
- Add provider adapters for concrete vendors using the new primitives.
- Wire `responseFormat` into the OpenAI-compatible request body.
- Surface `ModelCapabilities` / `ModelProviderInfo` from providers.
