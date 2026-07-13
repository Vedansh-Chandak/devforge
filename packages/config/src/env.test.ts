import { describe, it, expect } from "vitest";
import { env } from "./env.js";

describe("config", () => {
  it("exports env schema", () => {
    expect(env).toBeDefined();
    expect(env.NODE_ENV).toBeDefined();
    expect(env.HOST).toBeDefined();
    expect(env.PORT).toBeDefined();
  });

  it("has correct defaults for HOST and PORT", () => {
    expect(env.HOST).toBe("0.0.0.0");
    expect(env.PORT).toBe(4000);
  });

  it("NODE_ENV reflects environment (test in vitest)", () => {
    // vitest sets NODE_ENV=test by default, so the schema uses that value
    expect(["development", "test", "production"]).toContain(env.NODE_ENV);
  });
});