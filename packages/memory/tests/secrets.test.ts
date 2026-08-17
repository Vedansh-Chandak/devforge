import { describe, expect, it } from "vitest";
import {
  redactSecrets,
  entropyOf,
  looksRandom,
  REDACTED,
} from "../src/secrets.js";

describe("redactSecrets", () => {
  it("redacts env-style interpolation", () => {
    expect(redactSecrets("token is ${API_KEY} here")).toContain(REDACTED);
    expect(redactSecrets("using process.env.DB_PASSWORD directly")).toContain(REDACTED);
  });

  it("never leaks the original interpolation", () => {
    const out = redactSecrets("key ${STRIPE_SECRET_KEY}");
    expect(out).not.toContain("STRIPE_SECRET_KEY");
  });

  it("redacts KEY=value assignments for secret labels", () => {
    const out = redactSecrets("API_KEY=sk-abc123");
    expect(out).toContain(REDACTED);
    expect(out).not.toContain("sk-abc123");
  });

  it("redacts PASSWORD=value assignments", () => {
    const out = redactSecrets("PASSWORD=hunter2");
    expect(out).not.toContain("hunter2");
    expect(out).toContain(REDACTED);
  });

  it("redacts JSON-style pairs", () => {
    const out = redactSecrets('{"api_key": "abcd1234", "visible": "ok"}');
    expect(out).not.toContain("abcd1234");
    expect(out).toContain('"ok"');
  });

  it("redacts bearer tokens and authorization headers", () => {
    const out = redactSecrets("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc");
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(out).toContain(REDACTED);
  });

  it("redacts x-api-key headers", () => {
    const out = redactSecrets("x-api-key: 1234567890abcdef1234567890abcdef");
    expect(out).not.toContain("1234567890abcdef1234567890abcdef");
  });

  it("redacts URL userinfo", () => {
    const out = redactSecrets("https://user:boguspass@example.com/x");
    expect(out).not.toContain("boguspass");
    expect(out).toContain("https://");
    expect(out).toContain("@");
  });

  it("redacts private key block bodies", () => {
    const key = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA7dq0secretcontent
-----END RSA PRIVATE KEY-----`;
    const out = redactSecrets(key);
    expect(out).not.toContain("secretcontent");
    expect(out).toContain("BEGIN PRIVATE KEY");
    expect(out).toContain("END PRIVATE KEY");
  });

  it("redacts known secrets by exact value", () => {
    const out = redactSecrets("the password is supersecret42", {
      knownSecrets: ["supersecret42"],
    });
    expect(out).not.toContain("supersecret42");
  });

  it("redacts high-entropy values after secret labels", () => {
    const line = "db_password = k9xR2mQ7vEpL4nZ8c1";
    const out = redactSecrets(line);
    expect(out).not.toContain("k9xR2mQ7vEpL4nZ8c1");
    expect(out).toContain(REDACTED);
  });

  it("leaves prose untouched", () => {
    const prose = "The quick brown fox jumps over the lazy dog.";
    expect(redactSecrets(prose)).toBe(prose);
  });

  it("leaves ordinary config values untouched", () => {
    const out = redactSecrets("PORT=3000\nfeature_flag=on\nhost=localhost");
    expect(out).toContain("3000");
    expect(out).toContain("on");
  });

  it("is deterministic across calls", () => {
    const input = 'API_KEY=x92kkqkq; "token":"az09", password=xxxxxxxxxxxxxxxx';
    expect(redactSecrets(input)).toBe(redactSecrets(input));
  });

  it("is idempotent (redacted output passes through unchanged)", () => {
    const input = 'API_KEY=abcdefghij12345678; bearer abcdefghij1234567890';
    const once = redactSecrets(input);
    const twice = redactSecrets(once);
    expect(twice).toBe(once);
  });

  it("handles empty strings", () => {
    expect(redactSecrets("")).toBe("");
  });

  it("does not redact when heuristic disabled and no labels match", () => {
    const out = redactSecrets("random = d1e2a3db3f9c0x8y7z6w5", {
      disableHeuristic: true,
    });
    expect(out).toContain("d1e2a3db3f9c0x8y7z6w5");
  });

  it("redacts cookie and session id labels", () => {
    const out = redactSecrets("session_id = 3980f1a9b2c4d5e6");
    expect(out).not.toContain("3980f1a9b2c4d5e6");
  });
});

describe("entropyOf / looksRandom", () => {
  it("computes a deterministic entropy value", () => {
    expect(entropyOf("abcd")).toBe(entropyOf("abcd"));
    expect(entropyOf("aaaa")).toBe(0);
  });

  it("flags long, varied tokens as random-looking", () => {
    expect(looksRandom("k9xR2mQ7vEpL4nZ8c1Q0")).toBe(true);
  });

  it("does not flag short or repetitive tokens", () => {
    expect(looksRandom("ab")).toBe(false);
    expect(looksRandom("aaaaaaaaaaaa")).toBe(false);
  });

  it("boundary: exactly the threshold length is not random", () => {
    expect(looksRandom("12345678901")).toBe(false);
  });
});