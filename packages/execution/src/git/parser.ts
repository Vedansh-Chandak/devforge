/**
 * @devforge/execution — Pure, deterministic Git output parser (DF-015).
 *
 * Converts CLI output into typed structures. All raw parsing logic lives
 * here; no other module reads git output directly. Every function is pure
 * and deterministic: identical input always yields identical output.
 */
import { GitParseError } from './errors.js';
import type {
  GitBranch,
  GitCommit,
  GitDiff,
  GitDiffFile,
  GitDiffFileStatus,
  GitDiffHunk,
  GitDiffLine,
  GitFileStatus,
  GitFileStatusKind,
  GitRepositoryDetection,
  GitStatus,
} from './types.js';

const FULL_HASH = /^[0-9a-f]{40}$/;

/** Combined index+worktree codes that describe an unresolved conflict. */
const UNMERGED_PAIRS = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

// ── Quoting helpers (porcelain paths are C-style quoted when needed) ──────

/**
 * Decode a possibly C-quoted git path. Quoted paths are wrapped in double
 * quotes with C escapes for bytes git refuses to print raw (non-ASCII,
 * spaces, control characters). Escaped bytes are reassembled and decoded as
 * UTF-8 so `w\303\251.txt` becomes `wé.txt`.
 */
function unquoteGitPath(input: string): string {
  const trimmed = input.trim();
  if (
    trimmed.length < 2 ||
    trimmed[0] !== '"' ||
    trimmed[trimmed.length - 1] !== '"'
  ) {
    return trimmed;
  }
  return unescapeCString(trimmed.slice(1, -1));
}

function unescapeCString(input: string): string {
  const bytes: number[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch !== '\\') {
      bytes.push(ch.codePointAt(0)! & 0xff);
      i += 1;
      continue;
    }
    i += 1;
    if (i >= input.length) {
      bytes.push(0x5c);
      break;
    }
    const esc = input[i]!;
    i += 1;
    switch (esc) {
      case 'a':
        bytes.push(0x07);
        break;
      case 'b':
        bytes.push(0x08);
        break;
      case 'f':
        bytes.push(0x0c);
        break;
      case 'n':
        bytes.push(0x0a);
        break;
      case 'r':
        bytes.push(0x0d);
        break;
      case 't':
        bytes.push(0x09);
        break;
      case 'v':
        bytes.push(0x0b);
        break;
      case '"':
        bytes.push(0x22);
        break;
      case '\\':
        bytes.push(0x5c);
        break;
      case 'x': {
        let hex = '';
        while (
          i < input.length &&
          hex.length < 2 &&
          /[0-9a-fA-F]/.test(input[i]!)
        ) {
          hex += input[i];
          i += 1;
        }
        if (hex.length === 0) {
          throw new GitParseError(
            `Invalid hex escape in quoted path: "${input}"`,
          );
        }
        bytes.push(parseInt(hex, 16));
        break;
      }
      default: {
        if (/[0-7]/.test(esc)) {
          let octal = esc;
          while (
            i < input.length &&
            octal.length < 3 &&
            /[0-7]/.test(input[i]!)
          ) {
            octal += input[i];
            i += 1;
          }
          bytes.push(parseInt(octal, 8));
        } else {
          bytes.push(0x5c);
          bytes.push(esc.codePointAt(0)! & 0xff);
        }
      }
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(bytes),
    );
  } catch {
    return String.fromCharCode(...bytes);
  }
}

/**
 * Find the first occurrence of `needle` that is not inside a double-quoted
 * region. Backslash escapes inside quotes are respected.
 */
function findOutsideQuotes(input: string, needle: string): number {
  let inQuote = false;
  let escaped = false;
  for (let i = 0; i + needle.length <= input.length; i++) {
    const ch = input[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && input.startsWith(needle, i)) {
      return i;
    }
  }
  return -1;
}

/** Split a porcelain entry into original and current path for renames/copies. */
function splitRenamePath(rest: string): { from: string; to: string } | null {
  const arrow = ' -> ';
  const index = findOutsideQuotes(rest, arrow);
  if (index === -1) return null;
  return {
    from: unquoteGitPath(rest.slice(0, index)),
    to: unquoteGitPath(rest.slice(index + arrow.length)),
  };
}

