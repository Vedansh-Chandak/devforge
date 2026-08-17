import { describe, expect, it } from "vitest";
import {
  FakeEnvironment,
  isSecretEnvName,
  mulberry32,
  randomChoice,
  randomInt,
  SECRET_SUFFIXES,
  secretValuesFrom,
  SENSITIVE_ENV_NAMES,
  SystemEnvironment,
} from "../src/environment.js";

describe("FakeEnvironment", () => {
  it("returns injected values", () => {
    const env = new FakeEnvironment({ FOO: "bar" });
    expect(env.get("FOO")).toBe("bar");
  });

  it("returns undefined for absent keys", () => {
    expect(new FakeEnvironment({}).get("NOPE")).toBeUndefined();
  });

  it("treats falsy injected values as present", () => {
    expect(new FakeEnvironment({ EMPTY: "" }).get("EMPTY")).toBe("");
  });
});

describe("SystemEnvironment", () => {
  it("reads the real process.env", () => {
    const env = new SystemEnvironment();
    expect(env.get("PATH")).toBe(process.env.PATH);
  });

  it("returns undefined for unknown variables", () => {
    expect(new SystemEnvironment().get("DEVFORGE_UNKNOWN_FLAG")).toBeUndefined();
  });
});

describe("isSecretEnvName", () => {
  it("detects API_KEY suffix", () => {
    expect(isSecretEnvName("OPENAI_API_KEY")).toBe(true);
    expect(isSecretEnvName("MY_API_KEY")).toBe(true);
  });

  it("detects TOKEN and SECRET suffixes", () => {
    expect(isSecretEnvName("GITHUB_TOKEN")).toBe(true);
    expect(isSecretEnvName("JWT_SECRET")).toBe(true);
  });

  it("detects PASSWORD and PRIVATE_KEY suffixes", () => {
    expect(isSecretEnvName("DB_PASSWORD")).toBe(true);
    expect(isSecretEnvName("TLS_PRIVATE_KEY")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isSecretEnvName("openai_api_key")).toBe(true);
  });

  it("rejects ordinary environment names", () => {
    expect(isSecretEnvName("PATH")).toBe(false);
    expect(isSecretEnvName("NODE_ENV")).toBe(false);
  });

  it("matches by suffix, not prefix", () => {
    expect(isSecretEnvName("API_KEY_FILE")).toBe(false);
    expect(isSecretEnvName("TOKEN_VALUE")).toBe(false);
    expect(isSecretEnvName("GITHUB_TOKEN")).toBe(true);
  });
});

describe("SECRET_SUFFIXES / SENSITIVE_ENV_NAMES", () => {
  it("lists credential-shaped suffixes deterministically", () => {
    expect(SECRET_SUFFIXES).toContain("API_KEY");
    expect(SECRET_SUFFIXES).toContain("PASSWORD");
  });

  it("lists the default probe set", () => {
    expect(SENSITIVE_ENV_NAMES).toContain("OPENAI_API_KEY");
    expect(SENSITIVE_ENV_NAMES).toContain("GITHUB_TOKEN");
  });
});

describe("secretValuesFrom", () => {
  it("collects secret-shaped values from a probe set", () => {
    const env = new FakeEnvironment({
      GITHUB_TOKEN: "ghp_secret",
      OPENAI_API_KEY: "sk-secret",
      NODE_ENV: "test",
    });
    expect(secretValuesFrom(env)).toEqual(["ghp_secret", "sk-secret"]);
  });

  it("ignores non-secret probes even when present", () => {
    const env = new FakeEnvironment({ NODE_ENV: "test", PATH: "/bin" });
    expect(secretValuesFrom(env)).toEqual([]);
  });

  it("ignores empty secret values", () => {
    const env = new FakeEnvironment({ GITHUB_TOKEN: "" });
    expect(secretValuesFrom(env)).toEqual([]);
  });

  it("honors an explicit custom probe list", () => {
    const env = new FakeEnvironment({ FOO_API_KEY: "v1", BAR: "v2" });
    expect(secretValuesFrom(env, ["FOO_API_KEY", "BAR"])).toEqual(["v1"]);
  });
});

describe("mulberry32", () => {
  it("is deterministic for identical seeds", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const first = Array.from({ length: 8 }, () => a.next());
    const second = Array.from({ length: 8 }, () => b.next());
    expect(first).toEqual(second);
  });

  it("diverges for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a.next()).not.toBe(b.next());
  });

  it("produces values in [0, 1)", () => {
    const random = mulberry32(42);
    for (let index = 0; index < 100; index += 1) {
      const value = random.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("reproduce identical streams across instances (golden-ish)", () => {
    const a = mulberry32(99);
    const b = mulberry32(99);
    for (let index = 0; index < 5; index += 1) {
      expect(a.next()).toBe(b.next());
    }
  });
});

describe("randomInt", () => {
  it("returns zero for non-positive bounds", () => {
    expect(randomInt(mulberry32(1), 0)).toBe(0);
    expect(randomInt(mulberry32(1), -5)).toBe(0);
  });

  it("respects the exclusive bound", () => {
    const random = mulberry32(3);
    for (let index = 0; index < 50; index += 1) {
      const value = randomInt(random, 10);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(10);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it("is deterministic for identical seeds", () => {
    expect(randomInt(mulberry32(5), 100)).toBe(randomInt(mulberry32(5), 100));
  });
});

describe("randomChoice", () => {
  it("picks deterministically from a list", () => {
    expect(randomChoice(mulberry32(4), ["a", "b", "c"])).toBe(
      randomChoice(mulberry32(4), ["a", "b", "c"]),
    );
  });

  it("always returns one of the options", () => {
    const random = mulberry32(8);
    for (let index = 0; index < 50; index += 1) {
      expect(["a", "b"]).toContain(randomChoice(random, ["a", "b"]));
    }
  });

  it("throws for an empty list", () => {
    expect(() => randomChoice(mulberry32(1), [])).toThrow(RangeError);
  });
});