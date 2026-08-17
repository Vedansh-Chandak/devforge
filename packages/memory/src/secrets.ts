/**
 * @devforge/memory — Deterministic secret redaction (DF-023).
 *
 * Persisted text passes through {@link redactSecrets} so API keys, tokens,
 * passwords, and credential-shaped values never reach disk. Redaction is fully
 * deterministic: identical input yields identical output, and each redaction
 * site is replaced with the fixed marker `[REDACTED]`.
 */

/** Marker inserted at every redaction site. */
export const REDACTED = "[REDACTED]";

/** Labels whose value should be treated as a secret in `KEY=value` contexts. */
const SECRET_LABELS = [
  "apikey",
  "api_key",
  "api-key",
  "token",
  "access_token",
  "access-token",
  "refresh_token",
  "client_secret",
  "client-secret",
  "secret",
  "password",
  "passwd",
  "pwd",
  "db_password",
  "db-password",
  "private_key",
  "private-key",
  "authorization",
  "bearer",
  "credential",
  "credentials",
  "app_secret",
  "app-secret",
  "auth",
  "session_id",
  "cookie",
];

/** A cached label bundle for fast matching. */
const LABEL_RE = new RegExp(
  `^(${SECRET_LABELS.join("|")})$`,
  "i",
);

/** Minimal heuristic entropy for detecting high-entropy tokens. */
export function entropyOf(text: string): number {
  if (text.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const char of text) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let entropy = 0;
  const len = text.length;
  for (const count of counts.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** True when a value looks like a high-entropy secret token. */
export function looksRandom(value: string): boolean {
  if (value.length < 12) return false;
  const entropy = entropyOf(value);
  // A 64-hex token and typical API keys sit above this threshold; prose below.
  return entropy > 3.2;
}

export interface RedactionOptions {
  /** Exact values to always redact, e.g. known passwords/tokens. */
  readonly knownSecrets?: ReadonlyArray<string>;
  /** True disables heuristic high-entropy detection (default false). */
  readonly disableHeuristic?: boolean;
}

interface Redactor {
  advance(input: string, index: number): number;
  replacement?: string;
}

/**
 * Deterministically redact secret-shaped content from `input`.
 * Returns the same output for the same input on every call.
 */
export function redactSecrets(input: string, options: RedactionOptions = {}): string {
  let output = input;

  output = redactKnownSecrets(output, options);
  output = redactEnvInterpolation(output);
  output = redactKeyValuePairs(output);
  output = redactJsonPairs(output);
  output = redactAuthorization(output);
  output = redactUrlUserinfo(output);
  output = redactPrivateKeyBlocks(output);
  if (!options.disableHeuristic) {
    output = redactHighEntropy(output);
  }
  return output;
}

function redactKnownSecrets(
  input: string,
  options: RedactionOptions,
): string {
  const known = options.knownSecrets ?? [];
  if (known.length === 0) return input;
  let output = input;
  for (const secret of known.filter((s) => s.length > 0)) {
    // Escape the value before using it as a literal match.
    const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    output = output.replace(new RegExp(escaped, "g"), REDACTED);
  }
  return output;
}

function redactEnvInterpolation(input: string): string {
  return input
    .replace(/\$\{([A-Z0-9_]+)\}/gi, REDACTED)
    .replace(/process\.env\.([A-Z0-9_]+)/gi, REDACTED);
}

function redactKeyValuePairs(input: string): string {
  // `LABEL=value` (or `LABEL: value`) anywhere on a line; the value extends to
  // whitespace, line end, or a comma/semicolon, or is a quoted token.
  return input.replace(
    /(^|[;\s])([A-Za-z0-9_.-]+)\s*[=:]\s*("[^"]*"|[^\s,;]+)/gm,
    (match, lead: string, key: string) => {
      if (!LABEL_RE.test(key.trim())) return match;
      return `${lead}${key.trim()}=${REDACTED}`;
    },
  );
}

function redactJsonPairs(input: string): string {
  // `"label": "value"` JSON object pairs.
  return input.replace(
    /"([A-Za-z0-9_.-]{1,64})"\s*:\s*("[^"]*")/g,
    (match, label: string, _value: string) => {
      if (!LABEL_RE.test(label.trim())) return match;
      return `"${label}": "${REDACTED}"`;
    },
  );
}

function redactAuthorization(input: string): string {
  let output = input.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`);
  output = output.replace(
    /\b(AUTHORIZATION|X-API-KEY|X-AUTH-TOKEN|API-KEY)\s*[:=]\s*("[^"]*"|\S+)/gi,
    (_match, header: string) => `${header}=${REDACTED}`,
  );
  return output;
}

function redactUrlUserinfo(input: string): string {
  // `scheme://user:password@host` retains scheme+host, redacts credentials.
  return input.replace(
    /(\b\w+:\/\/)([^/@\s]+)@/g,
    (_match, scheme: string) => `${scheme}${REDACTED}@`,
  );
}

function redactPrivateKeyBlocks(input: string): string {
  return input.replace(
    /-----BEGIN ([A-Z ]*)PRIVATE KEY-----[\s\S]*?-----END \1PRIVATE KEY-----/g,
    "-----BEGIN PRIVATE KEY-----\n[REDACTED]\n-----END PRIVATE KEY-----",
  );
}

function redactHighEntropy(input: string): string {
  // Redact whitespace-delimited tokens that follow secret labels OR look
  // random on their own while adjacent to a same-line assignment.
  const lines = input.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    const eqIndex = line.indexOf("=");
    const pivot = colonIndex >= 0 && (eqIndex < 0 || colonIndex < eqIndex)
      ? colonIndex
      : eqIndex;
    if (pivot < 0) {
      out.push(line);
      continue;
    }
    const label = line.slice(0, pivot).replace(/[":'"`]/g, "").trim();
    const value = line.slice(pivot + 1).replace(/[",'\s]/g, "").trim();
    if (LABEL_RE.test(label) && looksRandom(value)) {
      out.push(`${line.slice(0, pivot)}${line[pivot]}${REDACTED}`);
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}