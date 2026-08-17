/**
 * @devforge/execution — Prompt Builder (DF-016C).
 *
 * Pure functions for building prompts for different model tasks.
 * No provider logic, no I/O — just string construction.
 */

import type { ModelMessage } from '@devforge/model-provider';
import type { CodingModelRequest } from '../executor/coding-model.js';
import type { FailureAnalysisInput, RepairDecisionInput, FailureAnalysis, RepairDecision } from '../executor/reasoning-model.js';
import type { Diagnostics } from '../executor/diagnostics.js';
import type { CodePatch } from '../executor/patch-model.js';

/** Tags used to wrap model output for reliable parsing. */
export const OUTPUT_TAGS = {
  PATCH_START: '<DEVFORGE_PATCH>',
  PATCH_END: '</DEVFORGE_PATCH>',
  REASONING_START: '<DEVFORGE_REASONING>',
  REASONING_END: '</DEVFORGE_REASONING>',
} as const;

/** Build the system prompt for patch generation. */
export function buildPatchSystemPrompt(): string {
  return `You are an expert software engineer. Generate code patches to achieve the given goal.

Output format: Wrap your response in ${OUTPUT_TAGS.PATCH_START} ... ${OUTPUT_TAGS.PATCH_END} tags.

Each patch is a JSON object with:
- id: unique identifier (string)
- file: workspace-relative POSIX path (no leading slash, no "..")
- operation: "CREATE" | "MODIFY" | "DELETE"
- expectedHash: (optional) FNV-1a hash of current content for MODIFY/DELETE
- newContent: (required for CREATE/MODIFY) new file content as string

Example:
${OUTPUT_TAGS.PATCH_START}
[
  {"id": "p1", "file": "src/foo.ts", "operation": "CREATE", "newContent": "export const foo = 1;"},
  {"id": "p2", "file": "src/bar.ts", "operation": "MODIFY", "expectedHash": "fnv1a-abc123", "newContent": "export const bar = 2;"}
]
${OUTPUT_TAGS.PATCH_END}

Rules:
- Output ONLY the JSON array inside the tags
- No explanations, no markdown, no extra text
- File paths must be POSIX-style (forward slashes)
- All strings must be valid JSON (escape newlines, quotes)
- If you cannot produce valid patches, output an empty array []`;
}

/** Build the user prompt for patch generation. */
export function buildPatchUserPrompt(request: CodingModelRequest): string {
  const context = request.context.length > 0
    ? `\n\nContext:\n${request.context.join('\n---\n')}`
    : '';

  return `Goal: ${request.goal}${context}

Generate patches to accomplish this goal. You have already generated ${request.generatedCount} patch(es) in previous turns.`;
}

/** Build the complete messages for patch generation. */
export function buildPatchPrompt(request: CodingModelRequest, systemPrompt?: string): ModelMessage[] {
  const messages: ModelMessage[] = [
    { role: 'system', content: systemPrompt ?? buildPatchSystemPrompt() },
    { role: 'user', content: buildPatchUserPrompt(request) },
  ];
  return messages;
}

/** Build the system prompt for failure analysis. */
export function buildFailureAnalysisSystemPrompt(): string {
  return `You are an expert software engineer analyzing a verification failure.

Output format: Wrap your response in ${OUTPUT_TAGS.REASONING_START} ... ${OUTPUT_TAGS.REASONING_END} tags.

The output must be a JSON object with:
- diagnosis: human-readable description of what went wrong (string)
- category: "TYPE_ERROR" | "TEST_FAILURE" | "LINT_ERROR" | "COMMAND_ERROR" | "OTHER" (string)
- confidence: your confidence in the diagnosis, 0.0 to 1.0 (number)
- suggestedPaths: array of file paths likely needing changes (string[])
- estimatedComplexity: estimated repair complexity 1-10 (number)

Example:
${OUTPUT_TAGS.REASONING_START}
{
  "diagnosis": "TypeScript error TS2304: Cannot find name 'foo' in src/main.ts",
  "category": "TYPE_ERROR",
  "confidence": 0.95,
  "suggestedPaths": ["src/main.ts"],
  "estimatedComplexity": 2
}
${OUTPUT_TAGS.REASONING_END}

Rules:
- Output ONLY the JSON object inside the tags
- No explanations, no markdown, no extra text
- All strings must be valid JSON`;
}

