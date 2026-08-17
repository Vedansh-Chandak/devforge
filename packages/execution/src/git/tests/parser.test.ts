import { describe, it, expect } from 'vitest';
import { GitParseError } from '../errors.js';
import {
  parseGitStatus,
  parseGitDiff,
  renderUnifiedDiff,
  parseGitBranches,
  parseCurrentBranch,
  parseHead,
  parseRepositoryDetection,
} from '../parser.js';

const HASH = '0123456789abcdef0123456789abcdef01234567';

describe('parseGitStatus', () => {
  it('parses empty output into a clean status', () => {
    const status = parseGitStatus('');
    expect(status.clean).toBe(true);
    expect(status.entries).toEqual([]);
  });

  it('parses an untracked entry', () => {
    const status = parseGitStatus('?? file.txt\n');
    expect(status.clean).toBe(false);
    expect(status.entries).toHaveLength(1);
    expect(status.entries[0]).toMatchObject({
      indexStatus: '?',
      worktreeStatus: '?',
      path: 'file.txt',
      kind: 'untracked',
      isUntracked: true,
    });
  });

  it('parses a worktree modification', () => {
    const entry = parseGitStatus(' M src/a.ts\n').entries[0]!;
    expect(entry).toMatchObject({
      indexStatus: ' ',
      worktreeStatus: 'M',
      path: 'src/a.ts',
      kind: 'modified',
    });
    expect(entry.isModified).toBe(true);
    expect(entry.isAdded).toBe(false);
  });

  it('parses a staged (index) modification', () => {
    const entry = parseGitStatus('M  src/a.ts\n').entries[0]!;
    expect(entry).toMatchObject({
      indexStatus: 'M',
      worktreeStatus: ' ',
      path: 'src/a.ts',
      kind: 'modified',
    });
  });

  it('parses a staged addition', () => {
    const entry = parseGitStatus('A  new.txt\n').entries[0]!;
    expect(entry.kind).toBe('added');
    expect(entry.isAdded).toBe(true);
  });

  it('parses a staged deletion', () => {
    const entry = parseGitStatus('D  old.txt\n').entries[0]!;
    expect(entry.kind).toBe('deleted');
    expect(entry.isDeleted).toBe(true);
  });

  it('parses a rename with original and new path', () => {
    const entry = parseGitStatus('R  old.txt -> new.txt\n').entries[0]!;
    expect(entry).toMatchObject({
      indexStatus: 'R',
      path: 'new.txt',
      originalPath: 'old.txt',
      kind: 'renamed',
      isRenamed: true,
    });
  });

  it('parses a rename whose new path is quoted', () => {
    const entry = parseGitStatus('R  a.txt -> "renamed file.txt"\n')
      .entries[0]!;
    expect(entry.path).toBe('renamed file.txt');
    expect(entry.originalPath).toBe('a.txt');
    expect(entry.isRenamed).toBe(true);
  });

  it('parses a quoted path with a space', () => {
    const entry = parseGitStatus('?? "has space.txt"\n').entries[0]!;
    expect(entry.path).toBe('has space.txt');
    expect(entry.isUntracked).toBe(true);
  });

  it('decodes octal-escaped UTF-8 path segments', () => {
    const entry = parseGitStatus('?? "w\\303\\251.txt"\n').entries[0]!;
    expect(entry.path).toBe('wé.txt');
  });

  it('parses an unmerged entry', () => {
    const entry = parseGitStatus('UU conflict.txt\n').entries[0]!;
    expect(entry.kind).toBe('unmerged');
    expect(entry.isUnmerged).toBe(true);
  });

  it('parses a typechange entry', () => {
    const entry = parseGitStatus('T  link\n').entries[0]!;
    expect(entry.kind).toBe('typechange');
    expect(entry.isTypeChange).toBe(true);
  });

  it('parses an ignored entry', () => {
    const entry = parseGitStatus('!! ignored.log\n').entries[0]!;
    expect(entry.kind).toBe('ignored');
    expect(entry.isIgnored).toBe(true);
  });

  it('strips a trailing carriage return from each line', () => {
    const entry = parseGitStatus('?? file.txt\r\n').entries[0]!;
    expect(entry.path).toBe('file.txt');
  });

  it('preserves entry order and reports clean=false for multiple entries', () => {
    const status = parseGitStatus(' M a.txt\n?? b.txt\nA  c.txt\n');
    expect(status.clean).toBe(false);
    expect(status.entries.map((entry) => entry.path)).toEqual([
      'a.txt',
      'b.txt',
      'c.txt',
    ]);
  });

  it('throws GitParseError for a line that is too short', () => {
    expect(() => parseGitStatus('??\n')).toThrow(GitParseError);
  });

  it('throws GitParseError for a line without the separator space', () => {
    expect(() => parseGitStatus('??x\n')).toThrow(GitParseError);
  });

  it('is deterministic for identical inputs', () => {
    const input = ' M a.txt\n?? b.txt\nR  old.txt -> new.txt\n';
    expect(parseGitStatus(input)).toEqual(parseGitStatus(input));
  });
});

