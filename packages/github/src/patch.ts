/**
 * @devforge/github — Patch generation (DF-021).
 *
 * Pure, deterministic helpers that turn review findings and changed-line
 * context into concrete suggested patches (old snippet → new snippet) and
 * apply simple line-replacement patches to in-memory file content. Works
 * hand-in-hand with the diff module and the review engine.
 */

import type { ChangedLine } from './diff.js';

export interface SuggestedPatch {
  /** The affected file path. */
  readonly file: string;
  /** 1-based line number in the new file the change anchors on. */
  readonly line: number;
  /** Original snippet at the location (may be empty for insertions). */
  readonly original: string;
  /** Replacement snippet. */
  readonly replacement: string;
  /** Short human-readable label. */
  readonly title: string;
}

export interface PatchResult {
  readonly applied: boolean;
  readonly reason: string;
  readonly content: string;
}

/**
 * Apply a set of suggested patches to file contents, keyed by path.
 * Patches are applied bottom-up (highest line first) to keep offsets valid.
 * Deterministic: invalid anchors are skipped with a reason.
 */
export function applyPatches(
  files: ReadonlyMap<string, string>,
  patches: readonly SuggestedPatch[],
): Map<string, PatchResult> {
  const results = new Map<string, PatchResult>();
  const byFile = new Map<string, SuggestedPatch[]>();
  for (const patch of patches) {
    const list = byFile.get(patch.file) ?? [];
    list.push(patch);
    byFile.set(patch.file, list);
  }

  for (const [file, list] of byFile) {
    const original = files.get(file);
    if (original === undefined) {
      results.set(file, { applied: false, reason: 'file not present in workspace', content: '' });
      continue;
    }
    const content = applyToText(original, [...list].sort((a, b) => b.line - a.line));
    results.set(file, content);
  }

  return results;
}

/** Apply line-anchored replacement patches to a text document. */
export function applyToText(
  text: string,
  patches: readonly SuggestedPatch[],
): PatchResult {
  const lines = text.split('\n');
  let failed = false;
  let failureReason = '';

  for (const patch of [...patches].sort((a, b) => b.line - a.line)) {
    const index = patch.line - 1;
    if (index < 0 || index >= lines.length) {
      failed = true;
      failureReason = `line ${patch.line} out of range`;
      continue;
    }
    const current = lines[index] ?? '';
    if (patch.original.length > 0 && !current.includes(patch.original)) {
      failed = true;
      failureReason = `original snippet not found at line ${patch.line}`;
      continue;
    }

    if (patch.original.length === 0) {
      // Insertion: prepend the replacement to the anchor line.
      lines[index] = `${patch.replacement}${current}`;
    } else if (current.trim() === patch.original.trim()) {
      lines[index] = patch.replacement;
    } else {
      // Partial match inside a longer line: replace the first occurrence.
      lines[index] = current.replace(patch.original, patch.replacement);
    }
  }

  return {
    applied: !failed,
    reason: failed ? failureReason : 'ok',
    content: lines.join('\n'),
  };
}

/** A single-line insertion suggested patch. */
export function insertion(
  file: string,
  line: number,
  snippet: string,
  title = 'Insert snippet',
): SuggestedPatch {
  return { file, line, original: '', replacement: snippet, title };
}

/** A single-line replacement suggested patch. */
export function replacement(
  file: string,
  line: number,
  original: string,
  next: string,
  title = 'Replace line',
): SuggestedPatch {
  return { file, line, original, replacement: next, title };
}

/** Build a suggested patch from a changed line's exact content. */
export function fromChangedLine(
  line: ChangedLine,
  replacementText: string,
  title = 'Fix',
): SuggestedPatch {
  const lineNumber = line.line.newLineNumber ?? line.hunk.newStart;
  return {
    file: line.path,
    line: lineNumber,
    original: line.line.content,
    replacement: replacementText,
    title,
  };
}

/** Stable, deterministic hash of a patch set (for dedupe). */
export function patchFingerprint(patches: readonly SuggestedPatch[]): string {
  const serialized = [...patches]
    .sort((a, b) => `${a.file}:${a.line}:${a.title}`.localeCompare(`${b.file}:${b.line}:${b.title}`))
    .map((p) => `${p.file}:${p.line}:${p.original}->${p.replacement}`)
    .join('|');
  let hash = 0;
  for (let i = 0; i < serialized.length; i++) {
    hash = (hash * 31 + serialized.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}
