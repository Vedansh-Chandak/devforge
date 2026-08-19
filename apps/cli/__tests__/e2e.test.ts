/**
 * DF-017.2 — End-to-End CLI Smoke Tests.
 *
 * Drives the real CLI entry point (`run()`) against a throwaway copy of the
 * mock repository placed in the OS temp dir. No real LLM, no network, and no
 * filesystem writes outside the temp directory. The heavy service internals
 * use the default `fake` provider (FakeModelProvider).
 *
 * Because the CLI's entry point does not accept injected providers, heavy
 * model-backed commands degrade gracefully under the fake provider (planner /
 * verification failures surface as friendly output or mapped exit codes). The
 * assertions below therefore focus on lifecycle, dispatch, output shape, JSON
 * mode, help, and error mapping; the deterministic success paths live in
 * integration.test.ts where providers can be injected.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../src/index.js';
import { createTempMockRepo } from './helpers.js';

// Silence the shared pino logger used by brain/runtime/execution so it never
// writes structured logs to stdout during the smoke run.
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

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await createTempMockRepo({ git: true });
  process.env.DEVFORGE_PROVIDER = 'fake';
  process.env.DEVFORGE_LOG_LEVEL = 'error';
  process.env.DF_DISABLE_TELEMETRY = '1';
});

describe('devforge CLI end-to-end smoke tests', () => {
  it('help exits 0 and prints usage for every registered command', async () => {
    const { code, stdout } = await runCli(['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage');
    for (const command of ['ask', 'plan', 'review', 'fix', 'explain', 'run', 'status', 'doctor', 'config']) {
      expect(stdout).toContain(command);
    }
  });

  it('devforge status prints workspace + provider info', async () => {
    const { code, stdout } = await runCli(['status']);
    expect(code).toBe(0);
    expect(stdout).toContain('DevForge Status');
    expect(stdout).toContain('Workspace');
    expect(stdout).toContain('Provider');
    expect(stdout).toContain('fake');
  });

  it('devforge config prints the resolved configuration', async () => {
    const { code, stdout } = await runCli(['config']);
    expect(code).toBe(0);
    expect(stdout).toContain('DevForge Config');
    expect(stdout).toContain('Provider');
  });

  it('devforge doctor runs health checks', async () => {
    const { code, stdout } = await runCli(['doctor']);
    expect(code).toBe(0);
    expect(stdout).toContain('workspace');
    expect(stdout).toContain('node');
  });

  it('devforge doctor --models runs the opt-in model smoke offline under the fake provider', async () => {
    const { code, stdout } = await runCli(['doctor', '--models']);
    expect(code).toBe(0);
    expect(stdout).toContain('model:reasoning');
    expect(stdout).toContain('usage:');
  });

  it('devforge plan degrades gracefully under the fake provider', async () => {
    const { code, stdout } = await runCli(['plan', 'Refactor the module']);
    expect(code).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  });

  it('devforge ask renders human output for a question', async () => {
    const { code, stdout } = await runCli(['ask', 'Explain the architecture']);
    expect(code).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  });

  it('devforge ask --json emits parseable JSON on stdout', async () => {
    const { code, stdout } = await runCli(['ask', 'Explain the architecture', '--json']);
    expect(code).toBe(0);
    const firstLine = stdout.trim().split('\n')[0] ?? '';
    expect(() => JSON.parse(firstLine)).not.toThrow();
  });

  it('devforge run executes the plan/executor pipeline with graceful failure', async () => {
    const { code, stdout } = await runCli(['run', 'Ship a feature']);
    expect(code).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  });

  it('devforge review reports on the temp repository state', async () => {
    const { code, stdout } = await runCli(['review']);
    expect(code).toBe(0);
    expect(stdout).toBeTruthy();
  });

  it('devforge fix maps a model failure to a non-zero exit code', async () => {
    const { code } = await runCli(['fix', 'Make the tests pass']);
    // The default fake provider cannot emit parseable patches, so the coding
    // engine fails and the CLI surfaces it as an exit-code 1 error.
    expect(code).toBe(1);
  });

  it('an unknown command exits non-zero', async () => {
    const { code } = await runCli(['not-a-command']);
    expect(code).not.toBe(0);
  });

  it('a missing required argument exits non-zero', async () => {
    const { code } = await runCli(['ask']);
    expect(code).not.toBe(0);
  });
});

/** Run the CLI with cwd pointed at the throwaway mock repository. */
async function runCli(argv: readonly string[]): Promise<RunResult> {
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
    // `run()` calls commander's parseAsync(argv) in "node" mode, which treats
    // argv[0] as the app and argv[1] as the script, so we must prepend those.
    const code = await run(['node', 'devforge', ...argv]);
    return { code, stdout: out.join(''), stderr: err.join('') };
  } finally {
    process.chdir(previous);
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
}