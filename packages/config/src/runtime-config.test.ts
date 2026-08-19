import { describe, it, expect } from "vitest";
import {
  resolveRuntimeConfig,
  validateRuntimeConfig,
  redactRuntimeConfig,
  redactSecrets,
  readFromEnv,
  DEFAULT_RUNTIME_CONFIG,
} from "./runtime-config.js";

const PROJECT_FILE = {
  provider: "openai-compatible",
  model: "gpt-4o",
  baseUrl: "https://api.example.com/v1",
  logLevel: "debug",
} as const;

const USER_FILE = {
  provider: "fake",
  logLevel: "warn",
  temperature: 0.4,
} as const;

describe("resolveRuntimeConfig", () => {
  it("does not throw on missing env and yields defaults", () => {
    const result = resolveRuntimeConfig({ explicit: null, env: {} });
    expect(result.config.provider).toBe(DEFAULT_RUNTIME_CONFIG.provider);
    expect(result.config.logLevel).toBe(DEFAULT_RUNTIME_CONFIG.logLevel);
    expect(result.sources.length).toBeGreaterThan(0);
  });

  it("applies precedence explicit > file > env > default", () => {
    const result = resolveRuntimeConfig({
      explicit: { provider: "openai-compatible", model: "explicit-model" },
      env: {
        DEVFORGE_MODEL: "env-model",
        DEVFORGE_PROVIDER: "fake",
        DEVFORGE_BASE_URL: "https://env.example.com/v1",
      },
      files: [USER_FILE, PROJECT_FILE],
    });

    expect(result.config.provider).toBe("openai-compatible");
    expect(result.config.model).toBe("explicit-model");
    expect(result.config.baseUrl).toBe("https://env.example.com/v1");
    expect(result.config.logLevel).toBe("debug");
  });

  it("lets later files override earlier files", () => {
    const result = resolveRuntimeConfig({
      explicit: null,
      env: {},
      files: [USER_FILE, PROJECT_FILE],
    });
    expect(result.config.logLevel).toBe("debug");
    expect(result.config.provider).toBe("openai-compatible");
  });

  it("env overrides file values when explicit is absent", () => {
    const result = resolveRuntimeConfig({
      explicit: null,
      env: { DEVFORGE_MODEL: "env-model", DEVFORGE_LOG_LEVEL: "error" },
      files: [PROJECT_FILE],
    });
    expect(result.config.model).toBe("env-model");
    expect(result.config.logLevel).toBe("error");
  });

  it("tracks the winning source per key", () => {
    const result = resolveRuntimeConfig({
      explicit: { model: "m" },
      env: { DEVFORGE_PROVIDER: "fake" },
      files: [PROJECT_FILE],
    });
    expect(result.sources).toContainEqual({ key: "model", source: "explicit" });
    expect(result.sources).toContainEqual({ key: "provider", source: "env" });
    expect(result.sources).toContainEqual({ key: "baseUrl", source: "file" });
    expect(result.sources).toContainEqual({ key: "logLevel", source: "default" });
  });

  it("parses numeric env values", () => {
    const result = resolveRuntimeConfig({
      explicit: null,
      env: {
        DEVFORGE_TIMEOUT_MS: "30000",
        DEVFORGE_TEMPERATURE: "0.7",
        DEVFORGE_MAX_REPAIR_ATTEMPTS: "2",
      },
      files: [],
    });
    expect(result.config.timeoutMs).toBe(30000);
    expect(result.config.temperature).toBe(0.7);
    expect(result.config.maxRepairAttempts).toBe(2);
  });

  it("skips malformed numeric env values without throwing", () => {
    const result = resolveRuntimeConfig({
      explicit: null,
      env: { DEVFORGE_TIMEOUT_MS: "not-a-number" },
      files: [],
    });
    expect(result.config.timeoutMs).toBeUndefined();
  });

  it("ignores null file entries", () => {
    const result = resolveRuntimeConfig({
      explicit: null,
      env: {},
      files: [null, PROJECT_FILE, undefined],
    });
    expect(result.config.provider).toBe("openai-compatible");
  });
});

