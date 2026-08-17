/**
 * @devforge/execution — Patch Parser (DF-016C).
 *
 * Parses model output into CodePatch arrays with defensive recovery.
 * Handles: raw JSON, markdown code blocks, XML tags, embedded JSON.
 * Never throws — returns typed ParseResult.
 */

import type { CodePatch, CodePatchOperation } from '../executor/patch-model.js';
import type { ParseResult, ParseFailure, ParseErrorCode } from './types.js';
import { PatchParseError, ParseError } from './errors.js';
import { OUTPUT_TAGS } from './prompt-builder.js';

/** Result of extracting JSON from output. */
interface ExtractedJson {
  readonly json: string;
  readonly source: 'tags' | 'markdown' | 'raw' | 'recovered';
}

/** Parse model output into CodePatch[]. Never throws. */
export function parsePatches(output: string): ParseResult<readonly CodePatch[]> {
  // Attempt 1: Extract from XML tags
  const tagged = extractFromTags(output, OUTPUT_TAGS.PATCH_START, OUTPUT_TAGS.PATCH_END);
  if (tagged) {
    const parsed = parseJsonArray(tagged.json, tagged.source);
    if (parsed.ok) return validatePatches(parsed.value);
    if (parsed.error.recoveryAttempted) return { ok: false, error: parsed.error };
  }

  // Attempt 2: Extract from markdown code blocks
  const markdown = extractFromMarkdown(output);
  if (markdown) {
    const parsed = parseJsonArray(markdown.json, markdown.source);
    if (parsed.ok) return validatePatches(parsed.value);
    if (parsed.error.recoveryAttempted) return { ok: false, error: parsed.error };
  }

  // Attempt 3: Try raw output as JSON
  const raw = extractRawJson(output);
  if (raw) {
    const parsed = parseJsonArray(raw.json, raw.source);
    if (parsed.ok) return validatePatches(parsed.value);
    if (parsed.error.recoveryAttempted) return { ok: false, error: parsed.error };
  }

  // Attempt 4: Recovery - try to find and fix JSON
  const recovered = attemptJsonRecovery(output);
  if (recovered) {
    const parsed = parseJsonArray(recovered.json, recovered.source);
    if (parsed.ok) return validatePatches(parsed.value);
    if (parsed.error.recoveryAttempted) return { ok: false, error: parsed.error };
  }

  // All attempts failed
  return {
    ok: false,
    error: createParseFailure(
      'NO_TAGS_FOUND',
      'No valid patch output found (no tags, markdown, or parseable JSON)',
      output,
      true,
    ),
  };
}

/** Extract content between XML tags. */
function extractFromTags(
  output: string,
  startTag: string,
  endTag: string,
): ExtractedJson | null {
  const start = output.indexOf(startTag);
  if (start === -1) return null;
  const contentStart = start + startTag.length;
  const end = output.indexOf(endTag, contentStart);
  if (end === -1) return null;
  return { json: output.slice(contentStart, end).trim(), source: 'tags' };
}

/** Extract JSON from markdown code blocks. */
function extractFromMarkdown(output: string): ExtractedJson | null {
  // Match ```json ... ``` or ``` ... ```
  const fenceRegex = /```(?:json)?\s*\n([\s\S]*?)\n```/g;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(output)) !== null) {
    const content = match[1]!.trim();
    if (content.startsWith('[') || content.startsWith('{')) {
      return { json: content, source: 'markdown' };
    }
  }
  return null;
}

/** Try to extract raw JSON from output (starts with [ or {). */
function extractRawJson(output: string): ExtractedJson | null {
  const trimmed = output.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return { json: trimmed, source: 'raw' };
  }
  // Find first [ or { that could be JSON
  const firstBracket = trimmed.indexOf('[');
  const firstBrace = trimmed.indexOf('{');
  let start = -1;
  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    start = firstBracket;
  } else if (firstBrace !== -1) {
    start = firstBrace;
  }
  if (start !== -1) {
    return { json: trimmed.slice(start), source: 'raw' };
  }
  return null;
}

/** Attempt to recover JSON from malformed output. */
function attemptJsonRecovery(output: string): ExtractedJson | null {
  // Strategy: find balanced brackets/braces
  let bestCandidate: string | null = null;
  let maxDepth = 0;

  // Try to find array-like structures
  for (let i = 0; i < output.length; i++) {
    if (output[i] === '[') {
      const candidate = extractBalanced(output, i, '[', ']');
      if (candidate && candidate.length > (bestCandidate?.length ?? 0)) {
        bestCandidate = candidate;
      }
    }
  }

  // Try object-like structures
  for (let i = 0; i < output.length; i++) {
    if (output[i] === '{') {
      const candidate = extractBalanced(output, i, '{', '}');
      if (candidate && candidate.length > (bestCandidate?.length ?? 0)) {
        bestCandidate = candidate;
      }
    }
  }

  if (bestCandidate) {
    // Try to fix common issues
    const fixed = fixCommonJsonIssues(bestCandidate);
    return { json: fixed, source: 'recovered' };
  }

  return null;
}