// ── Status parsing ─────────────────────────────────────────────────────────

/** Parse `git status --porcelain=v1` output into a typed status. */
export function parseGitStatus(output: string): GitStatus {
  const entries: GitFileStatus[] = [];
  for (const rawLine of output.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.length === 0) continue;
    if (line.length < 3 || line[2] !== ' ') {
      throw new GitParseError(`Malformed porcelain status line: "${rawLine}"`);
    }
    const indexStatus = line[0]!;
    const worktreeStatus = line[1]!;
    const rest = line.slice(3);
    const rename = splitRenamePath(rest);
    const path = rename ? rename.to : unquoteGitPath(rest);
    entries.push({
      indexStatus,
      worktreeStatus,
      path,
      originalPath: rename ? rename.from : undefined,
      kind: deriveKind(indexStatus, worktreeStatus),
      isUntracked: indexStatus === '?' && worktreeStatus === '?',
      isIgnored: indexStatus === '!' && worktreeStatus === '!',
      isUnmerged: UNMERGED_PAIRS.has(indexStatus + worktreeStatus),
      isRenamed: indexStatus === 'R' || worktreeStatus === 'R',
      isCopied: indexStatus === 'C' || worktreeStatus === 'C',
      isAdded: indexStatus === 'A' || worktreeStatus === 'A',
      isDeleted: indexStatus === 'D' || worktreeStatus === 'D',
      isModified: indexStatus === 'M' || worktreeStatus === 'M',
      isTypeChange: indexStatus === 'T' || worktreeStatus === 'T',
    });
  }
  return { clean: entries.length === 0, entries };
}

function deriveKind(
  indexStatus: string,
  worktreeStatus: string,
): GitFileStatusKind {
  const pair = indexStatus + worktreeStatus;
  if (indexStatus === '?' && worktreeStatus === '?') return 'untracked';
  if (indexStatus === '!' && worktreeStatus === '!') return 'ignored';
  if (UNMERGED_PAIRS.has(pair)) return 'unmerged';
  if (indexStatus === 'R' || worktreeStatus === 'R') return 'renamed';
  if (indexStatus === 'C' || worktreeStatus === 'C') return 'copied';
  if (indexStatus === 'A' || worktreeStatus === 'A') return 'added';
  if (indexStatus === 'D' || worktreeStatus === 'D') return 'deleted';
  if (indexStatus === 'T' || worktreeStatus === 'T') return 'typechange';
  if (indexStatus === 'M' || worktreeStatus === 'M') return 'modified';
  return 'unknown';
}

// ── Diff parsing ───────────────────────────────────────────────────────────

interface DiffHunkBuilder {
  readonly header: string;
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: GitDiffLine[];
}

interface DiffFileBuilder {
  readonly headerLines: string[];
  readonly hunks: DiffHunkBuilder[];
  oldPath: string;
  newPath: string;
  status: GitDiffFileStatus;
  oldMode?: string;
  newMode?: string;
  similarity?: number;
  isBinary: boolean;
}