describe('parseGitDiff', () => {
  const MODIFIED_DIFF = [
    'diff --git a/a.txt b/a.txt',
    'index ce01362..25bab75 100644',
    '--- a/a.txt',
    '+++ b/a.txt',
    '@@ -1 +1,3 @@',
    ' hello',
    '+added1',
    '+added2',
    '',
  ].join('\n');

  it('parses empty output into an empty diff', () => {
    const diff = parseGitDiff('');
    expect(diff.empty).toBe(true);
    expect(diff.files).toEqual([]);
    expect(diff.text).toBe('');
  });

  it('parses a modified file with a single hunk', () => {
    const diff = parseGitDiff(MODIFIED_DIFF);
    expect(diff.empty).toBe(false);
    expect(diff.files).toHaveLength(1);
    const file = diff.files[0]!;
    expect(file.oldPath).toBe('a.txt');
    expect(file.newPath).toBe('a.txt');
    expect(file.status).toBe('modified');
    expect(file.isBinary).toBe(false);
    expect(file.hunks).toHaveLength(1);
    expect(file.hunks[0]!).toMatchObject({
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 3,
    });
    expect(file.hunks[0]!.lines).toEqual([
      { kind: 'context', content: 'hello' },
      { kind: 'addition', content: 'added1' },
      { kind: 'addition', content: 'added2' },
    ]);
  });

  it('parses an added file with new file mode and /dev/null old path', () => {
    const input = [
      'diff --git a/new.txt b/new.txt',
      'new file mode 100644',
      'index 0000000..aa39060',
      '--- /dev/null',
      '+++ b/new.txt',
      '@@ -0,0 +1 @@',
      '+content',
      '',
    ].join('\n');
    const file = parseGitDiff(input).files[0]!;
    expect(file.status).toBe('added');
    expect(file.oldPath).toBe('/dev/null');
    expect(file.newPath).toBe('new.txt');
    expect(file.newMode).toBe('100644');
    expect(file.hunks[0]!.oldLines).toBe(0);
    expect(file.hunks[0]!.newLines).toBe(1);
  });

  it('parses a deleted file', () => {
    const input = [
      'diff --git a/old.txt b/old.txt',
      'deleted file mode 100644',
      'index cc628cc..0000000',
      '--- a/old.txt',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-bye',
      '',
    ].join('\n');
    const file = parseGitDiff(input).files[0]!;
    expect(file.status).toBe('deleted');
    expect(file.newPath).toBe('/dev/null');
    expect(file.oldPath).toBe('old.txt');
    expect(file.hunks[0]!.lines).toEqual([
      { kind: 'deletion', content: 'bye' },
    ]);
  });

  it('parses a rename with similarity', () => {
    const input = [
      'diff --git a/sub/b.txt b/sub/c.txt',
      'similarity index 100%',
      'rename from sub/b.txt',
      'rename to sub/c.txt',
      '',
    ].join('\n');
    const file = parseGitDiff(input).files[0]!;
    expect(file.status).toBe('renamed');
    expect(file.oldPath).toBe('sub/b.txt');
    expect(file.newPath).toBe('sub/c.txt');
    expect(file.similarity).toBe(100);
    expect(file.hunks).toEqual([]);
  });

  it('parses a binary file without hunks', () => {
    const input = [
      'diff --git a/bin.bin b/bin.bin',
      'new file mode 100644',
      'index 0000000..8352675',
      'Binary files /dev/null and b/bin.bin differ',
      '',
    ].join('\n');
    const file = parseGitDiff(input).files[0]!;
    expect(file.isBinary).toBe(true);
    expect(file.status).toBe('added');
    expect(file.hunks).toEqual([]);
  });

  it('parses a mode-only change with no hunks', () => {
    const input = [
      'diff --git a/script.sh b/script.sh',
      'old mode 100644',
      'new mode 100755',
      '',
    ].join('\n');
    const file = parseGitDiff(input).files[0]!;
    expect(file.oldMode).toBe('100644');
    expect(file.newMode).toBe('100755');
    expect(file.status).toBe('modified');
    expect(file.hunks).toEqual([]);
  });

  it('parses multiple file sections', () => {
    const input = [
      'diff --git a/a.txt b/a.txt',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'diff --git a/b.txt b/b.txt',
      'index 1..2 100644',
      '--- a/b.txt',
      '+++ b/b.txt',
      '@@ -1 +1 @@',
      '+fresh',
      '',
    ].join('\n');
    const files = parseGitDiff(input).files;
    expect(files).toHaveLength(2);
    expect(files[0]!.newPath).toBe('a.txt');
    expect(files[1]!.newPath).toBe('b.txt');
  });

  it('parses the no-newline marker', () => {
    const input = [
      'diff --git a/x b/x',
      'index 1..2 100644',
      '--- a/x',
      '+++ b/x',
      '@@ -1 +1 @@',
      '-tail',
      '\\ No newline at end of file',
      '+head',
      '\\ No newline at end of file',
      '',
    ].join('\n');
    const file = parseGitDiff(input).files[0]!;
    expect(file.hunks[0]!.lines).toEqual([
      { kind: 'deletion', content: 'tail' },
      { kind: 'no-newline', content: ' No newline at end of file' },
      { kind: 'addition', content: 'head' },
      { kind: 'no-newline', content: ' No newline at end of file' },
    ]);
  });

  it('parses quoted paths from the diff --git header', () => {
    const input = [
      'diff --git a/"my file.txt" b/"my file.txt"',
      'index 1..2 100644',
      '--- a/"my file.txt"',
      '+++ b/"my file.txt"',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      '',
    ].join('\n');
    const file = parseGitDiff(input).files[0]!;
    expect(file.oldPath).toBe('my file.txt');
    expect(file.newPath).toBe('my file.txt');
  });

  it('preserves the original text verbatim', () => {
    expect(parseGitDiff(MODIFIED_DIFF).text).toBe(MODIFIED_DIFF);
  });

  it('renders a parsed diff back to the original text', () => {
    const input = MODIFIED_DIFF.replace(/\n+$/, '');
    expect(renderUnifiedDiff(parseGitDiff(input))).toBe(input);
  });

  it('renders multi-file, rename, and binary diffs losslessly', () => {
    const input = [
      'diff --git a/a.txt b/a.txt',
      'index ce01362..25bab75 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1,3 @@',
      ' hello',
      '+added1',
      '+added2',
      'diff --git a/sub/b.txt b/sub/c.txt',
      'similarity index 100%',
      'rename from sub/b.txt',
      'rename to sub/c.txt',
      'diff --git a/bin.bin b/bin.bin',
      'new file mode 100644',
      'index 0000000..8352675',
      'Binary files /dev/null and b/bin.bin differ',
    ].join('\n');
    expect(renderUnifiedDiff(parseGitDiff(input))).toBe(input);
  });

  it('renders a diff with no-newline markers losslessly', () => {
    const input = [
      'diff --git a/x b/x',
      'index 1..2 100644',
      '--- a/x',
      '+++ b/x',
      '@@ -1 +1 @@',
      '-tail',
      '\\ No newline at end of file',
      '+head',
      '\\ No newline at end of file',
    ].join('\n');
    expect(renderUnifiedDiff(parseGitDiff(input))).toBe(input);
  });

  it('is deterministic for identical inputs', () => {
    expect(parseGitDiff(MODIFIED_DIFF)).toEqual(parseGitDiff(MODIFIED_DIFF));
  });

  it('renderUnifiedDiff is deterministic for identical diffs', () => {
    const diff = parseGitDiff(MODIFIED_DIFF);
    expect(renderUnifiedDiff(diff)).toBe(renderUnifiedDiff(diff));
  });

  it('throws GitParseError for a malformed hunk header', () => {
    const input = [
      'diff --git a/x b/x',
      '--- a/x',
      '+++ b/x',
      '@@ not a hunk @@',
      '+a',
      '',
    ].join('\n');
    expect(() => parseGitDiff(input)).toThrow(GitParseError);
  });

  it('throws GitParseError when output starts outside a file section', () => {
    expect(() => parseGitDiff('random text\n')).toThrow(GitParseError);
  });
});

