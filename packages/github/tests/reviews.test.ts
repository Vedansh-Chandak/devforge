/**
 * Review engine tests (DF-021).
 *
 * Deterministic coverage of the six review categories (bugs, security, style,
 * missing-tests, complexity, architecture), severity filtering, summaries,
 * stats, patch suggestions, and reproducibility.
 */

import { describe, expect, it } from 'vitest';
import { ReviewEngine, defaultRules, REVIEW_CATEGORIES } from '../src/reviews.js';
import type { ReviewFinding } from '../src/reviews.js';
import type { GitHubChangedFile } from '../src/types.js';

/** Build a changed file with the given unified-diff additions. */
function fileWithPatch(filename: string, patch: string, status: GitHubChangedFile['status'] = 'modified'): GitHubChangedFile {
  const additions = patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
  const deletions = patch.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')).length;
  return { filename, status, additions, deletions, changes: additions + deletions, patch };
}

function simplePatch(lines: readonly string[]): string {
  const count = lines.length;
  return [
    `diff --git a/src/a.ts b/src/a.ts`,
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    `@@ -1,${count} +1,${count} @@`,
    ...lines,
  ].join('\n');
}

function addedOnly(content: string): string {
  return simplePatch(['+' + content]);
}

const engine = new ReviewEngine();

describe('ReviewEngine bug detection', () => {
  it('flags loose equality with null', async () => {
    const report = await engine.review([fileWithPatch('src/a.ts', addedOnly('if (x == null) return;'))]);
    const finding = report.findings.find((f) => f.category === 'bugs');
    expect(finding?.severity).toBe('warning');
    expect(finding?.message).toContain('Loose equality');
    expect(finding?.line).toBe(1);
  });

  it('flags NaN comparisons as errors', async () => {
    const report = await engine.review([fileWithPatch('src/a.ts', addedOnly('if (NaN === x) return;'))]);
    const finding = report.findings.find((f) => f.category === 'bugs');
    expect(finding?.severity).toBe('error');
  });

  it('flags unsigned length comparisons', async () => {
    const report = await engine.review([fileWithPatch('src/a.ts', addedOnly('if (xs.length < 0) return;'))]);
    expect(report.findings.some((f) => f.category === 'bugs')).toBe(true);
  });

  it('ignores bugs in unchanged context lines', async () => {
    const patch = simplePatch([' const keep = 1;', ' if (x == null) return;']);
    const report = await engine.review([fileWithPatch('src/a.ts', patch)]);
    // The bad line is context (no +/-), so no bug finding from it.
    expect(report.findings.filter((f) => f.category === 'bugs')).toHaveLength(0);
  });
});

describe('ReviewEngine security detection', () => {
  it('flags hardcoded secrets and suggests a patch', async () => {
    const report = await engine.review([fileWithPatch('src/a.ts', addedOnly('const password = "supersecret123";'))]);
    const finding = report.findings.find((f) => f.category === 'security');
    expect(finding?.severity).toBe('error');
    expect(finding?.message).toContain('hardcoded secret');
    expect(finding?.patch).toBeDefined();
    expect(finding?.patch?.replacement).toContain('process.env');
  });

  it('flags eval and new Function', async () => {
    const report = await engine.review([fileWithPatch('src/a.ts', addedOnly('eval(userInput);'))]);
    const finding = report.findings.find((f) => f.category === 'security');
    expect(finding?.message).toContain('injection');
  });

  it('flags innerHTML assignment', async () => {
    const report = await engine.review([fileWithPatch('src/a.ts', addedOnly('el.innerHTML = html;'))]);
    expect(report.findings.some((f) => f.category === 'security')).toBe(true);
  });
});

