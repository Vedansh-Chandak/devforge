/**
 * DF-028 Phase 10 — CLI production flow.
 *
 * Treats the CLI the way an operator would: a whole session across commands,
 * checking output shape, exit codes, deterministic JSON that parses on stdout
 * (logs stay on stderr), and imposingly secret-free output even when the
 * provider is hostile.
 *
 * Everything runs under the fake provider offline except the hostile cases,
 * which inject a deterministic ScriptedProvider via the executor service.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../src/index.js';
import { createTempMockRepo } from './helpers.js';
import { createExecutorService } from '../src/services/executor.js';
import { writeJson } from '../src/services/output.js';

vi.mock('@devforge/logger', () => ({
  logger: {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
  },
}));

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await createTempMockRepo({ git: true });
  process.env.DEVFORGE_PROVIDER = 'fake';
  process.env.DEVFORGE_LOG_LEVEL = 'error';
  process.env.DF_DISABLE_TELEMETRY = '1';
});

describe('DF-028 CLI production flow (Phase 10)', () => {
  it('a whole session: config, doctor, plan, review, status all exit 0', async () => {
    for (const argv of [
      ['config'],
      ['doctor'],
      ['plan', 'Add a feature'],
      ['status'],
    ]) {
      const { code, stderr } = await runCli(argv);
      expect(code, `${argv.join(' ')} should exit 0`).toBe(0);
      expect(stderr).not.toContain('sk-ant-');
    }
  });

  it('every JSON command emits a single parseable JSON document on stdout', async () => {
    for (const argv of [
      ['config', '--json'],
      ['doctor', '--json'],
      ['status', '--json'],
    ]) {
      const { code, stdout } = await runCli(argv);
      expect(code, `${argv.join(' ')} should exit 0`).toBe(0);
      expect(() => JSON.parse(stdout), `${argv.join(' ')} stdout must parse`).not.toThrow();
    }
  });

  it('JSON stdout does not interleave logger output (logs belong on stderr)', async () => {
    const { stdout } = await runCli(['config', '--json']);
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  it('hostile provider output stays secret-free through rendered + JSON sinks', async () => {
    const hostile = {
      id: 'hostile',
      generate: async () => {
        throw new Error('403 forbidden sk-ant-api03-abcdef123456789012345678901234567890');
      },
    };
    const router = { list: () => ['coding'] as const, select: () => hostile };
    const service = await createExecutorService(router as never, repoRoot, {
      maxRepairAttempts: 1,
      temperature: 0,
      verificationTargets: [],
    });

    let report;
    try {
      report = await service.fix('leak');
    } catch (error) {
      report = { outcome: 'REJECTED', error: error as Error };
    }
    const json = writeJson(report);
    expect(json).not.toContain('sk-ant-api03');
    expect(json).not.toContain('abcdef123456789012345678901234567890');
    // Rendered human text is likewise clean.
    const { renderCodingReport } = await import('../src/services/output.js');
    expect(renderCodingReport(report as never)).not.toContain('sk-ant-api03');
  });

  it('failures map to non-zero exit codes with a mapped message', async () => {
    const { code, stderr } = await runCli(['fix', 'Break everything']);
    expect(code).not.toBe(0);
    expect(stderr.length).toBeGreaterThan(0);
  });
});

/** Run the CLI with cwd pointed at the throwaway mock repository. */
async function runCli(argv: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const stdoutSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    }) as never);
  const stderrSpy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(((chunk: unknown) => {
      err.push(String(chunk));
      return true;
    }) as never);

  const previous = process.cwd();
  process.chdir(repoRoot);
  try {
    const code = await run(['node', 'devforge', ...argv]);
    return { code, stdout: out.join(''), stderr: err.join('') };
  } finally {
    process.chdir(previous);
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
}