describe('parseGitBranches', () => {
  const line = (head: string, name: string, hash: string): string =>
    `${head}\u0000${name}\u0000${hash}`;

  it('parses empty output into no branches', () => {
    expect(parseGitBranches('')).toEqual([]);
  });

  it('parses a single current branch', () => {
    const branches = parseGitBranches(`${line('*', 'main', 'abc1234')}\n`);
    expect(branches).toEqual([
      { isCurrent: true, name: 'main', shortHash: 'abc1234' },
    ]);
  });

  it('parses multiple branches with one current', () => {
    const branches = parseGitBranches(
      `${line('*', 'main', 'abc1234')}\n${line('', 'feature', 'def5678')}\n`,
    );
    expect(branches).toEqual([
      { isCurrent: true, name: 'main', shortHash: 'abc1234' },
      { isCurrent: false, name: 'feature', shortHash: 'def5678' },
    ]);
  });

  it('parses a branch without a hash', () => {
    const branches = parseGitBranches(`${line('', 'unborn', '')}\n`);
    expect(branches).toEqual([
      { isCurrent: false, name: 'unborn', shortHash: undefined },
    ]);
  });

  it('is deterministic for identical inputs', () => {
    const input = `${line('*', 'main', 'abc1234')}\n${line('', 'feature', 'def5678')}\n`;
    expect(parseGitBranches(input)).toEqual(parseGitBranches(input));
  });

  it('throws GitParseError for a malformed branch line', () => {
    expect(() => parseGitBranches('not-a-branch\n')).toThrow(GitParseError);
  });
});