/** Parse unified diff output from `git diff`/`git diff --cached`. */
export function parseGitDiff(output: string): GitDiff {
  const rawLines = output.split('\n');
  while (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
    rawLines.pop();
  }

  const files: GitDiffFile[] = [];
  let current: DiffFileBuilder | null = null;

  for (const raw of rawLines) {
    if (raw.startsWith('diff --git ')) {
      if (current) files.push(toDiffFile(current));
      current = {
        headerLines: [raw],
        hunks: [],
        oldPath: '',
        newPath: '',
        status: 'modified',
        isBinary: false,
      };
      const headerPaths = parseDiffGitHeader(raw);
      current.oldPath = headerPaths.oldPath;
      current.newPath = headerPaths.newPath;
      continue;
    }

    if (current === null) {
      throw new GitParseError(
        `Diff output starts outside a file section: "${raw}"`,
      );
    }

    if (raw.startsWith('@@ ')) {
      current.hunks.push({ header: raw, ...parseHunkHeader(raw), lines: [] });
      continue;
    }

    const activeHunk = current.hunks[current.hunks.length - 1];
    if (activeHunk !== undefined) {
      const line = parseDiffContentLine(raw);
      activeHunk.lines.push(line);
      continue;
    }

    if (raw.startsWith('--- ')) {
      current.oldPath = parsePathHeader(raw, '--- ');
    } else if (raw.startsWith('+++ ')) {
      current.newPath = parsePathHeader(raw, '+++ ');
    } else if (raw.startsWith('new file mode ')) {
      current.status = 'added';
      current.newMode = raw.slice('new file mode '.length).trim();
    } else if (raw.startsWith('deleted file mode ')) {
      current.status = 'deleted';
      current.oldMode = raw.slice('deleted file mode '.length).trim();
    } else if (raw.startsWith('old mode ')) {
      current.oldMode = raw.slice('old mode '.length).trim();
    } else if (raw.startsWith('new mode ')) {
      current.newMode = raw.slice('new mode '.length).trim();
    } else if (raw.startsWith('similarity index ')) {
      current.status = 'renamed';
      current.similarity = parsePercentage(raw, 'similarity index ');
    } else if (raw.startsWith('dissimilarity index ')) {
      current.status = 'renamed';
    } else if (raw.startsWith('rename from ')) {
      current.status = 'renamed';
      current.oldPath = raw.slice('rename from '.length).trim();
    } else if (raw.startsWith('rename to ')) {
      current.status = 'renamed';
      current.newPath = raw.slice('rename to '.length).trim();
    } else if (raw.startsWith('copy from ')) {
      current.status = 'copied';
      current.oldPath = raw.slice('copy from '.length).trim();
    } else if (raw.startsWith('copy to ')) {
      current.status = 'copied';
      current.newPath = raw.slice('copy to '.length).trim();
    } else if (
      raw.startsWith('Binary files ') ||
      raw.startsWith('GIT binary patch') ||
      raw.startsWith('Binary patch')
    ) {
      current.isBinary = true;
    }
    current.headerLines.push(raw);
  }
  if (current) files.push(toDiffFile(current));

  return { empty: files.length === 0, text: output, files };
}

function toDiffFile(builder: DiffFileBuilder): GitDiffFile {
  return {
    oldPath: builder.oldPath,
    newPath: builder.newPath,
    status: builder.status,
    oldMode: builder.oldMode,
    newMode: builder.newMode,
    similarity: builder.similarity,
    isBinary: builder.isBinary,
    headerLines: builder.headerLines,
    hunks: builder.hunks.map((hunk) => ({
      header: hunk.header,
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      lines: hunk.lines,
    })),
  };
}

/** Parse a `--- a/path` or `+++ b/path` line into the repository path. */
function parsePathHeader(raw: string, prefix: string): string {
  let value = raw.slice(prefix.length).trim();
  if (value.startsWith('a/')) value = value.slice(2);
  else if (value.startsWith('b/')) value = value.slice(2);
  return unquoteGitPath(value);
}

