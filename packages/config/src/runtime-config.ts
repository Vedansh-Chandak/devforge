/**
 * @devforge/config — shared runtime configuration layer (DF-025).
 *
 * Resolves configuration with a deterministic precedence:
 *   explicit > file (later wins) > env (DEVFORGE_*) > defaults
 *
 * Never throws during resolution: invalid env values are skipped, and the
 * result always exposes a fully populated config plus per-key source tracking.
 */

export type ProviderKind = "fake" | "openai-compatible";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export interface RuntimeConfig {
  provider: ProviderKind;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  temperature?: number;
  maxRepairAttempts?: number;
  workspace?: string;
  logLevel: LogLevel;
}

export type ConfigSourceKind = "default" | "env" | "file" | "explicit";

/** The winning source for a single config key. */
export interface ConfigSourceEntry {
  readonly key: keyof RuntimeConfig;
  readonly source: ConfigSourceKind;
}

export interface ResolvedRuntimeConfig {
  readonly config: RuntimeConfig;
  /** One entry per key, in resolution order (last wins). */
  readonly sources: readonly ConfigSourceEntry[];
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  provider: "fake",
  logLevel: "info",
};

/** Keys whose values must never be logged or printed. */
export const SECRET_KEYS = ["apiKey"] as const;

const PROVIDER_KINDS: readonly ProviderKind[] = ["fake", "openai-compatible"];
const LOG_LEVELS: readonly LogLevel[] = ["trace", "debug", "info", "warn", "error"];

/** Environment variable names mapped onto the config shape. */
const ENV_MAP: Record<string, keyof RuntimeConfig> = {
  DEVFORGE_PROVIDER: "provider",
  DEVFORGE_MODEL: "model",
  DEVFORGE_BASE_URL: "baseUrl",
  DEVFORGE_API_KEY: "apiKey",
  DEVFORGE_TIMEOUT_MS: "timeoutMs",
  DEVFORGE_TEMPERATURE: "temperature",
  DEVFORGE_MAX_REPAIR_ATTEMPTS: "maxRepairAttempts",
  DEVFORGE_WORKSPACE: "workspace",
  DEVFORGE_LOG_LEVEL: "logLevel",
};

/** Numeric config keys parsed from env strings. */
const NUMERIC_KEYS: ReadonlySet<keyof RuntimeConfig> = new Set([
  "timeoutMs",
  "temperature",
  "maxRepairAttempts",
]);

/**
 * Read config from a DEVFORGE_* environment, skipping unparseable values.
 * Never throws, even when values are malformed or the env is missing.
 */
export function readFromEnv(env: NodeJS.ProcessEnv = process.env): Partial<RuntimeConfig> {
  const raw: Record<string, unknown> = {};
  for (const [envName, key] of Object.entries(ENV_MAP)) {
    const value = env[envName];
    if (value === undefined) continue;
    if (NUMERIC_KEYS.has(key)) {
      const num = Number(value);
      if (!Number.isNaN(num)) raw[key] = num;
    } else {
      raw[key] = value;
    }
  }
  return raw as Partial<RuntimeConfig>;
}

/**
 * Resolve a full runtime config from layered inputs.
 *
 * @param options.files  Config-file objects, highest precedence last.
 * @param options.env    DEVFORGE_* environment (defaults to `process.env`).
 * @param options.explicit Programmatic overrides with the highest precedence.
 */
export function resolveRuntimeConfig(options: {
  explicit?: Partial<RuntimeConfig> | null;
  env?: NodeJS.ProcessEnv;
  files?: readonly (Partial<RuntimeConfig> | null | undefined)[];
}): ResolvedRuntimeConfig {
  const { explicit, env } = options;
  const files = options.files ?? [];

  const layers: ReadonlyArray<{ source: ConfigSourceKind; values: Partial<RuntimeConfig> }> = [
    { source: "default", values: { ...DEFAULT_RUNTIME_CONFIG } },
    ...files
      .filter((file): file is Partial<RuntimeConfig> => file !== null && file !== undefined)
      .map((file) => ({ source: "file" as const, values: file })),
    { source: "env", values: readFromEnv(env) },
    ...(explicit ? [{ source: "explicit" as const, values: explicit }] : []),
  ];

  const config: Record<string, unknown> = {};
  const sources: ConfigSourceEntry[] = [];
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer.values)) {
      if (value === undefined) continue;
      config[key] = value;
      sources.push({ key: key as keyof RuntimeConfig, source: layer.source });
    }
  }

  return {
    config: config as unknown as RuntimeConfig,
    sources,
  };
}

/** Collect validation errors without throwing. */
export interface ConfigValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export function validateRuntimeConfig(config: RuntimeConfig): ConfigValidationResult {
  const errors: string[] = [];

  if (!PROVIDER_KINDS.includes(config.provider)) {
    errors.push(`Invalid provider "${config.provider}": expected one of ${PROVIDER_KINDS.join(", ")}`);
  }

  if (config.provider === "openai-compatible") {
    if (!config.model || config.model.trim().length === 0) {
      errors.push('provider "openai-compatible" requires a "model"');
    }
    if (!config.baseUrl || config.baseUrl.trim().length === 0) {
      errors.push('provider "openai-compatible" requires a "baseUrl"');
    }
  }

  if (config.temperature !== undefined && (typeof config.temperature !== "number" || config.temperature < 0 || config.temperature > 2)) {
    errors.push("temperature must be between 0 and 2");
  }

  if (config.maxRepairAttempts !== undefined && (typeof config.maxRepairAttempts !== "number" || !Number.isInteger(config.maxRepairAttempts) || config.maxRepairAttempts < 0)) {
    errors.push("maxRepairAttempts must be an integer of 0 or greater");
  }

  if (config.timeoutMs !== undefined && (typeof config.timeoutMs !== "number" || config.timeoutMs < 0)) {
    errors.push("timeoutMs must be a non-negative number");
  }

  if (!LOG_LEVELS.includes(config.logLevel)) {
    errors.push(`Invalid logLevel "${config.logLevel}": expected one of ${LOG_LEVELS.join(", ")}`);
  }

  return { ok: errors.length === 0, errors };
}

/** Returns a config copy with secret values masked (`***`). */
export function redactRuntimeConfig(config: RuntimeConfig): RuntimeConfig {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    const secret = SECRET_KEYS as readonly string[];
    out[key] = secret.includes(key) && value !== undefined && value !== "" ? "***" : value;
  }
  return out as unknown as RuntimeConfig;
}

/** Masks common credential patterns inside arbitrary text. */
export function redactSecrets(text: string): string {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "***")
    .replace(/\bauthorization:\s*[^\s]+/gi, "authorization: ***")
    .replace(/\bbearer\s+[A-Za-z0-9._~+/-]+=*/gi, "bearer ***");
}
