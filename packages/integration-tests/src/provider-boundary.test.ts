/**
 * DF-027 architectural guard (Phase 13).
 *
 * Consumer packages must remain provider-agnostic. Concrete provider adapters
 * (OpenAI-compatible, Gemini, Anthropic) and the test fake must only be
 * imported from the owning implementation package (`@devforge/model-provider`)
 * and its factory/normalized boundary — never from brain, planner, autonomous,
 * multi-agent, or the CLI. This test scans the consumer `src` trees for such
 * imports and fails if any slip in.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);

/** Consumer packages whose production code must never name concrete adapters. */
const CONSUMER_SRC_DIRS: readonly string[] = [
  'packages/brain/src',
  'packages/planner/src',
  'packages/autonomous/src',
  'packages/multi-agent/src',
  'packages/execution/src',
  'apps/cli/src',
  'packages/github/src',
  'extensions/vscode/src',
];

/** Symbols that may only be imported from the model-provider package. */
const BANNED_SYMBOLS = new Set([
  'OpenAICompatibleProvider',
  'GeminiProvider',
  'AnthropicProvider',
  'FakeModelProvider',
  'createModelProviderFromConfig',
  'createModelProvider',
]);

const ALLOWED_MODULES = new Set([
  '@devforge/model-provider',
  'model-provider',
  '../model-provider',
  '../../model-provider',
]);

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Find banned imports. Returns `file -> import clause` violations. */
function findViolations(root: string): ReadonlyArray<{ file: string; clause: string }> {
  const violations: { file: string; clause: string }[] = [];
  for (const dir of CONSUMER_SRC_DIRS) {
    for (const file of walkFiles(path.join(root, dir))) {
      const content = fs.readFileSync(file, 'utf-8');
      // Named imports from a provider context.
      const namedImport =
        /import\s+type?\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
      let match: RegExpExecArray | null;
      while ((match = namedImport.exec(content))) {
        const names = match[1] ?? '';
        const module = match[2] ?? '';
        if (ALLOWED_MODULES.has(module)) continue;
        const bannedFound = names
          .split(',')
          .map((n) => n.trim().split(/\s+as\s+/)[0]?.trim())
          .filter((n) => n && BANNED_SYMBOLS.has(n));
        if (bannedFound.length > 0) {
          const clause = `${names.trim()} from '${module}'`;
          if (!violations.some((v) => v.file === file && v.clause === clause)) {
            violations.push({ file: path.relative(root, file), clause });
          }
        }
      }
      // Direct default / namespace imports of a concrete adapter module.
      const directImport =
        /import\s+(?:type\s+)?[^'"]+from\s*['"]([^'"]*(?:openai-compatible|gemini|anthropic|fake-provider)[^'"]*)['"]/g;
      while ((match = directImport.exec(content))) {
        const clause = match[0];
        if (!violations.some((v) => v.file === path.relative(root, file) && v.clause === clause)) {
          violations.push({ file: path.relative(root, file), clause });
        }
      }
    }
  }
  return violations;
}

describe('DF-027: consumers are provider-agnostic (Phase 13)', () => {
  it('never imports concrete provider adapters or the fake outside model-provider', () => {
    const violations = findViolations(repoRoot);
    expect(violations).toEqual([]);
  });
});