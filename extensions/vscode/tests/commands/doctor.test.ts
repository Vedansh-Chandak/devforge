import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerDoctorCommand, isDoctorPayload, healthChecksToSignals } from '../../src/commands/doctor.js';
import { makeDeps, okResult } from '../helpers/deps.js';
import * as vscode from '../mocks/vscode.js';

const PAYLOAD = {
  allOk: false,
  checks: [
    { name: 'git', ok: true, detail: 'present' },
    { name: 'model', ok: false, detail: 'missing key', fix: 'set DEVFORGE_API_KEY' },
  ],
};

describe('isDoctorPayload', () => {
  it('recognizes doctor payloads', () => {
    expect(isDoctorPayload(PAYLOAD)).toBe(true);
  });

  it('rejects non-payloads', () => {
    expect(isDoctorPayload({ checks: [] })).toBe(false);
    expect(isDoctorPayload(null)).toBe(false);
  });
});

describe('healthChecksToSignals', () => {
  it('converts only failed checks into error signals', () => {
    const signals = healthChecksToSignals(PAYLOAD.checks);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ category: 'doctor', severity: 'error', file: '' });
  });

  it('appends the fix hint to the message', () => {
    const [signal] = healthChecksToSignals(PAYLOAD.checks);
    expect(signal?.message).toContain('set DEVFORGE_API_KEY');
  });

  it('returns no signals when all checks pass', () => {
    expect(healthChecksToSignals([{ name: 'git', ok: true, detail: 'ok' }])).toEqual([]);
  });
});

describe('devforge.doctor command', () => {
  beforeEach(() => vscode.__resetMocks());

  it('executes doctor without prompting', async () => {
    const { deps, client } = makeDeps();
    registerDoctorCommand(deps);
    await vscode.commands.executeCommand('devforge.doctor');
    expect(client.run).toHaveBeenCalledWith('doctor');
  });

  it('publishes failed health checks as diagnostics', async () => {
    const { deps } = makeDeps({ results: [okResult({ data: PAYLOAD })] });
    const setSpy = vi.spyOn(deps.diagnostics, 'set');
    registerDoctorCommand(deps);
    await vscode.commands.executeCommand('devforge.doctor');
    expect(setSpy).toHaveBeenCalledWith([
      expect.objectContaining({ category: 'doctor', severity: 'error', message: expect.stringContaining('set DEVFORGE_API_KEY') }),
    ]);
  });

  it('clears diagnostics when the report is healthy', async () => {
    const { deps } = makeDeps({ results: [okResult({ data: { allOk: true, checks: [{ name: 'git', ok: true, detail: 'ok' }] } })] });
    const setSpy = vi.spyOn(deps.diagnostics, 'set');
    registerDoctorCommand(deps);
    await vscode.commands.executeCommand('devforge.doctor');
    expect(setSpy).toHaveBeenCalledWith([]);
  });
});