describe('parseCurrentBranch', () => {
  it('parses a normal branch name', () => {
    expect(parseCurrentBranch('main\n')).toBe('main');
  });

  it('parses a namespaced branch name', () => {
    expect(parseCurrentBranch('feature/foo\n')).toBe('feature/foo');
  });

  it('returns null for empty output (detached HEAD)', () => {
    expect(parseCurrentBranch('')).toBeNull();
  });

  it('returns null for whitespace-only output', () => {
    expect(parseCurrentBranch('  \n')).toBeNull();
  });

  it('is deterministic for identical inputs', () => {
    expect(parseCurrentBranch('main\n')).toBe(parseCurrentBranch('main\n'));
  });
});

describe('parseHead', () => {
  it('parses a full 40-character hash', () => {
    const commit = parseHead(`${HASH}\n`);
    expect(commit.hash).toBe(HASH);
    expect(commit.shortHash).toBe(HASH.slice(0, 7));
  });

  it('throws GitParseError for a short hash', () => {
    expect(() => parseHead('abc1234\n')).toThrow(GitParseError);
  });

  it('throws GitParseError for non-hex output', () => {
    expect(() =>
      parseHead('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz\n'),
    ).toThrow(GitParseError);
  });

  it('is deterministic for identical inputs', () => {
    expect(parseHead(`${HASH}\n`)).toEqual(parseHead(`${HASH}\n`));
  });
});

describe('parseRepositoryDetection', () => {
  it('parses a repository detection with a root', () => {
    expect(parseRepositoryDetection('true\n/private/tmp/repo\n')).toEqual({
      isRepository: true,
      root: '/private/tmp/repo',
    });
  });

  it('parses a non-repository detection', () => {
    expect(parseRepositoryDetection('false\n')).toEqual({
      isRepository: false,
      root: null,
    });
  });

  it('parses a detection without a root line', () => {
    expect(parseRepositoryDetection('true')).toEqual({
      isRepository: true,
      root: null,
    });
  });

  it('throws GitParseError for an unexpected value', () => {
    expect(() => parseRepositoryDetection('maybe\n')).toThrow(GitParseError);
  });

  it('throws GitParseError for empty output', () => {
    expect(() => parseRepositoryDetection('')).toThrow(GitParseError);
  });

  it('is deterministic for identical inputs', () => {
    const input = 'true\n/private/tmp/repo\n';
    expect(parseRepositoryDetection(input)).toEqual(
      parseRepositoryDetection(input),
    );
  });
});
