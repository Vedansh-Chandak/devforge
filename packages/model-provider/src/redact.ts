/**
 * Secret redaction for provider diagnostics (DF-026A).
 *
 * Reuses the single source of truth from `@devforge/errors` for structural
 * redaction (bearer tokens, env interpolations, API-key headers, URL
 * credentials, private keys) and adds explicit value redaction so configured
 * API keys never reach error messages, logs, or reports.
 */

import { redactSecretText } from '@devforge/errors';

export { redactSecretText };

/** Minimum length for an explicit secret value to be redacted (avoids
 * replacing common short tokens such as "api"). */
export const MIN_SECRET_LENGTH = 6;

/**
 * Redact structural secrets (via `redactSecretText`) and any explicit secret
 * values supplied by the caller. Deterministic for a fixed input.
 */
export function redactSecrets(
  value: string,
  secrets?: readonly string[],
): string {
  let output = redactSecretText(value);
  if (secrets) {
    for (const secret of secrets) {
      if (typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH) {
        output = output.split(secret).join('[REDACTED]');
      }
    }
  }
  return output;
}
