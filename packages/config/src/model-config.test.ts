import { describe, it, expect } from "vitest";
import {
  parseModelConfigEnv,
  ModelRouter,
  redactModelConfig,
  isModelProviderKind,
  resolveRoleConfig,
} from "./model-config.js";
import {
  readFromEnv,
  validateRuntimeConfig,
  resolveRuntimeConfig,
} from "./runtime-config.js";
import { FakeModelProvider } from "@devforge/model-provider";

describe("model-config re-exports", () => {
  it("exposes the normalized env parser on the config surface", () => {
    const parsed = parseModelConfigEnv({
      DEVFORGE_MODEL_PROVIDER: "openai-compatible",
      DEVFORGE_MODEL: "openai/gpt-oss-120b:free",
      DEVFORGE_REASONING_MODEL: "openai/gpt-oss-120b:free",
      DEVFORGE_CODING_MODEL: "cohere/north-mini-code:free",
      DEVFORGE_FAST_MODEL: "openai/gpt-oss-20b:free",
    });
    expect(parsed.default.model).toBe("openai/gpt-oss-120b:free");
    expect(parsed.roles.coding?.model).toBe("cohere/north-mini-code:free");
  });

  it("exposes the deterministic ModelRouter on the config surface", () => {
    const router = new ModelRouter({
      defaultConfig: { provider: "fake" },
    });
    expect(router.select("reasoning")).toBeInstanceOf(FakeModelProvider);
  });

  it("exposes redaction that never leaks a key", () => {
    const redacted = redactModelConfig({
      provider: "openai-compatible",
      model: "m",
      apiKey: "sk-super-secret",
    });
    expect(redacted.apiKey).toBe("***");
    expect(JSON.stringify(redacted)).not.toContain("sk-super-secret");
  });

  it("exposes helper guards", () => {
    expect(isModelProviderKind("gemini")).toBe(true);
    expect(isModelProviderKind("ollama")).toBe(false);
  });

  it("exposes role resolution merging", () => {
    const merged = resolveRoleConfig(
      {
        defaultConfig: { provider: "openai-compatible", model: "m" },
        roleConfigs: { fast: { model: "fast-m" } },
      },
      "fast",
    );
    expect(merged?.model).toBe("fast-m");
  });
});

describe("runtime-config provider extensions", () => {
  it("accepts gemini and anthropic providers", () => {
    expect(validateRuntimeConfig({ provider: "gemini", model: "gemini-2.5-flash", logLevel: "info" }).ok).toBe(true);
    expect(validateRuntimeConfig({ provider: "anthropic", model: "claude-sonnet-4-20250514", logLevel: "info" }).ok).toBe(true);
  });

  it("gemini/anthropic require a model", () => {
    const result = validateRuntimeConfig({ provider: "gemini", logLevel: "info" });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("model");
  });

  it("reads role-specific model env vars into roleModels", () => {
    const raw = readFromEnv({
      DEVFORGE_REASONING_MODEL: "openai/gpt-oss-120b:free",
      DEVFORGE_CODING_MODEL: "cohere/north-mini-code:free",
      DEVFORGE_FAST_MODEL: "openai/gpt-oss-20b:free",
    });
    expect(raw.roleModels).toEqual({
      reasoning: "openai/gpt-oss-120b:free",
      coding: "cohere/north-mini-code:free",
      fast: "openai/gpt-oss-20b:free",
    });
  });

  it("skips empty role model values", () => {
    const raw = readFromEnv({ DEVFORGE_FAST_MODEL: "" });
    expect(raw.roleModels).toBeUndefined();
  });

  it("validates roleModels unknown roles", () => {
    const result = validateRuntimeConfig({
      provider: "fake",
      logLevel: "info",
      roleModels: { reasoning: "m", wizard: "x" } as never,
    });
    expect(result.ok).toBe(false);
  });

  it("accepts valid roleModels", () => {
    const result = validateRuntimeConfig({
      provider: "fake",
      logLevel: "info",
      roleModels: { reasoning: "a", coding: "b", fast: "c" },
    });
    expect(result.ok).toBe(true);
  });

  it("resolves roleModels through layered config", () => {
    const result = resolveRuntimeConfig({
      explicit: null,
      env: { DEVFORGE_CODING_MODEL: "coding-model" },
      files: [],
    });
    expect(result.config.roleModels).toEqual({ coding: "coding-model" });
  });
});