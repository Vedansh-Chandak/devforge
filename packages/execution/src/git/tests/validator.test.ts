import { describe, it, expect } from 'vitest';
import { GIT_ERROR_CODES } from '../errors.js';
import {
  validateRepoRoot,
  validateGitPaths,
  validateCommitMessage,
} from '../validator.js';

const ROOT = '/workspace';
const LIMITS = { maxLength: 500, maxLines: 1 };

describe('validateRepoRoot', () => {
  it('accepts an absolute path', () => {
    expect(validateRepoRoot('/tmp/repo').ok).toBe(true);
  });

  it('accepts a root with trailing slash', () => {
    expect(validateRepoRoot('/tmp/repo/').ok).toBe(true);
  });

  it('rejects an empty string', () => {
    const result = validateRepoRoot('');
    expect(result.ok).toBe(false);
  });

  it('rejects whitespace-only input', () => {
    expect(validateRepoRoot('   ').ok).toBe(false);
  });

  it('rejects a relative path', () => {
    const result = validateRepoRoot('relative/path');
    expect(result.ok).toBe(false);
  });

  it('rejects a non-string input', () => {
    const result = validateRepoRoot(123 as unknown as string);
    expect(result.ok).toBe(false);
  });

  it('is deterministic for identical inputs', () => {
    expect(validateRepoRoot('/tmp/repo')).toEqual(
      validateRepoRoot('/tmp/repo'),
    );
  });
});

describe('validateGitPaths', () => {
  it('accepts a single valid path', () => {
    const result = validateGitPaths(['a.txt'], ROOT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.paths).toEqual(['a.txt']);
  });

  it('accepts and preserves multiple valid paths', () => {
    const result = validateGitPaths(
      ['a.txt', 'src/b.ts', 'deep/nested/c.js'],
      ROOT,
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.paths).toEqual(['a.txt', 'src/b.ts', 'deep/nested/c.js']);
  });

  it('normalizes backslash separators to POSIX', () => {
    const result = validateGitPaths(['a\\b\\c.txt'], ROOT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.paths).toEqual(['a/b/c.txt']);
  });

  it('normalizes dot segments', () => {
    const result = validateGitPaths(['a/./b.txt'], ROOT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.paths).toEqual(['a/b.txt']);
  });

  it('rejects an empty path list', () => {
    const result = validateGitPaths([], ROOT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GIT_ERROR_CODES.INVALID_PATH);
  });

  it('rejects a non-array input', () => {
    const result = validateGitPaths('a.txt' as unknown as string[], ROOT);
    expect(result.ok).toBe(false);
  });

  it('rejects an empty string path', () => {
    const result = validateGitPaths([''], ROOT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GIT_ERROR_CODES.INVALID_PATH);
  });

  it('rejects whitespace-only paths', () => {
    const result = validateGitPaths(['   '], ROOT);
    expect(result.ok).toBe(false);
  });

  it('rejects non-string entries', () => {
    const result = validateGitPaths([42 as unknown as string], ROOT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GIT_ERROR_CODES.INVALID_PATH);
  });

  it('rejects absolute POSIX paths', () => {
    const result = validateGitPaths(['/etc/passwd'], ROOT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GIT_ERROR_CODES.ABSOLUTE_PATH);
  });

  it('rejects absolute Windows paths', () => {
    const result = validateGitPaths(['C:\\Users\\evil.txt'], ROOT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GIT_ERROR_CODES.ABSOLUTE_PATH);
  });

  it('rejects plain traversal', () => {
    const result = validateGitPaths(['..'], ROOT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GIT_ERROR_CODES.TRAVERSAL);
  });

  it('rejects embedded traversal', () => {
    const result = validateGitPaths(['a/../b.txt'], ROOT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GIT_ERROR_CODES.TRAVERSAL);
  });

  it('rejects backslash traversal', () => {
    const result = validateGitPaths(['..\\..\\secret'], ROOT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GIT_ERROR_CODES.TRAVERSAL);
  });

  it('rejects duplicate paths', () => {
    const result = validateGitPaths(['a.txt', 'a.txt'], ROOT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GIT_ERROR_CODES.DUPLICATE_PATH);
  });

  it('rejects duplicates that normalize to the same path', () => {
    const result = validateGitPaths(['a/b.txt', 'a//b.txt'], ROOT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GIT_ERROR_CODES.DUPLICATE_PATH);
  });

  it('rejects duplicates across dot segments', () => {
    const result = validateGitPaths(['a/b.txt', 'a/./b.txt'], ROOT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GIT_ERROR_CODES.DUPLICATE_PATH);
  });

  it('rejects a NUL byte in a path', () => {
    const result = validateGitPaths(['a\u0000b.txt'], ROOT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GIT_ERROR_CODES.INVALID_CHARACTER);
  });

  it('rejects control characters in a path', () => {
    const result = validateGitPaths(['a\u0001b.txt'], ROOT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GIT_ERROR_CODES.CONTROL_CHARACTER);
  });

  it.each(['|', '&', ';', '<', '>', '`', '$'])(
    'rejects the shell metacharacter "%s"',
    (ch) => {
      const result = validateGitPaths([`a${ch}b.txt`], ROOT);
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.code).toBe(GIT_ERROR_CODES.SHELL_METACHARACTER);
    },
  );

  it('accepts paths with spaces and dots', () => {
    const result = validateGitPaths(['my file.txt', 'version.2.txt'], ROOT);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.paths).toEqual(['my file.txt', 'version.2.txt']);
  });

  it('is deterministic across repeated calls', () => {
    const input = ['a.txt', 'src/b.ts'];
    expect(validateGitPaths(input, ROOT)).toEqual(
      validateGitPaths(input, ROOT),
    );
  });

  it('produces identical results regardless of call count', () => {
    const first = validateGitPaths(['x/y.txt'], ROOT);
    const second = validateGitPaths(['x/y.txt'], ROOT);
    expect(first).toEqual(second);
  });
});

