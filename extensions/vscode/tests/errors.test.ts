import { describe, it, expect } from 'vitest';
import {
  DevForgeExtensionError,
  ExtensionConfigError,
  NoWorkspaceError,
  DevForgeClientError,
  SessionError,
  CommandError,
  LanguageServerError,
  DiffError,
  CancelledError,
  formatExtensionError,
} from '../src/errors.js';

describe('error classes', () => {
  it('carries a stable machine code', () => {
    expect(new ExtensionConfigError('x').code).toBe('CONFIG_ERROR');
    expect(new NoWorkspaceError('x').code).toBe('NO_WORKSPACE');
    expect(new DevForgeClientError('x').code).toBe('CLIENT_ERROR');
    expect(new SessionError('x').code).toBe('SESSION_ERROR');
    expect(new CommandError('x').code).toBe('COMMAND_ERROR');
    expect(new LanguageServerError('x').code).toBe('LANGUAGE_SERVER_ERROR');
    expect(new DiffError('x').code).toBe('DIFF_ERROR');
    expect(new CancelledError('x').code).toBe('CANCELLED');
  });

  it('defaults the code to UNKNOWN', () => {
    expect(new DevForgeExtensionError('x').code).toBe('UNKNOWN');
  });

  it('uses the concrete class name', () => {
    expect(new NoWorkspaceError().name).toBe('NoWorkspaceError');
  });

  it('supports instanceof after being re-thrown across realms', () => {
    const error = new SessionError('boom');
    expect(error instanceof SessionError).toBe(true);
    expect(error instanceof DevForgeExtensionError).toBe(true);
    expect(error instanceof Error).toBe(true);
  });

  it('NoWorkspaceError has a sensible default message', () => {
    expect(new NoWorkspaceError().message).toBe('No workspace folder is open.');
  });
});

describe('formatExtensionError', () => {
  it('formats extension errors with code and message', () => {
    expect(formatExtensionError(new SessionError('no session'), false)).toBe('[SESSION_ERROR] no session');
  });

  it('includes the stack when debug is enabled', () => {
    const formatted = formatExtensionError(new SessionError('no session'), true);
    expect(formatted).toContain('[SESSION_ERROR] no session');
    expect(formatted).toContain('Error: no session');
  });

  it('formats plain errors as UNKNOWN', () => {
    expect(formatExtensionError(new Error('bad'), false)).toBe('[UNKNOWN] bad');
  });

  it('formats non-errors as strings', () => {
    expect(formatExtensionError('boom', false)).toBe('[UNKNOWN] boom');
    expect(formatExtensionError(42, false)).toBe('[UNKNOWN] 42');
  });

  it('formats nullish values', () => {
    expect(formatExtensionError(null, false)).toBe('[UNKNOWN] null');
  });
});
