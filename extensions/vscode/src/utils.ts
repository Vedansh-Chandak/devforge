/**
 * @devforge/vscode-extension — Small pure utilities (DF-020).
 *
 * Presentation helpers used by the client and providers. Kept free of any
 * `vscode` import so they are trivially unit-testable in Node.
 */

/** ANSI escape sequence matcher (colors emitted by the CLI output renderers). */
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

/** Strip ANSI color codes from a string. */
export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, '');
}

/** Indent every line of `input` by `spaces` spaces (ignores empty lines). */
export function indent(input: string, spaces = 2): string {
  const pad = ' '.repeat(spaces);
  return input
    .split('\n')
    .map((line) => (line.trim().length === 0 ? line : `${pad}${line}`))
    .join('\n');
}

/** Convert an arbitrary value into a readable string for display. */
export function stringifyValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

/** Generate a deterministic short id from a string (FNV-1a 32-bit, hex). */
export function shortId(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** Generate a timestamped unique id. */
export function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Convert a working-tree GitDiff into unified diff text for a diff editor. */
export function renderUnifiedDiffFromGit(diff: GitDiffLike): string {
  const lines: string[] = [];
  for (const file of diff.files) {
    const newPath = file.newPath || file.oldPath || 'unknown';
    const oldPath = file.oldPath || newPath;
    lines.push(`diff --git a/${oldPath} b/${newPath}`);
    lines.push(`--- a/${oldPath}`);
    lines.push(`+++ b/${newPath}`);
    for (const hunk of file.hunks) {
      const oldStart = hunk.oldStart ?? 0;
      const newStart = hunk.newStart ?? 0;
      const oldCount = hunk.oldLines ?? 0;
      const newCount = hunk.newLines ?? 0;
      const header =
        `@@ -${oldStart}${oldCount === 0 ? ',0' : `,${oldCount}`} ` +
        `+${newStart}${newCount === 0 ? ',0' : `,${newCount}`} @@`;
      lines.push(header);
      for (const line of hunk.lines) {
        const prefix = line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '-' : ' ';
        lines.push(`${prefix}${line.content}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** Structural shape of GitDiff consumed by {@link renderUnifiedDiffFromGit}. */
export interface GitDiffLike {
  readonly files: readonly GitDiffFileLike[];
}

export interface GitDiffFileLike {
  readonly oldPath?: string;
  readonly newPath?: string;
  readonly hunks: readonly GitDiffHunkLike[];
}

export interface GitDiffHunkLike {
  readonly oldStart?: number;
  readonly newStart?: number;
  readonly oldLines?: number;
  readonly newLines?: number;
  readonly lines: readonly GitDiffLineLike[];
}

export interface GitDiffLineLike {
  readonly kind: 'addition' | 'deletion' | 'context';
  readonly content: string;
}

/** Cap text length for display, appending an ellipsis when truncated. */
export function truncate(input: string, max = 200): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max - 3)}...`;
}
