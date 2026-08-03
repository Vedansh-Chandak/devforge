import { describe, it, expect } from 'vitest';
import {
  OUTPUT_TAGS,
  buildPatchSystemPrompt,
  buildPatchUserPrompt,
  buildPatchPrompt,
  buildFailureAnalysisSystemPrompt,
  buildFailureAnalysisPrompt,
  buildRepairDecisionSystemPrompt,
  buildRepairDecisionUserPrompt,
  buildDocumentationPrompt,
  buildReviewPrompt,
} from '../prompt-builder.js';
import type { CodePatch } from '../../executor/patch-model.js';
import type { Diagnostics } from '../../executor/diagnostics.js';
import type { FailureAnalysis, RepairDecisionInput } from '../../executor/reasoning-model.js';

const PATCHES: readonly CodePatch[] = [
  { id: 'p1', file: 'src/foo.ts', operation: 'CREATE', newContent: 'export const foo = 1;' },
];

const DIAGNOSTICS: Diagnostics = {
  source: 'verification',
  diagnostics: [
    { category: 'COMPILER', severity: 'error', message: 'Cannot find name foo', file: 'src/main.ts', line: 4, code: 'TS2304' },
  ],
  stderr: ['line one', 'line two'],
  verificationDurationMs: 10,
  summary: '1 error',
};

const ANALYSIS: FailureAnalysis = {
  diagnosis: 'Type error in src/main.ts',
  category: 'TYPE_ERROR',
  confidence: 0.9,
  suggestedPaths: ['src/main.ts'],
  estimatedComplexity: 2,
};

const DECISION_INPUT: RepairDecisionInput = {
  goal: 'g',
  diagnostics: DIAGNOSTICS,
  analysis: ANALYSIS,
  attempt: 1,
};

describe('prompt builders', () => {
  it('patch system prompt explains the output format and tags', () => {
    const prompt = buildPatchSystemPrompt();
    expect(prompt).toContain(OUTPUT_TAGS.PATCH_START);
    expect(prompt).toContain(OUTPUT_TAGS.PATCH_END);
    expect(prompt).toContain('CREATE');
    expect(prompt).toContain('MODIFY');
    expect(prompt).toContain('DELETE');
  });

  it('patch user prompt includes goal and context', () => {
    const prompt = buildPatchUserPrompt({ goal: 'Add foo', context: ['file a', 'file b'], generatedCount: 2 });
    expect(prompt).toContain('Add foo');
    expect(prompt).toContain('file a');
    expect(prompt).toContain('2 patch(es)');
  });

  it('patch user prompt omits context when empty', () => {
    const prompt = buildPatchUserPrompt({ goal: 'Add foo', context: [], generatedCount: 0 });
    expect(prompt).not.toContain('Context:');
  });

  it('buildPatchPrompt returns system and user messages', () => {
    const messages = buildPatchPrompt({ goal: 'g', context: [], generatedCount: 0 });
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe('system');
    expect(messages[1]!.role).toBe('user');
    expect(messages[0]!.content).toContain('expert software engineer');
  });

  it('failure analysis system prompt mentions reasoning tags', () => {
    const prompt = buildFailureAnalysisSystemPrompt();
    expect(prompt).toContain(OUTPUT_TAGS.REASONING_START);
    expect(prompt).toContain(OUTPUT_TAGS.REASONING_END);
    expect(prompt).toContain('TYPE_ERROR');
  });

  it('failure analysis user prompt includes diagnostics and stderr', () => {
    const messages = buildFailureAnalysisPrompt({ goal: 'g', diagnostics: DIAGNOSTICS, attempt: 1 });
    const user = messages[1]!.content;
    expect(user).toContain('Cannot find name foo');
    expect(user).toContain('TS2304');
    expect(user).toContain('line two');
    expect(user).toContain('Attempt: 1');
  });

  it('repair decision system prompt mentions reasoning tags', () => {
    const prompt = buildRepairDecisionSystemPrompt();
    expect(prompt).toContain(OUTPUT_TAGS.REASONING_START);
    expect(prompt).toContain('REWRITE');
    expect(prompt).toContain('ABORT');
  });

  it('repair decision user prompt includes the analysis', () => {
    const user = buildRepairDecisionUserPrompt(DECISION_INPUT);
    expect(user).toContain('Type error in src/main.ts');
    expect(user).toContain(ANALYSIS.category);
    expect(user).toContain('Attempt: 1');
  });

  it('documentation prompt lists the patches', () => {
    const messages = buildDocumentationPrompt('Add foo', PATCHES);
    const user = messages[1]!.content;
    expect(user).toContain('CREATE src/foo.ts');
    expect(user).toContain('Add foo');
  });

  it('review prompt includes patch content preview', () => {
    const messages = buildReviewPrompt('Add foo', PATCHES);
    const user = messages[1]!.content;
    expect(user).toContain('CREATE src/foo.ts');
    expect(user).toContain('export const foo = 1;');
  });
});