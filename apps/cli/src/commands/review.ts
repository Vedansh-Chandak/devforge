/**
 * @devforge/cli — review command (M2).
 *
 * Git Status → Git Diff → Brain → Reasoning Model → Review Report
 * Includes: bugs, style, security, performance, missing tests
 */

import type { ExecutionContext } from '../services/session.js';
import type { CodePatch, GitDiff } from '@devforge/execution';

/** Review finding categories */
type ReviewCategory = 'bugs' | 'style' | 'security' | 'performance' | 'missing-tests';

interface ReviewFinding {
  category: ReviewCategory;
  file: string;
  line?: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  suggestion?: string;
}

interface ReviewReport {
  summary: string;
  findings: ReviewFinding[];
  stats: Record<ReviewCategory, number>;
  changedFiles: readonly string[];
}

/** Handler for `devforge review`. */
export async function handleReview(ctx: ExecutionContext): Promise<string> {
  const { services, repository, options } = ctx;
  const { executor } = services;

  // Get git diff of pending changes
  const diff = await executor.git.diff();
  const changedFiles = await executor.git.changedFiles();

  if (!changedFiles.length) {
    return '📝 No pending changes to review.';
  }

  // Build a review prompt for the reasoning model
  const diffSummary = changedFiles.map(f => `  - ${f}`).join('\n');
  const prompt = `Review the following changes in ${changedFiles.length} file(s):

${diff.text.slice(0, 8000)}

Provide a comprehensive code review with findings in these categories:
1. **Bugs** - Logic errors, potential runtime failures, incorrect behavior
2. **Style** - Code style, formatting, naming conventions, consistency
3. **Security** - Vulnerabilities, injection risks, data exposure, auth issues
4. **Performance** - Inefficient algorithms, unnecessary allocations, slow patterns
5. **Missing Tests** - Untested code paths, edge cases, integration gaps

Output format (JSON inside <DEVFORGE_REASONING> tags):
<DEVFORGE_REASONING>
{
  "findings": [
    {"category": "bugs", "file": "src/file.ts", "line": 42, "message": "Description", "severity": "error", "suggestion": "Fix suggestion"}
  ],
  "summary": "Overall assessment"
}
</DEVFORGE_REASONING>`;

  // Use the reasoning model (read-only) to analyze the diff — never the
  // mutating coding engine. The reasoning provider is role-routed and performs
  // no workspace writes (DF-028).
  const reasoningModel = executor.reasoningModel;

  let modelReview: ReviewReport | null = null;
  try {
    const modelSettings = {
      temperature: 0.2,
      maxTokens: 8192,
    };
    const response = await reasoningModel.provider.generate({
      messages: [{ role: 'user', content: prompt }],
      temperature: modelSettings.temperature,
      maxTokens: modelSettings.maxTokens,
      signal: ctx.signal,
    });
    modelReview = parseGen(response.content);
  } catch {
    // Provider unavailable or output not parseable — fall back to the
    // deterministic structured review below.
  }

  let output = `🔍 Code Review (${changedFiles.length} files)\n\n`;
  output += `Repository: ${repository.root}\n`;
  output += `Branch: ${repository.branch ?? 'unknown'}\n\n`;

  // Try to parse structured findings from the reasoning model output
  let reviewReport: ReviewReport | null = null;

  if (modelReview) {
    reviewReport = modelReview;
  } else {
    // Deterministic diff-based review (fallback when model output isn't parseable)
    reviewReport = generateStructuredReview(diff, changedFiles);
  }

  if (reviewReport) {
    output += `${reviewReport.summary}\n\n`;
    
    // Print findings by category
    const categories: ReviewCategory[] = ['bugs', 'security', 'performance', 'style', 'missing-tests'];
    for (const cat of categories) {
      const findings = reviewReport.findings.filter(f => f.category === cat);
      if (findings.length > 0) {
        output += `## ${cat.charAt(0).toUpperCase() + cat.slice(1)} (${findings.length})\n`;
        for (const f of findings) {
          const loc = f.line ? `:${f.line}` : '';
          const sev = f.severity === 'error' ? '🔴' : f.severity === 'warning' ? '🟡' : '🔵';
          output += `${sev} \`${f.file}${loc}\`: ${f.message}`;
          if (f.suggestion) output += `\n   💡 ${f.suggestion}`;
          output += `\n`;
        }
        output += `\n`;
      }
    }
    
    // Stats summary
    output += `### Summary\n`;
    for (const cat of categories) {
      const count = reviewReport.stats[cat];
      if (count > 0) output += `- ${cat}: ${count}\n`;
    }
  } else {
    // Fallback: basic diff-based review
    output += `## Diff Analysis\n\n`;
    output += `Changed files:\n${diffSummary}\n\n`;
    
    if (modelReview) {
      output += `✅ Review complete. ${modelReview.findings.length} finding(s).`;
    } else {
      output += `⚠️  Review outcome: ${!modelReview ? 'model output unavailable' : 'unknown'}`;
    }
  }

  if (options.debug) {
    output += `\n\n---\nDiff preview (first 500 chars):\n${diff.text.slice(0, 500)}`;
  }

  return output;
}

