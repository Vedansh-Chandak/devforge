/**
 * Request parser (DF-012).
 *
 * Responsible ONLY for request normalization, whitespace cleanup and
 * basic intent extraction. Contains no planning logic — decisions about
 * plan shape, ordering, complexity and risk live in planner.ts.
 */

/** Coarse intent of a developer request, detected by keyword heuristics. */
export type RequestIntent =
  | 'implement'
  | 'refactor'
  | 'fix'
  | 'search'
  | 'explain'
  | 'destructive'
  | 'unknown';

/** Normalized view of a developer request. */
export interface ParsedRequest {
  /** The raw input, unchanged. */
  readonly original: string;
  /** Whitespace-collapsed, trimmed input. */
  readonly normalized: string;
  /** Lowercased normalized input. */
  readonly lower: string;
  /** Lowercased alphanumeric tokens of the normalized input. */
  readonly tokens: readonly string[];
  /** Detected intent (deterministic). */
  readonly intent: RequestIntent;
  /** Keywords that matched the detected intent, in deterministic order. */
  readonly detectedKeywords: readonly string[];
}

/** Single-word keywords matched against exact tokens. */
const SINGLE_WORD_KEYWORDS: Readonly<Record<RequestIntent, readonly string[]>> = {
  destructive: ['delete', 'remove', 'drop', 'overwrite', 'erase', 'reset'],
  implement: ['implement', 'create', 'add', 'build', 'scaffold'],
  refactor: ['refactor', 'restructure', 'rename', 'reorganize', 'simplify', 'extract'],
  fix: ['fix', 'bug', 'repair', 'patch', 'broken'],
  search: ['search', 'find', 'locate'],
  explain: ['explain', 'describe'],
  unknown: [],
};

/** Multi-word phrases matched against the lowercased text. */
const PHRASE_KEYWORDS: Readonly<Record<RequestIntent, readonly string[]>> = {
  destructive: [],
  implement: ['new feature', 'set up', 'add support'],
  refactor: ['clean up'],
  fix: ['error handling'],
  search: ['look up', 'where is'],
  explain: ['how does', 'how do', 'what is', 'why does'],
  unknown: [],
};

/**
 * Detection priority (safety-first): destructive intent is checked
 * before productive intents so destructive requests are never misread
 * as benign.
 */
const INTENT_PRIORITY: readonly RequestIntent[] = [
  'destructive',
  'implement',
  'refactor',
  'fix',
  'search',
  'explain',
];

/** Collapse leading/trailing whitespace and runs of internal whitespace. */
function normalize(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** Lowercased alphanumeric tokens (hyphen/apostrophe word-joins kept). */
function tokenize(input: string): string[] {
  const matches = input.toLowerCase().match(/[a-z0-9]+(?:[-'][a-z0-9]+)*/g);
  return matches ?? [];
}

/**
 * Parse a natural-language developer request into a normalized form with
 * a detected intent. Purely deterministic — no planning decisions here.
 */
export function parseRequest(input: string): ParsedRequest {
  const original = input;
  const normalized = normalize(input);
  const lower = normalized.toLowerCase();
  const tokens = tokenize(normalized);

  const tokenSet = new Set(tokens);
  let intent: RequestIntent = 'unknown';
  let detectedKeywords: string[] = [];

  for (const candidate of INTENT_PRIORITY) {
    const singles = SINGLE_WORD_KEYWORDS[candidate].filter((k) => tokenSet.has(k));
    const phrases = PHRASE_KEYWORDS[candidate].filter((p) => lower.includes(p));
    if (singles.length > 0 || phrases.length > 0) {
      intent = candidate;
      detectedKeywords = [...phrases, ...singles];
      break;
    }
  }

  return {
    original,
    normalized,
    lower,
    tokens,
    intent,
    detectedKeywords,
  };
}
