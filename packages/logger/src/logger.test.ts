import { describe, it, expect, vi, afterEach } from "vitest";
import { logger } from "./logger.js";

const PEM_BLOCK = [
  "-----BEGIN PRIVATE KEY-----",
  "MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggS",
  "-----END PRIVATE KEY-----",
].join("\n");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logger", () => {
  it("exports a logger instance", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("redacts secret-shaped values from emitted log lines", () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });

    logger.info(
      "connecting with apiKey sk-abcDEF123456 and bearer " +
        "eyJhbGciOiJIUzI1NiJ9.abc123 and PASSWORD=hunter2",
    );
    logger.info({ apiKey: "sk-ghijklmno789", password: "hunter2" }, "structured log");
    logger.info("certificate:\n" + PEM_BLOCK);
    logger.info("user:pass@example.com and secret=correct horse");

    const output = writes.join("\n");
    expect(output).not.toContain("sk-abcDEF123456");
    expect(output).not.toContain("sk-ghijklmno789");
    expect(output).not.toContain("eyJhbGciOiJIUzI1NiJ9.abc123");
    expect(output).not.toContain("hunter2");
    expect(output).not.toContain("MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggS");
    expect(output).not.toContain("correct horse");
    expect(output).not.toContain("user:pass@");
  });
});