/** Build the user prompt for failure analysis. */
export function buildFailureAnalysisUserPrompt(input: FailureAnalysisInput): string {
  const diagnostics = input.diagnostics;
  const diagLines = diagnostics.diagnostics.map((d) => {
    const loc = d.file ? `${d.file}${d.line ? `:${d.line}` : ''}${d.column ? `:${d.column}` : ''} ` : '';
    const code = d.code ? ` [${d.code}]` : '';
    return `  - ${loc}${d.severity.toUpperCase()}${code}: ${d.message}`;
  });

  const stderr = diagnostics.stderr.length > 0
    ? `\n\nCaptured stderr (truncated):\n${diagnostics.stderr.join('\n')}`
    : '';

  return `Goal: ${input.goal}
Attempt: ${input.attempt}

Verification failed:
${diagnostics.summary}

Diagnostics:
${diagLines.join('\n')}${stderr}

Analyze the failure and provide a diagnosis.`;
}

/** Build the complete messages for failure analysis. */
export function buildFailureAnalysisPrompt(input: FailureAnalysisInput, systemPrompt?: string): ModelMessage[] {
  const messages: ModelMessage[] = [
    { role: 'system', content: systemPrompt ?? buildFailureAnalysisSystemPrompt() },
    { role: 'user', content: buildFailureAnalysisUserPrompt(input) },
  ];
  return messages;
}

/** Build the system prompt for repair decision. */
export function buildRepairDecisionSystemPrompt(): string {
  return `You are an expert software engineer deciding how to repair a code failure.

Output format: Wrap your response in ${OUTPUT_TAGS.REASONING_START} ... ${OUTPUT_TAGS.REASONING_END} tags.

The output must be a JSON object with:
- strategy: "REWRITE" | "PATCH" | "CREATE" | "DELETE" | "RESTORE" | "ABORT" (string)
- reason: human-readable reason for the decision (string)
- targetFiles: array of file paths to target (string[])
- scope: "MINIMAL" | "BROAD" (string)

Example:
${OUTPUT_TAGS.REASONING_START}
{
  "strategy": "PATCH",
  "reason": "Type error in single file, can be fixed with targeted patch",
  "targetFiles": ["src/main.ts"],
  "scope": "MINIMAL"
}
${OUTPUT_TAGS.REASONING_END}

Rules:
- Output ONLY the JSON object inside the tags
- No explanations, no markdown, no extra text
- All strings must be valid JSON`;
}

/** Build the user prompt for repair decision. */
export function buildRepairDecisionUserPrompt(input: RepairDecisionInput): string {
  const analysis = input.analysis;
  return `Goal: ${input.goal}
Attempt: ${input.attempt}

Failure Analysis:
- Diagnosis: ${analysis.diagnosis}
- Category: ${analysis.category}
- Confidence: ${analysis.confidence}
- Suggested paths: ${analysis.suggestedPaths.join(', ') || '(none)'}
- Estimated complexity: ${analysis.estimatedComplexity}/10

Decide on a repair strategy.`;
}

/** Build the complete messages for repair decision. */
export function buildRepairDecisionPrompt(input: RepairDecisionInput, systemPrompt?: string): ModelMessage[] {
  const messages: ModelMessage[] = [
    { role: 'system', content: systemPrompt ?? buildRepairDecisionSystemPrompt() },
    { role: 'user', content: buildRepairDecisionUserPrompt(input) },
  ];
  return messages;
}

