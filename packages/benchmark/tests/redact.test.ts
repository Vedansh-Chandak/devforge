import { describe, expect, it } from "vitest";
import {
  containsSecret,
  REDACTED,
  redactRecord,
  redactValue,
} from "../src/redact.js";
import { FakeEnvironment } from "../src/environment.js";

describe("redactValue", () => {
  it("replaces known secrets with the REDACTED marker", () => {
    const output = redactValue("token=abc123def", { knownSecrets: ["abc123def"] });
    expect(output).not.toContain("abc123def");
    expect(output).toContain(REDACTED);
  });

  it("leaves ordinary text untouched", () => {
    const output = redactValue("The quick brown fox", { knownSecrets: ["topsecret"] });
    expect(output).toBe("The quick brown fox");
  });

  it("is deterministic: identical input yields identical output", () => {
    const options = { knownSecrets: ["secret"] };
    expect(redactValue("key=secret", options)).toBe(redactValue("key=secret", options));
  });

  it("redacts every occurrence of a known secret", () => {
    const output = redactValue("a b c", { knownSecrets: ["b"] });
    expect(output.split(" ")).toHaveLength(3);
    expect(output).not.toContain("b");
  });

  it("ignores empty and absent secrets", () => {
    const output = redactValue("nothing to hide", { knownSecrets: ["", "  "] });
    expect(output).toBe("nothing to hide");
  });

  it("feeds environment-derived secrets into redaction", () => {
    const env = new FakeEnvironment({ GITHUB_TOKEN: "ghp_livekey" });
    const output = redactValue("ghp_livekey", { environment: env });
    expect(output).not.toContain("ghp_livekey");
    expect(output).toContain(REDACTED);
  });

  it("does not fabricate redactions when given no secrets", () => {
    const output = redactValue("GHOST_KEY_12345", {});
    expect(output).toBe("GHOST_KEY_12345");
  });

  it("exports the stable REDACTED marker", () => {
    expect(typeof REDACTED).toBe("string");
    expect(REDACTED.length).toBeGreaterThan(0);
  });
});

describe("redactRecord", () => {
  it("preserves object shape and key order", () => {
    const input = { token: "supersecret", name: "nested", ok: true };
    const output = redactRecord(input, { knownSecrets: ["supersecret"] });
    expect(Object.keys(output)).toEqual(["token", "name", "ok"]);
    expect(output.name).toBe("nested");
    expect(output.ok).toBe(true);
    expect(output.token).toContain(REDACTED);
  });

  it("recurses into arrays", () => {
    const output = redactRecord(["alpha", "beta"], { knownSecrets: ["beta"] });
    expect(output[0]).toBe("alpha");
    expect(output[1]).toContain(REDACTED);
  });

  it("returns non-object values unchanged when they are not strings", () => {
    expect(redactRecord(41, { knownSecrets: ["41"] })).toBe(41);
    expect(redactRecord(null, {})).toBeNull();
    expect(redactRecord(undefined, {})).toBeUndefined();
  });

  it("redacts top-level strings", () => {
    expect(redactRecord("hush", { knownSecrets: ["hush"] })).toContain(REDACTED);
  });

  it("recurses into nested objects", () => {
    const output = redactRecord(
      { outer: { inner: { key: "boom" } } },
      { knownSecrets: ["boom"] },
    );
    expect(output.outer.inner.key).toContain(REDACTED);
  });
});

describe("containsSecret", () => {
  it("reports when a secret value is present", () => {
    expect(containsSecret("prefix abc suffix", ["abc"])).toBe(true);
  });

  it("reports false when no secret is present", () => {
    expect(containsSecret("prefix abc suffix", ["zzz"])).toBe(false);
  });

  it("handles multiple candidate secrets", () => {
    expect(containsSecret("x", ["a", "x", "c"])).toBe(true);
  });

  it("ignores empty secret entries", () => {
    expect(containsSecret("any", ["", "   "])).toBe(false);
  });

  it("returns true when the secret is part of a larger token", () => {
    expect(containsSecret("Bearer sk-1234", ["sk-1234"])).toBe(true);
  });
});