/** Best-effort path extraction from the `diff --git a/x b/y` line. */
function parseDiffGitHeader(raw: string): {
  readonly oldPath: string;
  readonly newPath: string;
} {
  let body = raw.slice('diff --git '.length);
  if (body.startsWith('a/')) body = body.slice(2);
  const index = findOutsideQuotes(body, ' b/');
  if (index === -1) {
    const single = unquoteGitPath(body);
    return { oldPath: single, newPath: single };
  }
  return {
    oldPath: unquoteGitPath(body.slice(0, index)),
    newPath: unquoteGitPath(body.slice(index + 3).replace(/^b\//, '')),
  };
}

/** Parse `@@ -a,b +c,d @@ ...` into numeric ranges. */
function parseHunkHeader(
  raw: string,
): Pick<GitDiffHunk, 'oldStart' | 'oldLines' | 'newStart' | 'newLines'> {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
  if (match === null) {
    throw new GitParseError(`Malformed diff hunk header: "${raw}"`);
  }
  const oldStart = Number(match[1]);
  const newStart = Number(match[3]);
  const oldLines =
    match[2] !== undefined ? Number(match[2]) : oldStart === 0 ? 0 : 1;
  const newLines =
    match[4] !== undefined ? Number(match[4]) : newStart === 0 ? 0 : 1;
  return { oldStart, oldLines, newStart, newLines };
}

function parseDiffContentLine(raw: string): GitDiffLine {
  if (raw.startsWith(' ')) return { kind: 'context', content: raw.slice(1) };
  if (raw.startsWith('+')) return { kind: 'addition', content: raw.slice(1) };
  if (raw.startsWith('-')) return { kind: 'deletion', content: raw.slice(1) };
  if (raw.startsWith('\\'))
    return { kind: 'no-newline', content: raw.slice(1) };
  throw new GitParseError(`Unrecognized diff content line: "${raw}"`);
}

function parsePercentage(raw: string, prefix: string): number {
  const value = raw.slice(prefix.length).trim().replace(/%$/, '');
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Reconstruct unified diff text from a typed {@link GitDiff}. Header lines
 * are preserved verbatim, so `renderUnifiedDiff(parse(output))` reproduces
 * the original output (minus the trailing newline).
 */
export function renderUnifiedDiff(diff: GitDiff): string {
  const blocks: string[] = [];
  for (const file of diff.files) {
    const lines: string[] = [...file.headerLines];
    for (const hunk of file.hunks) {
      lines.push(hunk.header);
      for (const diffLine of hunk.lines) {
        lines.push(renderDiffLine(diffLine));
      }
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n');
}

function renderDiffLine(line: GitDiffLine): string {
  switch (line.kind) {
    case 'context':
      return ` ${line.content}`;
    case 'addition':
      return `+${line.content}`;
    case 'deletion':
      return `-${line.content}`;
    case 'no-newline':
      return `\\${line.content}`;
  }
}

// ── Branch parsing ─────────────────────────────────────────────────────────

/**
 * Parse `git branch --format='%(HEAD)%00%(refname:short)%00%(objectname:short)'`
 * output into typed branches. Each line is `*` (or empty) + NUL + name + NUL + hash.
 */
export function parseGitBranches(output: string): readonly GitBranch[] {
  const branches: GitBranch[] = [];
  for (const raw of output.split('\n')) {
    if (raw === '') continue;
    const parts = raw.split('\u0000');
    if (
      parts.length < 2 ||
      parts[0] === undefined ||
      parts[1] === undefined ||
      parts[1] === ''
    ) {
      throw new GitParseError(
        `Malformed branch line: "${JSON.stringify(raw)}"`,
      );
    }
    const shortHash = parts[2];
    branches.push({
      isCurrent: parts[0] === '*',
      name: parts[1],
      shortHash:
        shortHash !== undefined && shortHash !== '' ? shortHash : undefined,
    });
  }
  return branches;
}

/** Parse `git branch --show-current` output. Returns null for detached/unborn HEAD. */
export function parseCurrentBranch(output: string): string | null {
  const trimmed = output.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Parse `git rev-parse HEAD` output into a commit. */
export function parseHead(output: string): GitCommit {
  const hash = output.trim();
  if (!FULL_HASH.test(hash)) {
    throw new GitParseError(
      `Expected a 40-character commit hash, got: "${output.trim()}"`,
    );
  }
  return { hash, shortHash: hash.slice(0, 7) };
}

/**
 * Parse `git rev-parse --is-inside-work-tree --show-toplevel` output into a
 * repository detection. First line is `true`/`false`; second is the root.
 */
export function parseRepositoryDetection(
  output: string,
): GitRepositoryDetection {
  const lines = output.trim().split('\n');
  if (lines.length < 1 || lines[0] === undefined) {
    throw new GitParseError('Expected rev-parse detection output');
  }
  const inside = lines[0].trim();
  if (inside !== 'true' && inside !== 'false') {
    throw new GitParseError(
      `Unexpected --is-inside-work-tree value: "${inside}"`,
    );
  }
  return {
    isRepository: inside === 'true',
    root: lines[1] !== undefined ? lines[1].trim() : null,
  };
}