describe('validateCommitMessage', () => {
  it('accepts a valid message', () => {
    const result = validateCommitMessage('Fix the thing', LIMITS);
    expect(result.ok).toBe(true);
  });

  it('accepts a message with surrounding whitespace preserved', () => {
    const result = validateCommitMessage('  feature  ', LIMITS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toBe('  feature  ');
  });

  it('rejects an empty message', () => {
    const result = validateCommitMessage('', LIMITS);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.code).toBe(GIT_ERROR_CODES.EMPTY_COMMIT_MESSAGE);
  });

  it('rejects whitespace-only messages', () => {
    const result = validateCommitMessage('   \t ', LIMITS);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.code).toBe(GIT_ERROR_CODES.EMPTY_COMMIT_MESSAGE);
  });

  it('rejects a message exceeding the maximum length', () => {
    const result = validateCommitMessage('a'.repeat(501), LIMITS);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.code).toBe(GIT_ERROR_CODES.COMMIT_MESSAGE_TOO_LONG);
  });

  it('accepts a message at exactly the maximum length', () => {
    const result = validateCommitMessage('a'.repeat(500), LIMITS);
    expect(result.ok).toBe(true);
  });

  it('respects a custom maximum length', () => {
    const result = validateCommitMessage('long message', {
      maxLength: 5,
      maxLines: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.code).toBe(GIT_ERROR_CODES.COMMIT_MESSAGE_TOO_LONG);
  });

  it('rejects multiline messages by default', () => {
    const result = validateCommitMessage('first line\nsecond line', LIMITS);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.code).toBe(GIT_ERROR_CODES.MULTILINE_COMMIT_MESSAGE);
  });

  it('rejects CRLF multiline messages', () => {
    const result = validateCommitMessage('first\r\nsecond', LIMITS);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.code).toBe(GIT_ERROR_CODES.MULTILINE_COMMIT_MESSAGE);
  });

  it('respects a custom line limit', () => {
    const twoLines = { maxLength: 500, maxLines: 2 };
    expect(validateCommitMessage('a\nb', twoLines).ok).toBe(true);
    expect(validateCommitMessage('a\nb\nc', twoLines).ok).toBe(false);
  });

  it('rejects control characters', () => {
    const result = validateCommitMessage('a\tb', LIMITS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(GIT_ERROR_CODES.CONTROL_CHARACTER);
  });

  it.each(['|', '&', ';', '<', '>', '`', '$', '\\'])(
    'rejects the shell metacharacter "%s"',
    (ch) => {
      const result = validateCommitMessage(`message ${ch} more`, LIMITS);
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.code).toBe(GIT_ERROR_CODES.SHELL_METACHARACTER);
    },
  );

  it('accepts messages with spaces and punctuation', () => {
    const result = validateCommitMessage(
      'Fix: handle empty input (closes #42)',
      LIMITS,
    );
    expect(result.ok).toBe(true);
  });

  it('is deterministic for identical inputs', () => {
    expect(validateCommitMessage('same message', LIMITS)).toEqual(
      validateCommitMessage('same message', LIMITS),
    );
  });
});
