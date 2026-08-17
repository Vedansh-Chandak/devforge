/**
 * @devforge/vscode-extension — Doctor command (DF-020).
 *
 * `devforge.doctor` runs health checks. Failed checks become diagnostics and
 * are published to the diagnostics collection.
 */

import type * as vscode from 'vscode';
import type { CommandDeps } from './deps.js';
import { appendUserMessage, handleResult, publishDiagnostics } from './helpers.js';
import type { DiagnosticSignal } from '../providers/diagnostics-provider.js';
import type { HealthCheckLike } from '../services/devforge-client.js';

/** The shape of the doctor command's structured data payload. */
export interface DoctorPayload {
  readonly checks: readonly HealthCheckLike[];
  readonly allOk: boolean;
}

/** Narrow the doctor payload from a command result. */
export function isDoctorPayload(value: unknown): value is DoctorPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'checks' in value &&
    'allOk' in value
  );
}

/** Convert failed health checks into diagnostic signals. */
export function healthChecksToSignals(checks: readonly HealthCheckLike[]): readonly DiagnosticSignal[] {
  return checks
    .filter((check) => !check.ok)
    .map((check) => ({
      category: 'doctor',
      severity: 'error' as const,
      message: check.fix ? `${check.name}: ${check.detail} — ${check.fix}` : `${check.name}: ${check.detail}`,
      file: '',
    }));
}

/** Register the `devforge.doctor` command. */
export function registerDoctorCommand(deps: CommandDeps): vscode.Disposable {
  return deps.vscode.commands.registerCommand('devforge.doctor', async () => {
    appendUserMessage(deps, 'doctor', []);
    const result = await deps.sessions.execute('doctor');
    await handleResult(deps, result);
    if (result.ok && isDoctorPayload(result.data)) {
      publishDiagnostics(deps, healthChecksToSignals(result.data.checks));
    }
  });
}
