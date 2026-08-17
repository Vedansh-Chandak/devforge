import { env, redactSecrets } from "@devforge/config";
import pino from "pino";

const isDevelopment = env.NODE_ENV === "development";

/** Known secret-bearing object paths censored by pino's structural redaction. */
const REDACT_PATHS = [
  "apiKey",
  "api_key",
  "apikey",
  "password",
  "passwd",
  "secret",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "*.apiKey",
  "*.password",
  "*.token",
  "*.secret",
  "*.authorization",
];

const CENSOR = "[REDACTED]";

/**
 * Recursively redact secret-shaped strings inside a value. Bounded depth and
 * size so logs stay fast even for large payloads.
 */
function redactValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return redactSecrets(value);
  }
  if (depth > 4 || value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = redactValue(item, depth + 1);
  }
  return out;
}

/**
 * pino logMethod hook: redacts secret-shaped values in every log call before
 * the message is emitted. Runs for all transports (pretty + JSON).
 */
function redactingLogMethod(
  this: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any[],
  method: (this: unknown, ...args: unknown[]) => void,
): void {
  const redacted = args.map((arg) => redactValue(arg));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (method as any).apply(this, redacted);
}

function createLogger() {
  return pino({
    level: isDevelopment ? "debug" : "info",
    redact: { paths: REDACT_PATHS, censor: CENSOR },
    hooks: {
      logMethod: redactingLogMethod as never,
    },
    ...(isDevelopment
      ? {
          transport: {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "SYS:HH:mm:ss.l",
              ignore: "pid,hostname",
            },
          },
        }
      : {}),
  });
}

export const logger = createLogger();