/**
 * Parse a ReviewReport from model output. Accepts JSON wrapped in
 * <DEVFORGE_REASONING> tags, a trailing JSON object, or a JSDoc block.
 * Returns null when no valid report can be extracted.
 */
function parseGen(output: string): ReviewReport | null {
  const tagged = output.match(/<DEVFORGE_REASONING>([\s\S]*?)<\/DEVFORGE_REASONING>/);
  const candidate = tagged ? tagged[1] : output;
  if (candidate === undefined) return null;
  try {
    const parsed = JSON.parse(candidate);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.summary === 'string' &&
      Array.isArray(parsed.findings)
    ) {
      const findings: ReviewFinding[] = [];
      for (const f of parsed.findings) {
        if (!f || typeof f !== 'object') continue;
        const finding: ReviewFinding = {
          category: toCategory(f.category),
          file: typeof f.file === 'string' ? f.file : 'general',
          message: typeof f.message === 'string' ? f.message : 'No message',
          severity: toSeverity(f.severity),
        };
        if (typeof f.line === 'number') finding.line = f.line;
        if (typeof f.suggestion === 'string') finding.suggestion = f.suggestion;
        findings.push(finding);
      }
      const stats: Record<ReviewCategory, number> = {
        bugs: 0,
        style: 0,
        security: 0,
        performance: 0,
        'missing-tests': 0,
      };
      for (const f of findings) stats[f.category] += 1;
      return {
        summary: String(parsed.summary),
        findings,
        stats,
        changedFiles: [],
      };
    }
  } catch {
    return null;
  }
  return null;
}

function toCategory(value: unknown): ReviewCategory {
  switch (String(value)) {
    case 'bugs':
    case 'style':
    case 'security':
    case 'performance':
    case 'missing-tests':
      return value as ReviewCategory;
    default:
      return 'style';
  }
}

function toSeverity(value: unknown): ReviewFinding['severity'] {
  switch (String(value)) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    default:
      return 'info';
  }
}

