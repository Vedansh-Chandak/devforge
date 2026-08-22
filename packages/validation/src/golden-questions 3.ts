/**
 * Golden Question Set — curated validation questions for DevForge.
 *
 * Each question covers a supported intent and includes machine-checkable
 * expectations. Use the DevForge repo as the real repository target.
 */

import type { IntentKind } from '@devforge/brain';

export interface GoldenExpectation {
  /** Expected intent classification */
  intent: IntentKind;
  /** Expected symbols that should appear in Runtime results */
  expectedSymbols?: string[];
  /** Expected symbols in composer context */
  expectedContextSymbols?: string[];
  /** Expected substrings in composed prompt */
  expectedPromptContains?: string[];
  /** Expected dependency relationships */
  expectedDependencies?: { from: string; to: string }[];
  /** Expected architecture nodes */
  expectedArchitectureNodes?: string[];
}

export interface GoldenQuestion {
  id: string;
  question: string;
  expectation: GoldenExpectation;
}

export const GOLDEN_QUESTIONS: GoldenQuestion[] = [
  // ── ExplainCode ──
  {
    id: 'explain-symbol-graph',
    question: 'Explain the symbol graph pipeline',
    expectation: {
      intent: 'ExplainCode',
      expectedPromptContains: ['symbol-graph', 'buildSymbolGraph'],
    },
  },
  {
    id: 'explain-repository-indexing',
    question: 'Explain how repository indexing works',
    expectation: {
      intent: 'ExplainCode',
      expectedPromptContains: ['repository-indexer', 'indexRepository'],
    },
  },
  {
    id: 'explain-brain-runtime',
    question: 'Explain how the Brain uses Runtime',
    expectation: {
      intent: 'ExplainCode',
      expectedPromptContains: ['DevForgeBrain', 'Runtime'],
    },
  },
  // ── FindSymbol ──
  {
    id: 'find-devforge-runtime',
    question: 'Locate DevForgeRuntime',
    expectation: {
      intent: 'FindSymbol',
      expectedContextSymbols: ['DevForgeRuntime'],
    },
  },
  {
    id: 'find-devforge-brain',
    question: 'Where is DevForgeBrain',
    expectation: {
      intent: 'FindSymbol',
      expectedContextSymbols: ['DevForgeBrain'],
    },
  },
  {
    id: 'find-build-knowledge-graph',
    question: 'Locate buildKnowledgeGraph',
    expectation: {
      intent: 'FindSymbol',
      expectedPromptContains: ['buildKnowledgeGraph'],
    },
  },
  // ── FindDependencies ──
  {
    id: 'deps-devforge-brain',
    question: 'Show dependencies of DevForgeBrain',
    expectation: {
      intent: 'FindDependencies',
      expectedPromptContains: ['DevForgeBrain'],
    },
  },
  {
    id: 'deps-what-depends-on-runtime',
    question: 'What depends on DevForgeRuntime?',
    expectation: {
      intent: 'FindDependencies',
      expectedContextSymbols: ['DevForgeRuntime'],
    },
  },
  {
    id: 'deps-build-symbol-graph',
    question: 'Show dependencies of buildSymbolGraph',
    expectation: {
      intent: 'FindDependencies',
      expectedPromptContains: ['buildSymbolGraph'],
    },
  },
  // ── Architecture ──
  {
    id: 'arch-show',
    question: 'Show the architecture',
    expectation: {
      intent: 'Architecture',
    },
  },
  {
    id: 'arch-describe',
    question: 'Show the project structure',
    expectation: {
      intent: 'Architecture',
    },
  },
  // ── Search ──
  {
    id: 'search-knowledge-graph',
    question: 'Search knowledge graph',
    expectation: {
      intent: 'Search',
      expectedPromptContains: ['knowledge'],
    },
  },
  {
    id: 'search-model-provider',
    question: 'Search model provider',
    expectation: {
      intent: 'Search',
      expectedPromptContains: ['provider'],
    },
  },
  {
    id: 'search-prompt-composer',
    question: 'Search prompt composer',
    expectation: {
      intent: 'Search',
      expectedPromptContains: ['composer'],
    },
  },
  {
    id: 'search-repository-indexer',
    question: 'Search repository indexer',
    expectation: {
      intent: 'Search',
      expectedPromptContains: ['repository'],
    },
  },
];