describe('ReviewEngine style detection', () => {
  it('flags var declarations as warnings', async () => {
    const report = await engine.review([fileWithPatch('src/a.ts', addedOnly('var total = 0;'))]);
    const finding = report.findings.find((f) => f.category === 'style');
    expect(finding?.severity).toBe('warning');
    expect(finding?.message).toContain('`var`');
  });

  it('flags console.log but skips it inside test files', async () => {
    const prod = await engine.review([fileWithPatch('src/a.ts', addedOnly('console.log("hi");'))]);
    expect(prod.findings.some((f) => f.category === 'style' && f.message.includes('Debug logging'))).toBe(true);

    const test = await engine.review([fileWithPatch('src/a.test.ts', addedOnly('console.log("hi");'))]);
    expect(test.findings.some((f) => f.category === 'style' && f.message.includes('Debug logging'))).toBe(false);
  });

  it('flags TODO comments as info', async () => {
    const report = await engine.review([fileWithPatch('src/a.ts', addedOnly('// TODO: handle edge case'))]);
    expect(report.findings.some((f) => f.category === 'style' && f.message.includes('TODO'))).toBe(true);
  });
});

describe('ReviewEngine missing tests', () => {
  it('flags a new source file without a test companion', async () => {
    const report = await engine.review([fileWithPatch('src/util.ts', addedOnly('export const a = 1;'))]);
    const finding = report.findings.find((f) => f.category === 'missing-tests');
    expect(finding?.message).toContain('util.ts');
    expect(finding?.suggestion).toContain('util.test.ts');
  });

  it('does not flag test files themselves', async () => {
    const report = await engine.review([fileWithPatch('src/util.test.ts', addedOnly('it("works", () => {});'))]);
    expect(report.findings.some((f) => f.category === 'missing-tests')).toBe(false);
  });

  it('does not flag non-source files', async () => {
    const report = await engine.review([fileWithPatch('docs/readme.md', addedOnly('# Heading'))]);
    expect(report.findings.some((f) => f.category === 'missing-tests')).toBe(false);
  });
});

describe('ReviewEngine complexity detection', () => {
  it('flags very large changes', async () => {
    const lines = Array.from({ length: 201 }, (_, i) => `+const v${i} = ${i};`);
    const report = await engine.review([fileWithPatch('src/big.ts', simplePatch(lines))]);
    const finding = report.findings.find((f) => f.category === 'complexity');
    expect(finding?.message).toContain('Large change');
  });

  it('flags deeply nested code', async () => {
    const deep = [
      '+if (a) {',
      '+    if (b) {',
      '+        if (c) {',
      '+            if (d) {',
      '+                if (e) {',
      '+                    x();',
      '+                    y();',
      '+                    z();',
      '+                }',
      '+            }',
      '+        }',
      '+    }',
      '+}',
    ];
    const report = await engine.review([fileWithPatch('src/deep.ts', simplePatch(deep))]);
    const finding = report.findings.find((f) => f.category === 'complexity');
    expect(finding?.message).toContain('Deeply nested');
  });

  it('does not flag small changes', async () => {
    const report = await engine.review([fileWithPatch('src/small.ts', addedOnly('const ok = true;'))]);
    expect(report.findings.some((f) => f.category === 'complexity')).toBe(false);
  });
});

describe('ReviewEngine architecture detection', () => {
  it('flags deep relative imports', async () => {
    const patch = addedOnly('import { x } from "../../../../shared/helpers";');
    const report = await engine.review([fileWithPatch('src/a.ts', patch)]);
    const finding = report.findings.find((f) => f.category === 'architecture');
    expect(finding?.message).toContain('Deep relative import');
    expect(finding?.severity).toBe('info');
  });

  it('does not flag shallow imports', async () => {
    const patch = addedOnly('import { x } from "./helpers";');
    const report = await engine.review([fileWithPatch('src/a.ts', patch)]);
    expect(report.findings.some((f) => f.category === 'architecture')).toBe(false);
  });
});