/** Generate a structured review from git diff (fallback when model output isn't parseable). */
function generateStructuredReview(
  diff: GitDiff,
  changedFiles: readonly string[]
): ReviewReport {
  const findings: ReviewFinding[] = [];
  const stats: Record<ReviewCategory, number> = {
    bugs: 0,
    style: 0,
    security: 0,
    performance: 0,
    'missing-tests': 0,
  };

  // Analyze diff for common patterns
  for (const file of diff.files) {
    const filePath = file.newPath || file.oldPath;
    for (const hunk of file.hunks) {
      let lineNum = hunk.newStart ?? hunk.oldStart ?? 0;
      for (const line of hunk.lines) {
        if (line.kind === 'addition') {
          const content = line.content.trim();
          
          // Security checks
          if (/(password|secret|api[_-]?key|token|credential)/i.test(content) && !/(test|mock|example|placeholder)/i.test(content)) {
            findings.push({ category: 'security', file: filePath, line: lineNum, message: 'Potential hardcoded secret', severity: 'error', suggestion: 'Use environment variables or secret management' });
            stats.security++;
          }
          if (/eval\(|exec\(|Function\(|innerHTML\s*=/i.test(content)) {
            findings.push({ category: 'security', file: filePath, line: lineNum, message: 'Potential code injection risk', severity: 'error', suggestion: 'Avoid dynamic code execution' });
            stats.security++;
          }
          
          // Performance checks
          if (/\.forEach\(|for\s*\(.*in\s*\)|for\s*\(.*of\s*\)/.test(content) && /\.map\(|\.filter\(|\.reduce\(/.test(content)) {
            findings.push({ category: 'performance', file: filePath, line: lineNum, message: 'Potential redundant iteration', severity: 'warning', suggestion: 'Combine map/filter/reduce into single pass' });
            stats.performance++;
          }
          if (/new\s+Array\(|new\s+Object\(/.test(content)) {
            findings.push({ category: 'performance', file: filePath, line: lineNum, message: 'Use literal syntax instead of constructor', severity: 'info', suggestion: 'Use [] or {} instead' });
            stats.performance++;
          }
          
          // Style checks
          if (/console\.(log|warn|error|debug)/.test(content) && !/(test|debug)/i.test(filePath)) {
            findings.push({ category: 'style', file: filePath, line: lineNum, message: 'Console logging in production code', severity: 'warning', suggestion: 'Use proper logger' });
            stats.style++;
          }
          if (/^\s*}\s*else\s*\{/.test(content)) {
            findings.push({ category: 'style', file: filePath, line: lineNum, message: 'Inconsistent brace style', severity: 'info', suggestion: 'Follow project brace style' });
            stats.style++;
          }
          
          // Bug checks
          if (/==\s*null|==\s*undefined/.test(content)) {
            findings.push({ category: 'bugs', file: filePath, line: lineNum, message: 'Loose equality with null/undefined', severity: 'error', suggestion: 'Use === or ===' });
            stats.bugs++;
          }
          if (/\.length\s*[<>]=?\s*0/.test(content) && !/===|!==/.test(content)) {
            findings.push({ category: 'bugs', file: filePath, line: lineNum, message: 'Unsafe array length comparison', severity: 'warning', suggestion: 'Use === 0 or !== 0' });
            stats.bugs++;
          }
          
          // Missing tests heuristic
          if (/export\s+(function|class|const|let|var)\s+\w+/.test(content) && !/\.test\.|\.spec\./.test(filePath)) {
            // This is a soft heuristic - we can't know for sure without test files
            // Just note it as info
            stats['missing-tests']++;
          }
        }
        if (line.kind !== 'deletion') lineNum++;
      }
    }
  }

  // If no specific findings, add a generic note
  if (findings.length === 0) {
    findings.push({ category: 'style', file: 'general', message: 'No significant issues detected in diff', severity: 'info' });
  }

  const total = findings.length;
  const errors = findings.filter(f => f.severity === 'error').length;
  const warnings = findings.filter(f => f.severity === 'warning').length;

  let summary = `Reviewed ${changedFiles.length} file(s) with ${diff.files.reduce((sum, f) => sum + f.hunks.length, 0)} hunks.\n`;
  if (errors > 0) summary += `🔴 ${errors} error(s), `;
  if (warnings > 0) summary += `🟡 ${warnings} warning(s), `;
  summary += `🔵 ${findings.filter(f => f.severity === 'info').length} info.`;

  return { summary, findings, stats, changedFiles };
}