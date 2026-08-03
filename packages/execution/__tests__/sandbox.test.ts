import { describe, it, expect } from 'vitest';
import { createSandbox } from '../src/command/sandbox.js';
import { COMMAND_ERROR_CODES } from '../src/command/errors.js';

describe('createSandbox', () => {
  const workspaceRoot = '/workspace/root';
  const sandbox = createSandbox({ workspaceRoot });

  describe('validateCwd', () => {
    it('accepts workspace root', () => {
      const result = sandbox.validateCwd(workspaceRoot);
      expect(result.ok).toBe(true);
      expect(result.absoluteCwd).toBe(workspaceRoot);
    });

    it('accepts relative path inside workspace', () => {
      const result = sandbox.validateCwd('src/lib');
      expect(result.ok).toBe(true);
      expect(result.absoluteCwd).toBe('/workspace/root/src/lib');
    });

    it('accepts nested relative path', () => {
      const result = sandbox.validateCwd('./src/lib');
      expect(result.ok).toBe(true);
      expect(result.absoluteCwd).toBe('/workspace/root/src/lib');
    });

    it('accepts absolute path inside workspace', () => {
      const result = sandbox.validateCwd('/workspace/root/src');
      expect(result.ok).toBe(true);
      expect(result.absoluteCwd).toBe('/workspace/root/src');
    });

    it('normalizes redundant separators', () => {
      const result = sandbox.validateCwd('src//lib/./utils');
      expect(result.ok).toBe(true);
      expect(result.absoluteCwd).toBe('/workspace/root/src/lib/utils');
    });

    it('rejects empty cwd', () => {
      const result = sandbox.validateCwd('');
      expect(result.ok).toBe(false);
      expect(result.code).toBe(COMMAND_ERROR_CODES.EXTERNAL_CWD);
    });

    it('rejects whitespace-only cwd', () => {
      const result = sandbox.validateCwd('   ');
      expect(result.ok).toBe(false);
      expect(result.code).toBe(COMMAND_ERROR_CODES.EXTERNAL_CWD);
    });

    it('rejects absolute path outside workspace', () => {
      const result = sandbox.validateCwd('/etc/passwd');
      expect(result.ok).toBe(false);
      expect(result.code).toBe(COMMAND_ERROR_CODES.EXTERNAL_CWD);
    });

    it('rejects Windows path outside workspace', () => {
      const result = sandbox.validateCwd('C:\\Windows\\System32');
      expect(result.ok).toBe(false);
      expect(result.code).toBe(COMMAND_ERROR_CODES.EXTERNAL_CWD);
    });

    it('rejects relative traversal', () => {
      const result = sandbox.validateCwd('../etc');
      expect(result.ok).toBe(false);
      expect(result.code).toBe(COMMAND_ERROR_CODES.CWD_TRAVERSAL);
    });

    it('rejects nested traversal', () => {
      const result = sandbox.validateCwd('src/../../etc');
      expect(result.ok).toBe(false);
      expect(result.code).toBe(COMMAND_ERROR_CODES.CWD_TRAVERSAL);
    });

    it('rejects backslash traversal', () => {
      const result = sandbox.validateCwd('src\\..\\..\\etc');
      expect(result.ok).toBe(false);
      expect(result.code).toBe(COMMAND_ERROR_CODES.CWD_TRAVERSAL);
    });

    it('rejects absolute path that resolves outside', () => {
      const result = sandbox.validateCwd('/workspace/root/../../etc');
      expect(result.ok).toBe(false);
      expect(result.code).toBe(COMMAND_ERROR_CODES.EXTERNAL_CWD);
    });
  });

  describe('validatePaths', () => {
    it('accepts paths inside workspace', () => {
      const result = sandbox.validatePaths(['src/file.ts', 'lib/utils.ts']);
      expect(result.ok).toBe(true);
    });

    it('rejects empty path', () => {
      const result = sandbox.validatePaths(['src/file.ts', '']);
      expect(result.ok).toBe(false);
    });

    it('rejects absolute path outside workspace', () => {
      const result = sandbox.validatePaths(['/etc/passwd']);
      expect(result.ok).toBe(false);
      expect(result.code).toBe(COMMAND_ERROR_CODES.EXTERNAL_CWD);
    });

    it('rejects path with traversal', () => {
      const result = sandbox.validatePaths(['src/../../etc/passwd']);
      expect(result.ok).toBe(false);
      expect(result.code).toBe(COMMAND_ERROR_CODES.CWD_TRAVERSAL);
    });
  });

  describe('resolveInSandbox', () => {
    it('resolves relative path', () => {
      const result = sandbox.resolveInSandbox('src/lib/file.ts');
      expect(result).toBe('/workspace/root/src/lib/file.ts');
    });

    it('normalizes path', () => {
      const result = sandbox.resolveInSandbox('./src//lib/./file.ts');
      expect(result).toBe('/workspace/root/src/lib/file.ts');
    });
  });
});