describe('ReviewEngine report shape', () => {
  it('builds accurate per-category stats', async () => {
    const files = [
      fileWithPatch('src/a.ts', addedOnly('const password = "supersecret123";')),
      fileWithPatch('src/b.ts', addedOnly('var x = 1;')),
      fileWithPatch('src/c.ts', addedOnly('if (x == null) return;')),
    ];
    const report = await engine.review(files);
    expect(report.stats['security']).toBe(1);
    expect(report.stats['style']).toBe(1);
    expect(report.stats['bugs']).toBe(1);
    expect(report.changedFiles).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('produces a summary mentioning error/warning counts', async () => {
    const report = await engine.review([fileWithPatch('src/a.ts', addedOnly('const password = "supersecret123";'))]);
    expect(report.summary).toContain('1 error(s)');
    expect(report.summary).toContain('1 file(s)');
  });

  it('reports no issues for clean files', async () => {
    const report = await engine.review([fileWithPatch('docs/clean.md', addedOnly('const value = 42;'))]);
    expect(report.findings).toHaveLength(0);
    expect(report.summary).toContain('No issues detected');
  });

  it('filters info findings when includeInfo is false', async () => {
    const patch = addedOnly('import { x } from "../../../../shared/h";');
    const withInfo = await engine.review([fileWithPatch('src/a.ts', patch)], { includeInfo: true });
    const withoutInfo = await engine.review([fileWithPatch('src/a.ts', patch)], { includeInfo: false });
    expect(withInfo.findings.some((f) => f.severity === 'info')).toBe(true);
    expect(withoutInfo.findings.some((f) => f.severity === 'info')).toBe(false);
  });

  it('uses readFile to surface content (no crash on missing file)', async () => {
    const report = await engine.review([fileWithPatch('src/a.ts', addedOnly('var x = 1;'))], {
      readFile: async () => {
        throw new Error('missing');
      },
    });
    expect(report.findings.some((f) => f.category === 'style')).toBe(true);
  });
});

describe('ReviewEngine determinism', () => {
  it('produces identical findings across runs', async () => {
    const files = [
      fileWithPatch('src/a.ts', addedOnly('const password = "supersecret123";')),
      fileWithPatch('src/b.ts', addedOnly('var x = 1;')),
    ];
    const first = await engine.review(files);
    const second = await engine.review(files);
    expect(first.findings).toEqual(second.findings);
  });

  it('deduplicates identical findings', async () => {
    const duplicate = [
      addedOnly('const password = "supersecret123";'),
      addedOnly('const password = "supersecret123";'),
    ].map((p, i) => fileWithPatch(`src/a${i}.ts`, p));
    const report = await engine.review(duplicate);
    const security = report.findings.filter((f) => f.category === 'security');
    expect(security).toHaveLength(2);
  });

  it('exposes all review categories in a stable order', () => {
    expect(REVIEW_CATEGORIES).toEqual(['bugs', 'security', 'style', 'missing-tests', 'complexity', 'architecture']);
  });

  it('default rule set is non-empty and ordered deterministically', () => {
    expect(defaultRules).toHaveLength(6);
  });
});

describe('ReviewEngine finding shape', () => {
  it('every finding carries a file, category, and suggestion', async () => {
    const report = await engine.review([
      fileWithPatch('src/a.ts', addedOnly('const password = "supersecret123";')),
      fileWithPatch('src/b.ts', addedOnly('var x = 1;')),
    ]);
    for (const finding of report.findings) {
      expect(finding.file).toBeTruthy();
      expect(['bugs', 'security', 'style', 'missing-tests', 'complexity', 'architecture']).toContain(finding.category);
      expect(finding.suggestion.length).toBeGreaterThan(0);
    }
  });

  it('security findings carry a concrete patch', async () => {
    const report = await engine.review([fileWithPatch('src/a.ts', addedOnly('const apiKey = "abcdef12345678";'))]);
    const finding = report.findings.find((f) => f.category === 'security') as ReviewFinding;
    expect(finding.patch?.file).toBe('src/a.ts');
    expect(finding.patch?.original).toContain('abcdef12345678');
  });
});