/** Extract balanced brackets/braces from a starting position. */
function extractBalanced(
  str: string,
  start: number,
  open: '[' | '{',
  close: ']' | '}',
): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;

  for (let i = start; i < str.length; i++) {
    const ch = str[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"' && !escape) {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
  }

  if (end !== -1 && depth === 0) {
    return str.slice(start, end + 1);
  }
  return null;
}

/** Fix common JSON issues in free-model output. */
function fixCommonJsonIssues(json: string): string {
  let fixed = json;

  // Remove trailing commas before ] or }
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1');

  // Fix unescaped newlines in strings (naive but helps)
  // This is a simple fix - real implementation would be more careful
  fixed = fixed.replace(/:\s*"([^"]*)\n([^"]*)"/g, ': "$1\\n$2"');

  // Ensure it's an array (wrap object in array if needed)
  const trimmed = fixed.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    fixed = `[${trimmed}]`;
  }

  return fixed;
}

/** Parse JSON string as array, with recovery. */
function parseJsonArray(json: string, source: ExtractedJson['source']): ParseResult<unknown[]> {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) {
      return {
        ok: false,
        error: createParseFailure(
          'INVALID_SCHEMA',
          'Parsed JSON is not an array',
          json,
          source === 'recovered',
        ),
      };
    }
    return { ok: true, value: parsed };
  } catch (error) {
    if (source === 'recovered') {
      return {
        ok: false,
        error: createParseFailure(
          'MALFORMED_JSON',
          `JSON parse failed after recovery: ${error instanceof Error ? error.message : String(error)}`,
          json,
          true,
        ),
      };
    }
    // Try recovery on parse error
    const fixed = fixCommonJsonIssues(json);
    if (fixed !== json) {
      try {
        const parsed = JSON.parse(fixed);
        if (Array.isArray(parsed)) {
          return { ok: true, value: parsed };
        }
      } catch {
        // Fall through
      }
    }
    return {
      ok: false,
      error: createParseFailure(
        'MALFORMED_JSON',
        `JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
        json,
        true,
      ),
    };
  }
}

/** Validate and normalize parsed patches. */
function validatePatches(raw: unknown[]): ParseResult<readonly CodePatch[]> {
  const patches: CodePatch[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== 'object') {
      return {
        ok: false,
        error: createParseFailure(
          'INVALID_SCHEMA',
          `Patch at index ${i} is not an object`,
          JSON.stringify(raw),
          true,
          raw,
        ),
      };
    }
    const patch = item as Record<string, unknown>;
    if (typeof patch.id !== 'string' || typeof patch.file !== 'string' ||
        typeof patch.operation !== 'string') {
      return {
        ok: false,
        error: createParseFailure(
          'INVALID_SCHEMA',
          `Patch at index ${i} missing required fields (id, file, operation)`,
          JSON.stringify(raw),
          true,
          raw,
        ),
      };
    }
    if (!['CREATE', 'MODIFY', 'DELETE'].includes(patch.operation)) {
      return {
        ok: false,
        error: createParseFailure(
          'INVALID_SCHEMA',
          `Patch at index ${i} has invalid operation: ${patch.operation}`,
          JSON.stringify(raw),
          true,
          raw,
        ),
      };
    }
    if ((patch.operation === 'CREATE' || patch.operation === 'MODIFY') &&
        (typeof patch.newContent !== 'string' || patch.newContent.length === 0)) {
      return {
        ok: false,
        error: createParseFailure(
          'INVALID_SCHEMA',
          `Patch at index ${i} (${patch.operation}) requires non-empty newContent`,
          JSON.stringify(raw),
          true,
          raw,
        ),
      };
    }
    if (patch.operation === 'DELETE' && patch.newContent) {
      return {
        ok: false,
        error: createParseFailure(
          'INVALID_SCHEMA',
          `Patch at index ${i} (DELETE) must not have newContent`,
          JSON.stringify(raw),
          true,
          raw,
        ),
      };
    }
    patches.push({
      id: patch.id,
      file: patch.file,
      operation: patch.operation as CodePatchOperation,
      expectedHash: typeof patch.expectedHash === 'string' ? patch.expectedHash : undefined,
      newContent: typeof patch.newContent === 'string' ? patch.newContent : undefined,
    });
  }
  return { ok: true, value: patches };
}

/** Create a ParseFailure object. */
function createParseFailure(
  code: ParseErrorCode,
  message: string,
  rawOutput: string,
  recoveryAttempted: boolean,
  partialValue?: unknown,
): ParseFailure {
  return { code, message, rawOutput, recoveryAttempted, partialValue };
}