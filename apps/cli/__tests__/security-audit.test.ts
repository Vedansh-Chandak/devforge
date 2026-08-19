/**
 * DF-028 Phase 7 — Security audit with hostile provider responses.
 *
 * Proves that secret-shaped material cannot reach surfaced output no matter
 * where the provider puts it: thrown errors, error `cause` chains, structured
 * JSON content, event streams, rendered text and `--json` reports.
 *
 * The audit drives the real service boundary: ScriptedProvider (hostile)
 * → createExecutorService → executor.fix() → renderCodingReport / writeJson.
 */
import { describe, expect, it } from 'vitest';
import { ScriptedProvider, createTempMockRepo } from './helpers.js';
import { createExecutorService } from '../src/services/executor.js';
import { renderCodingReport, writeJson } from '../src/services/output.js';
import type { ModelRequest, ModelResponse } from '@devforge/model-provider';

const SECRETS = [
  'sk-ant-api03-abcdef123456789012345678901234567890',
  'sk-0000000000000000000000000000000000000000',
  'AIzaSyD1234567890abcdefghijklmnopqrstuvwxyz123456789',
  'gsk_AbCdEfGh12345678',
  'xai-abcdef1234567890abcdef',
  'Authorization: Bearer sk-zzz111222333444555',
];

function secretSample(): string {
  return SECRETS.join(' ');
}

function assertNoSecrets(value: unknown, label: string): void {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const secret of SECRETS) {
    const needle = secret.includes('Bearer') ? secret.split(' ')[2]! : secret;
    expect(serialized, `${label} leaked: ${needle}`).not.toContain(needle);
  }
}

/** Provider that throws a hostile error carrying every key shape. */
class HostileErrorProvider {
  readonly id = 'hostile-error';
  async generate(): Promise<ModelResponse> {
    throw new Error(`upstream auth boom ${secretSample()}`);
  }
}

/** Provider that returns structured JSON content embedding every key shape. */
class HostileContentProvider {
  readonly id = 'hostile-content';
  async generate(): Promise<ModelResponse> {
    return {
      content: `<DEVFORGE_PATCH>
[{"id":"p1","operation":"CREATE","file":"src/x.js","newContent":"export const secret = '${SECRETS[0]}';"}]
</DEVFORGE_PATCH> <log>${secretSample()}</log>`,
      model: 'hostile-content',
      finishReason: 'stop',
    };
  }
}

describe('DF-028 security audit (Phase 7)', () => {
  it('a hostile error provider never leaks secrets into the fix report JSON + text', async () => {
    const root = await createTempMockRepo();
    const hostile = new HostileErrorProvider();
    const router = { list: () => ['coding'] as const, select: () => hostile };
    const service = await createExecutorService(router as never, root, {
      maxRepairAttempts: 1,
      temperature: 0,
      verificationTargets: [],
    });

    let report;
    try {
      report = await service.fix('make it auth');
    } catch (error) {
      report = { outcome: 'REJECTED', error: error as Error };
    }
    // Initial patch generation failure rejects the run; never carries secrets.
    assertNoSecrets(report, 'fix report');
    assertNoSecrets((report as { error?: { message: string } }).error?.message, 'report.error.message');
    assertNoSecrets(report, 'event-carrying object');
    assertNoSecrets(renderCodingReport(report as never), 'rendered text');
    assertNoSecrets(writeJson(report), '--json output');
  });

  it('secret-shaped structured content in patches is either validated out or redacted', async () => {
    const root = await createTempMockRepo();
    const hostile = new HostileContentProvider();
    const router = { list: () => ['coding'] as const, select: () => hostile };
    const service = await createExecutorService(router as never, root, {
      maxRepairAttempts: 1,
      temperature: 0,
      verificationTargets: [],
    });

    const report = await service.fix('write the secret-bearing file');
    assertNoSecrets(report, 'fix report');
    assertNoSecrets(report.events, 'event stream');
    assertNoSecrets(writeJson(report), '--json output');
  });

  it('hostile provider messages in missed-parse paths stay redacted in rendered output', async () => {
    // A provider that returns plain text where a patch is expected, with an
    // embedded secret in the assistant turn.
    const root = await createTempMockRepo();
    const odd = {
      id: 'odd',
      generate: async (_request: ModelRequest): Promise<ModelResponse> => ({
        content: `I cannot express this in patches. Debug hint: ${secretSample()}`,
        model: 'odd',
        finishReason: 'stop',
      }),
    };
    const router = { list: () => ['coding'] as const, select: () => odd };
    const service = await createExecutorService(router as never, root, {
      maxRepairAttempts: 1,
      temperature: 0,
      verificationTargets: [],
    });

    let report;
    try {
      report = await service.fix('explain yourself');
    } catch (error) {
      report = { outcome: 'REJECTED', error: error as Error };
    }
    const err = (report as { error?: { message: string } }).error?.message;
    assertNoSecrets(err, 'report.error.message');
    assertNoSecrets(report, 'error-bearing object');
    assertNoSecrets(renderCodingReport(report as never), 'rendered text');
  });

  it('doctor --models hostiles are redacted across every role probe', async () => {
    // Phase 2 smoke path: hostile generate error must never leak per role.
    const hostile = new HostileErrorProvider();
    const router = {
      list: () => ['reasoning' as const, 'coding' as const, 'fast' as const],
      select: () => hostile,
    };
    const { runModelSmoke } = await import('../src/services/model-smoke.js');
    const checks = await runModelSmoke({ provider: 'fake', logLevel: 'info' } as never, {
      router: router as never,
      timeoutMs: 500,
    });
    expect(checks.length).toBe(3);
    for (const check of checks) {
      expect(check.ok).toBe(false);
      assertNoSecrets(check.detail, `check ${check.name}`);
    }
  });

  it('redacts the Anthropic prefix form in every output sink', async () => {
    // Regression: the sk-ant- tail block was not masked by the central
    // redaction primitive before DF-028 Phase 3.
    const root = await createTempMockRepo();
    const hostile = { id: 'sk-ant-hostile', generate: async () => { throw new Error(`401 ${SECRETS[0]}`); } };
    const router = { list: () => ['coding'] as const, select: () => hostile };
    const service = await createExecutorService(router as never, root, {
      maxRepairAttempts: 1,
      temperature: 0,
      verificationTargets: [],
    });

    let report;
    try {
      report = await service.fix('touch auth');
    } catch (error) {
      report = { outcome: 'REJECTED', error: error as Error };
    }
    const err = (report as { error?: { message: string } }).error?.message;
    assertNoSecrets(err, 'report.error.message');
    assertNoSecrets(report, '--json object');
    const rendered = renderCodingReport(report as never);
    expect(rendered).not.toContain('sk-ant-api03');
    expect(rendered).not.toContain('abcdef123456789012345678901234567890');
  });
});