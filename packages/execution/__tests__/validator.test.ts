import { describe, it, expect } from 'vitest';
import { validateCommand } from '../src/command/validator.js';
import { ALLOWED_COMMANDS } from '../src/command/types.js';
import { COMMAND_ERROR_CODES } from '../src/command/errors.js';

const METACHAR_EXPECTED_CODES: Record<string, string> = {
  '|': COMMAND_ERROR_CODES.SHELL_METACHARACTER,
  '&': COMMAND_ERROR_CODES.SHELL_METACHARACTER,
  ';': COMMAND_ERROR_CODES.SHELL_METACHARACTER,
  '<': COMMAND_ERROR_CODES.SHELL_METACHARACTER,
  '>': COMMAND_ERROR_CODES.SHELL_METACHARACTER,
  '`': COMMAND_ERROR_CODES.SHELL_EXPANSION,
  '$': COMMAND_ERROR_CODES.SHELL_METACHARACTER,
  '\\': COMMAND_ERROR_CODES.SHELL_METACHARACTER,
  '\n': COMMAND_ERROR_CODES.SHELL_METACHARACTER,
  '\r': COMMAND_ERROR_CODES.SHELL_METACHARACTER,
  '\t': COMMAND_ERROR_CODES.SHELL_METACHARACTER,
};

describe('validateCommand', () => {
  const baseRequest = {
    command: 'node' as const,
    args: ['script.js'],
    cwd: '/workspace',
  };

  it('accepts all allowed commands', () => {
    for (const cmd of ALLOWED_COMMANDS) {
      const result = validateCommand({ ...baseRequest, command: cmd });
      expect(result.ok).toBe(true);
    }
  });

  it('rejects empty command', () => {
    const result = validateCommand({ ...baseRequest, command: '' as any });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(COMMAND_ERROR_CODES.EMPTY_COMMAND);
  });

  it('rejects unknown executables', () => {
    const result = validateCommand({ ...baseRequest, command: 'rm' as any });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(COMMAND_ERROR_CODES.UNKNOWN_EXECUTABLE);
  });

  it('rejects absolute executable paths', () => {
    const result = validateCommand({ ...baseRequest, command: '/usr/bin/node' as any });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(COMMAND_ERROR_CODES.ABSOLUTE_EXECUTABLE);
  });

  it('rejects Windows absolute paths', () => {
    const result = validateCommand({ ...baseRequest, command: 'C:\\Windows\\node.exe' as any });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(COMMAND_ERROR_CODES.ABSOLUTE_EXECUTABLE);
  });

  it('rejects relative executable paths', () => {
    const result = validateCommand({ ...baseRequest, command: './node' as any });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(COMMAND_ERROR_CODES.RELATIVE_EXECUTABLE);
  });

  it('rejects backslash relative executable paths', () => {
    const result = validateCommand({ ...baseRequest, command: '.\\node' as any });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(COMMAND_ERROR_CODES.RELATIVE_EXECUTABLE);
  });

  it('rejects relative traversal in command', () => {
    const result = validateCommand({ ...baseRequest, command: '../node' as any });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(COMMAND_ERROR_CODES.RELATIVE_TRAVERSAL);
  });

  it('rejects shell metacharacters in command', () => {
    for (const char of ['|', '&', ';', '<', '>', '`', '$', '\\', '\n', '\r', '\t']) {
      const result = validateCommand({ ...baseRequest, command: `node${char}` as any });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(METACHAR_EXPECTED_CODES[char]);
    }
  });

  it('rejects shell expansion in command', () => {
    const patterns = ['${HOME}', '$HOME', '`echo hi`', '$(echo hi)'];
    for (const pattern of patterns) {
      const result = validateCommand({ ...baseRequest, command: `node${pattern}` as any });
      expect(result.ok).toBe(false);
      expect(['SHELL_EXPANSION', 'UNKNOWN_EXECUTABLE']).toContain(result.code);
    }
  });

  it('rejects multiple commands', () => {
    const patterns = ['node && echo hi', 'node || echo hi', 'node; echo hi'];
    for (const pattern of patterns) {
      const result = validateCommand({ ...baseRequest, command: pattern as any });
      expect(result.ok).toBe(false);
      expect(['MULTIPLE_COMMANDS', 'UNKNOWN_EXECUTABLE']).toContain(result.code);
    }
  });

  it('rejects shell metacharacters in args', () => {
    for (const char of ['|', '&', ';', '<', '>', '`', '$', '\\']) {
      const result = validateCommand({ ...baseRequest, args: ['arg', `val${char}`] });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(METACHAR_EXPECTED_CODES[char]);
    }
  });

  it('rejects shell expansion in args', () => {
    const result = validateCommand({ ...baseRequest, args: ['${HOME}'] });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(COMMAND_ERROR_CODES.SHELL_EXPANSION);
  });

  it('rejects pipes in args', () => {
    const result = validateCommand({ ...baseRequest, args: ['echo', '|', 'cat'] });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(COMMAND_ERROR_CODES.SHELL_METACHARACTER);
  });

  it('rejects redirects in args', () => {
    const result = validateCommand({ ...baseRequest, args: ['>', 'out.txt'] });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(COMMAND_ERROR_CODES.SHELL_METACHARACTER);
  });

  it('rejects background execution in args', () => {
    const result = validateCommand({ ...baseRequest, args: ['&'] });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(COMMAND_ERROR_CODES.SHELL_METACHARACTER);
  });

  it('accepts valid args with special chars that are not metacharacters', () => {
    const result = validateCommand({ ...baseRequest, args: ['--flag=value', 'path/to/file', 'normal-arg'] });
    expect(result.ok).toBe(true);
  });

  it('rejects too many args', () => {
    const result = validateCommand({ ...baseRequest, args: new Array(129).fill('arg') });
    expect(result.ok).toBe(false);
  });

  it('rejects args that are too long', () => {
    const result = validateCommand({ ...baseRequest, args: ['a'.repeat(4097)] });
    expect(result.ok).toBe(false);
  });

  it('rejects invalid environment (not an object)', () => {
    const result = validateCommand({ ...baseRequest, environment: 'not-an-object' as any });
    expect(result.ok).toBe(false);
  });

  it('rejects too many env vars', () => {
    const env: Record<string, string> = {};
    for (let i = 0; i < 65; i++) {
      env[`VAR${i}`] = 'value';
    }
    const result = validateCommand({ ...baseRequest, environment: env });
    expect(result.ok).toBe(false);
  });

  it('rejects env key too long', () => {
    const key = 'a'.repeat(257);
    const result = validateCommand({ ...baseRequest, environment: { [key]: 'value' } });
    expect(result.ok).toBe(false);
  });

  it('rejects env value too long', () => {
    const result = validateCommand({ ...baseRequest, environment: { KEY: 'a'.repeat(8193) } });
    expect(result.ok).toBe(false);
  });

  it('accepts valid environment', () => {
    const result = validateCommand({
      ...baseRequest,
      environment: { CUSTOM_VAR: 'value', ANOTHER: 'test' },
    });
    expect(result.ok).toBe(true);
  });

  it('is deterministic for identical inputs', () => {
    const a = validateCommand(baseRequest);
    const b = validateCommand(baseRequest);
    expect(a).toEqual(b);
  });
});