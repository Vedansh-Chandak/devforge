import { describe, it, expect } from 'vitest';
import { parseRequest } from '../parser.js';

describe('parser', () => {
  it('normalizes whitespace and trims input', () => {
    const parsed = parseRequest('  Search\n   for   the   auth   module  ');
    expect(parsed.normalized).toBe('Search for the auth module');
  });

  it('keeps the original input untouched', () => {
    const original = '  Search for X  ';
    expect(parseRequest(original).original).toBe(original);
  });

  it('detects implement intent', () => {
    const parsed = parseRequest('Implement a login endpoint');
    expect(parsed.intent).toBe('implement');
    expect(parsed.detectedKeywords).toContain('implement');
  });

  it('detects destructive intent with priority over productive intents', () => {
    const parsed = parseRequest('Remove the obsolete migration files');
    expect(parsed.intent).toBe('destructive');
    expect(parsed.detectedKeywords).toContain('remove');
  });

  it('detects refactor intent', () => {
    expect(parseRequest('Refactor the login module').intent).toBe('refactor');
  });

  it('detects fix intent', () => {
    expect(parseRequest('Fix the broken import in main.ts').intent).toBe('fix');
  });

  it('detects search intent', () => {
    expect(parseRequest('Find where sessions are stored').intent).toBe('search');
  });

  it('detects explain intent via phrase matching', () => {
    const parsed = parseRequest('Explain how does authentication work');
    expect(parsed.intent).toBe('explain');
  });

  it('falls back to unknown intent', () => {
    const parsed = parseRequest('1234 !!!');
    expect(parsed.intent).toBe('unknown');
    expect(parsed.detectedKeywords).toHaveLength(0);
  });

  it('does not contain planning logic in the parsed result', () => {
    const parsed = parseRequest('Fix the bug');
    expect(parsed).not.toHaveProperty('steps');
    expect(parsed).not.toHaveProperty('risk');
  });

  it('detects keywords deterministically in a fixed order', () => {
    const a = parseRequest('Refactor and simplify the login module');
    const b = parseRequest('Refactor and simplify the login module');
    expect(a.detectedKeywords).toEqual(b.detectedKeywords);
    expect(a.intent).toBe(b.intent);
  });
});