/** Build the system prompt for documentation generation. */
export function buildDocumentationSystemPrompt(): string {
  return `You are an expert technical writer generating documentation for code changes.

Output format: Wrap your response in ${OUTPUT_TAGS.REASONING_START} ... ${OUTPUT_TAGS.REASONING_END} tags.

The output must be a JSON object with:
- documentation: markdown-formatted documentation string
- targetFiles: array of file paths the documentation relates to

Example:
${OUTPUT_TAGS.REASONING_START}
{
  "documentation": "# API Changes\n\n## New Function: foo()\n\nReturns the foo value.",
  "targetFiles": ["src/api.ts"]
}
${OUTPUT_TAGS.REASONING_END}

Rules:
- Output ONLY the JSON object inside the tags
- No explanations, no markdown outside the JSON string value
- The documentation field should contain markdown`;
}

/** Build the user prompt for documentation generation. */
export function buildDocumentationUserPrompt(
  goal: string,
  patches: readonly CodePatch[],
  analysis?: FailureAnalysis,
): string {
  const patchSummary = patches.map((p) => `- ${p.operation} ${p.file}`).join('\n');
  const analysisStr = analysis
    ? `\n\nFailure context: ${analysis.diagnosis} (${analysis.category})`
    : '';

  return `Goal: ${goal}

Patches applied:
${patchSummary}${analysisStr}

Generate documentation for these changes.`;
}

/** Build the complete messages for documentation generation. */
export function buildDocumentationPrompt(
  goal: string,
  patches: readonly CodePatch[],
  analysis?: FailureAnalysis,
  systemPrompt?: string,
): ModelMessage[] {
  const messages: ModelMessage[] = [
    { role: 'system', content: systemPrompt ?? buildDocumentationSystemPrompt() },
    { role: 'user', content: buildDocumentationUserPrompt(goal, patches, analysis) },
  ];
  return messages;
}

/** Build the system prompt for code review. */
export function buildReviewSystemPrompt(): string {
  return `You are an expert code reviewer analyzing a set of patches.

Output format: Wrap your response in ${OUTPUT_TAGS.REASONING_START} ... ${OUTPUT_TAGS.REASONING_END} tags.

The output must be a JSON object with:
- approved: boolean
- comments: array of review comments (string[])
- severity: "APPROVE" | "REQUEST_CHANGES" | "COMMENT" (string)

Example:
${OUTPUT_TAGS.REASONING_START}
{
  "approved": true,
  "comments": ["Good use of types", "Consider adding a test"],
  "severity": "APPROVE"
}
${OUTPUT_TAGS.REASONING_END}

Rules:
- Output ONLY the JSON object inside the tags
- No explanations, no markdown, no extra text
- All strings must be valid JSON`;
}

/** Build the user prompt for code review. */
export function buildReviewUserPrompt(
  goal: string,
  patches: readonly CodePatch[],
  context?: readonly string[],
): string {
  const patchDetails = patches.map((p) => {
    const contentPreview = p.newContent
      ? `\n${p.newContent.slice(0, 500)}${p.newContent.length > 500 ? '...' : ''}`
      : '';
    return `- ${p.operation} ${p.file}${contentPreview}`;
  }).join('\n\n');

  const contextStr = context && context.length > 0
    ? `\n\nContext:\n${context.join('\n---\n')}`
    : '';

  return `Goal: ${goal}

Patches to review:
${patchDetails}${contextStr}

Review these patches.`;
}

/** Build the complete messages for code review. */
export function buildReviewPrompt(
  goal: string,
  patches: readonly CodePatch[],
  context?: readonly string[],
  systemPrompt?: string,
): ModelMessage[] {
  const messages: ModelMessage[] = [
    { role: 'system', content: systemPrompt ?? buildReviewSystemPrompt() },
    { role: 'user', content: buildReviewUserPrompt(goal, patches, context) },
  ];
  return messages;
}

/** Build a ModelRequest with settings applied. */
export function buildModelRequest(
  messages: ModelMessage[],
  settings?: {
    readonly temperature?: number;
    readonly maxTokens?: number;
  },
): { messages: ModelMessage[]; temperature?: number; maxTokens?: number } {
  return {
    messages,
    temperature: settings?.temperature,
    maxTokens: settings?.maxTokens,
  };
}