describe("readFromEnv", () => {
  it("maps DEVFORGE_* variables to config keys", () => {
    const raw = readFromEnv({
      DEVFORGE_MODEL: "gpt-4o",
      DEVFORGE_API_KEY: "sk-test",
      DEVFORGE_TEMPERATURE: "0.5",
    });
    expect(raw.model).toBe("gpt-4o");
    expect(raw.apiKey).toBe("sk-test");
    expect(raw.temperature).toBe(0.5);
  });

  it("is empty for an empty env", () => {
    expect(readFromEnv({})).toEqual({});
  });
});

describe("validateRuntimeConfig", () => {
  it("accepts a valid openai-compatible config", () => {
    const { ok, errors } = validateRuntimeConfig({
      provider: "openai-compatible",
      model: "gpt-4o",
      baseUrl: "https://api.example.com/v1",
      logLevel: "info",
    });
    expect(ok).toBe(true);
    expect(errors).toEqual([]);
  });

  it("rejects an unknown provider", () => {
    const { ok, errors } = validateRuntimeConfig({
      provider: "claude" as never,
      logLevel: "info",
    });
    expect(ok).toBe(false);
    expect(errors.join(" ")).toContain("provider");
  });

  it("rejects an out-of-range temperature", () => {
    const { ok } = validateRuntimeConfig({ provider: "fake", logLevel: "info", temperature: 3 });
    expect(ok).toBe(false);
  });

  it("requires model and baseUrl for openai-compatible", () => {
    const { ok, errors } = validateRuntimeConfig({ provider: "openai-compatible", logLevel: "info" });
    expect(ok).toBe(false);
    expect(errors.join(" ")).toContain("model");
    expect(errors.join(" ")).toContain("baseUrl");
  });
});

describe("redactRuntimeConfig", () => {
  it("masks apiKey but leaves other values intact", () => {
    const redacted = redactRuntimeConfig({
      provider: "openai-compatible",
      model: "gpt-4o",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-secret-value",
      logLevel: "info",
    });
    expect(redacted.apiKey).toBe("***");
    expect(redacted.model).toBe("gpt-4o");
    expect(redacted.baseUrl).toBe("https://api.example.com/v1");
  });

  it("leaves an absent apiKey undefined", () => {
    const redacted = redactRuntimeConfig({ provider: "fake", logLevel: "info" });
    expect(redacted.apiKey).toBeUndefined();
  });
});

describe("redactSecrets", () => {
  it("masks sk-* key material and bearer headers", () => {
    const text = 'auth: sk-abcDEF123456, bearer eyJhbGciOiJIUzI1NiJ9.test, keep-this';
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain("sk-abcDEF123456");
    expect(redacted).not.toContain("eyJhbGciOiJIUzI1NiJ9.test");
    expect(redacted).toContain("keep-this");
  });

  it("masks Anthropic, Gemini, Groq and xAI key shapes", () => {
    const text = [
      "sk-ant-api03-abcdef123456789012345678901234567890",
      "AIzaSyD1234567890abcdefghijklmnopqrstuvwxyz123456789",
      "gsk_AbCdEfGh12345678",
      "xai-abcdef1234567890abcdef",
      "keep-me-plain",
    ].join(" ");
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain("sk-ant-api03");
    expect(redacted).not.toContain("AIzaSyD");
    expect(redacted).not.toContain("gsk_AbCdEfGh");
    expect(redacted).not.toContain("xai-abcdef");
    expect(redacted).toContain("keep-me-plain");
  });

  it("masks api key assignments", () => {
    const text = 'headers={"apiKey":"secretvalue123456","x-foo":1}';
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain("secretvalue123456");
  });
});
