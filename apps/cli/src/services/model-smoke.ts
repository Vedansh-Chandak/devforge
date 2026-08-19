/**
 * @devforge/cli — Model smoke checks (DF-028 Phase 2).
 *
 * An OPT-IN connectivity check that runs a tiny generation against every
 * configured model route and verifies a normalized {@link ModelResponse}
 * (content, usage), structured output, and streaming where the provider
 * advertises it.
 *
 * Safety properties:
 *  - Never runs by default: it must be requested explicitly (`doctor --models`).
 *  - Never auto-runs in CI; the default `doctor`/build/test path is offline.
 *  - Uses the existing resolved router/configuration; never hard-codes keys.
 *  - Bounded per-request timeout and zero retries; credentials never appear in
 *    the returned detail strings (transport + config redaction).
 */

import type { DevForgeConfig } from '../types.js';
import { createRouterFromConfig } from './brain.js';
import type { HealthCheck } from './environment.js';
import { redactSecrets } from '@devforge/config';
import {
  isStreamingModelProvider,
  collectStream,
  type ModelProvider,
  type ModelRequest,
} from '@devforge/model-provider';

/** Per-request budget for the smoke probe (ms). Bounded by design (DF-028). */
export const MODEL_SMOKE_TIMEOUT_MS = 30_000;

/** A smoke check scoped to one model role. */
export interface ModelSmokeCheck extends HealthCheck {
  readonly role: string;
  readonly provider: string;
}

/** Options for the model smoke run. */
export interface ModelSmokeOptions {
  /** External cancellation signal (SIGINT). */
  readonly signal?: AbortSignal;
  /** Override the resolved router (tests inject a deterministic one). */
  readonly router?: ReturnType<typeof createRouterFromConfig>;
  /** Override the per-request timeout in ms (tests/fast runs). */
  readonly timeoutMs?: number;
}

/**
 * Run the model smoke against every resolved role.
 * Returns one {@link ModelSmokeCheck} per role (deterministic role order from
 * the router). Roles that cannot resolve surface as a failed check with a
 * redacted detail.
 */
export async function runModelSmoke(
  config: DevForgeConfig,
  options: ModelSmokeOptions = {},
): Promise<readonly ModelSmokeCheck[]> {
  const router = options.router ?? createRouterFromConfig(config);
  const timeoutMs = options.timeoutMs ?? MODEL_SMOKE_TIMEOUT_MS;
  const roles = router.list();

  const checks: ModelSmokeCheck[] = [];
  for (const role of roles) {
    let provider: ModelProvider;
    try {
      provider = router.select(role);
    } catch (error) {
      checks.push({
        name: `model:${role}`,
        role,
        provider: 'unresolved',
        ok: false,
        detail: redactSecrets(error instanceof Error ? error.message : String(error)),
        fix: 'Check role model/provider configuration (config or DEVFORGE_*_MODEL env)',
      });
      continue;
    }

    const generateDetail = await probeGenerate(provider, { timeoutMs, signal: options.signal });
    const streamCheck = await probeStream(provider, { timeoutMs, signal: options.signal });
    const structuredCheck = await probeStructured(provider, { timeoutMs, signal: options.signal });

    const ok = generateDetail.ok;
    const parts = [generateDetail.body];
    if (streamCheck.state !== 'skipped') parts.push(`stream: ${streamCheck.body}`);
    if (structuredCheck.state !== 'skipped') parts.push(`structured: ${structuredCheck.body}`);
    const detail = parts.join('; ');

    checks.push({
      name: `model:${role}`,
      role,
      provider: provider.id,
      ok,
      detail,
      fix: ok ? undefined : 'Verify credentials/baseUrl and provider availability, then retry',
    });
  }

  return checks;
}

interface ProbeResult {
  readonly ok: boolean;
  readonly body: string;
}

/** Minimal prompt with a deterministic expected shape. */
function probeRequest(status: 'generate' | 'stream' | 'structured'): ModelRequest {
  const base: ModelRequest = {
    messages: [{ role: 'user', content: 'Reply with the single token: ready' }],
    temperature: 0,
    maxTokens: 16,
    maxRetries: 0,
  };
  if (status === 'structured') {
    base.responseFormat = {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: { ready: { type: 'boolean' } },
        required: ['ready'],
      },
    };
  }
  return base;
}

/** Normalized response probe: content present + usage shape. */
async function probeGenerate(
  provider: ModelProvider,
  opts: { timeoutMs: number; signal?: AbortSignal },
): Promise<ProbeResult> {
  try {
    const response = await provider.generate({
      ...probeRequest('generate'),
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
    });
    const hasContent = typeof response.content === 'string' && response.content.trim().length > 0;
    const usage =
      response.usage == null
        ? 'usage: n/a'
        : `usage: in=${response.usage.inputTokens ?? '?'}/out=${response.usage.outputTokens ?? '?'}`;
    const model = response.model ? `model: ${response.model}` : 'model: n/a';
    return {
      ok: hasContent,
      body: `${model}; ${usage}; tokens=${response.content.length}`,
    };
  } catch (error) {
    return {
      ok: false,
      body: `generate failed: ${redactSecrets(error instanceof Error ? error.message : String(error))}`,
    };
  }
}

/** Streaming probe: only when the provider structurally supports streaming. */
async function probeStream(
  provider: ModelProvider,
  opts: { timeoutMs: number; signal?: AbortSignal },
): Promise<{ state: 'skipped' | 'ok' | 'failed'; body: string }> {
  if (!isStreamingModelProvider(provider)) {
    return { state: 'skipped', body: 'n/a' };
  }
  try {
    const events = await collectStream(
      provider.stream({ ...probeRequest('stream'), timeoutMs: opts.timeoutMs, signal: opts.signal }),
    );
    const chunks = events.filter((e) => e.type === 'text_delta').length;
    const completed = events.some((e) => e.type === 'completed');
    return {
      state: completed || chunks > 0 ? 'ok' : 'failed',
      body: `events=${events.length} (${chunks} chunks${completed ? ', completed' : ''})`,
    };
  } catch (error) {
    return {
      state: 'failed',
      body: `stream failed: ${redactSecrets(error instanceof Error ? error.message : String(error))}`,
    };
  }
}

/** Structured-output probe: best-effort; unsupported → skipped, errors → failed. */
async function probeStructured(
  provider: ModelProvider,
  opts: { timeoutMs: number; signal?: AbortSignal },
): Promise<{ state: 'skipped' | 'ok' | 'failed'; body: string }> {
  try {
    const response = await provider.generate({
      ...probeRequest('structured'),
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
    });
    const parsed = JSON.parse(response.content);
    if (typeof parsed.ready !== 'boolean') {
      return { state: 'failed', body: 'response did not match schema' };
    }
    return { state: 'ok', body: `valid (ready=${parsed.ready})` };
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error));
    // Providers that reject the responseFormat hint are "not supported", not bad.
    if (/unsupported|not supported|response_format|schema|400/i.test(message)) {
      return { state: 'skipped', body: 'not advertised' };
    }
    return { state: 'failed', body: message };
  }
}