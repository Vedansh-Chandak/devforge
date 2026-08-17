# Context Builder Architecture Design

**Story ID**: DF-008.1
**Status**: DESIGN REVIEW
**Version**: 1.0
**Date**: 2026-07-13

---

## 1. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CONTEXT BUILDER PIPELINE                           │
└─────────────────────────────────────────────────────────────────────────────┘

    ┌─────────────┐     ┌──────────────────┐     ┌─────────────────────────┐
    │  User Query │────▶│  Query Analyzer  │────▶│  Concept Extractor      │
    │  (Natural   │     │  (Intent &       │     │  (NL → KG Concepts)     │
    │   Language) │     │   Constraints)   │     │                         │
    └─────────────┘     └──────────────────┘     └───────────┬─────────────┘
                                                             │
                                                             ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │                    KNOWLEDGE GRAPH                                  │
    │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │
    │  │  Symbols    │──│  Files      │──│  Dependencies│──│  Types    │  │
    │  │  (Nodes)    │  │  (Nodes)    │  │  (Edges)    │  │  (Nodes)  │  │
    │  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘  │
    └─────────────────────────────────────────────────────────────────────┘
                                                             │
                                                             ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │                    ENTRY POINT SELECTION                            │
    │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │
    │  │  Semantic   │  │  Structural │  │  Importance │  │  Composite│  │
    │  │  Match      │  │  Centrality │  │  Heuristics │  │  Score    │  │
    │  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘  │
    └─────────────────────────────────────────────────────────────────────┘
                                                             │
                                                             ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │                    GRAPH TRAVERSAL ENGINE                           │
    │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │
    │  │  BFS/DFS    │  │  Weighted   │  │  Cycle      │  │  Depth    │  │
    │  │  Traversal  │  │  Expansion  │  │  Detection  │  │  Limiting │  │
    │  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘  │
    └─────────────────────────────────────────────────────────────────────┘
                                                             │
                                                             ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │                    SYMBOL RANKING ENGINE                            │
    │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │
    │  │  Relevance  │  │  Structural │  │  Dependency │  │  Composite│  │
    │  │  Score      │  │  Importance │  │  Distance   │  │  Rank     │  │
    │  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘  │
    └─────────────────────────────────────────────────────────────────────┘
                                                             │
                                                             ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │                    TOKEN BUDGET ALLOCATOR                           │
    │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │
    │  │  Budget     │  │  Priority   │  │  Truncation │  │  Context  │  │
    │  │  Calculator │  │  Queue      │  │  Strategy   │  │  Assembly │  │
    │  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘  │
    └─────────────────────────────────────────────────────────────────────┘
                                                             │
                                                             ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │                    CONTEXT ASSEMBLER                                │
    │  ┌─────────────────────────────────────────────────────────────┐   │
    │  │  StructuredContext {                                        │   │
    │  │    entryPoints: Symbol[],                                   │   │
    │  │    dependencies: Symbol[],                                  │   │
    │  │    dependents: Symbol[],                                    │   │
    │  │    types: TypeDefinition[],                                 │   │
    │  │    config: ConfigFragment[],                                │   │
    │  │    metadata: ContextMetadata                                │   │
    │  │  }                                                          │   │
    │  └─────────────────────────────────────────────────────────────┘   │
    └─────────────────────────────────────────────────────────────────────┘
                                                             │
                                                             ▼
                                                    ┌──────────────┐
                                                    │  LLM-Agnostic│
                                                    │  Context     │
                                                    │  Output      │
                                                    └──────────────┘
```

---

## 2. Pipeline Overview

### 2.1 Stage Definitions

| Stage | Input | Output | Responsibility |
|-------|-------|--------|----------------|
| **1. Query Analysis** | `string query` | `QueryIntent` | Parse intent, constraints, scope hints |
| **2. Concept Extraction** | `QueryIntent` | `ConceptSet` | Map NL terms → KG node identifiers |
| **3. Entry Point Selection** | `ConceptSet, KnowledgeGraph` | `EntryPointSet` | Rank & select initial graph nodes |
| **4. Graph Traversal** | `EntryPointSet, KnowledgeGraph` | `TraversalResult` | Expand context via dependency edges |
| **5. Symbol Ranking** | `TraversalResult` | `RankedSymbolList` | Score symbols by relevance |
| **6. Token Budgeting** | `RankedSymbolList, Budget` | `BudgetedSymbols` | Allocate tokens, truncate |
| **7. Context Assembly** | `BudgetedSymbols, KnowledgeGraph` | `StructuredContext` | Build final structured output |

### 2.2 Data Flow Types

```typescript
// Stage 1: Query Analysis
interface QueryIntent {
  primaryIntent: IntentType;           // EXPLAIN | DEBUG | REFACTOR | EXTEND | REVIEW
  constraints: Constraint[];           // FILE_SCOPE | MODULE_SCOPE | TEST_ONLY | RECENT_CHANGES
  scopeHints: ScopeHint[];             // Explicit file/module mentions
  complexity: ComplexityLevel;         // SIMPLE | MODERATE | COMPLEX
  keywords: string[];                  // Extracted domain terms
}

// Stage 2: Concept Extraction
interface ConceptSet {
  symbols: SymbolReference[];          // Direct symbol mentions
  types: TypeReference[];              // Type/class/interface mentions
  modules: ModuleReference[];          // Module/package mentions
  patterns: PatternReference[];        // Architectural patterns (auth, middleware, etc.)
  confidence: number;                  // 0-1 extraction confidence
}

// Stage 3: Entry Point Selection
interface EntryPointSet {
  primary: SymbolNode[];               // High-confidence starting nodes
  secondary: SymbolNode[];             // Lower-confidence expansion seeds
  scores: Map<SymbolId, EntryScore>;   // Composite entry scores
}

// Stage 4: Graph Traversal
interface TraversalResult {
  visited: SymbolNode[];               // All reached nodes
  edges: DependencyEdge[];             // Traversed edges
  depths: Map<SymbolId, number>;       // Distance from entry points
  cycles: CycleInfo[];                 // Detected cycles with resolution
}

// Stage 5: Symbol Ranking
interface RankedSymbolList {
  symbols: RankedSymbol[];             // Sorted by composite score
  scores: Map<SymbolId, RankScore>;    // Detailed breakdown
}

// Stage 6: Token Budgeting
interface BudgetedSymbols {
  selected: RankedSymbol[];            // Fits within budget
  truncated: RankedSymbol[];           // Excluded due to budget
  budget: TokenBudget;                 // Allocation details
}

// Stage 7: Context Assembly
interface StructuredContext {
  entryPoints: SymbolContext[];        // Primary symbols with full context
  dependencies: SymbolContext[];       // Upstream dependencies
  dependents: SymbolContext[];         // Downstream dependents
  types: TypeDefinition[];             // Referenced type definitions
  config: ConfigFragment[];            // Relevant configuration
  metadata: ContextMetadata;           // Budget usage, coverage stats
}
```

---

## 3. Public API

### 3.1 Core Interface

```typescript
// src/context-builder/context-builder.ts
export interface ContextBuilder {
  /**
   * Build minimal context for a natural language query.
   * Pure function - no side effects, no LLM calls.
   */
  buildContext(request: BuildContextRequest): Promise<StructuredContext>;
}

export interface BuildContextRequest {
  query: string;                       // User's natural language request
  knowledgeGraph: KnowledgeGraph;      // Pre-built repository knowledge graph
  options?: ContextBuilderOptions;
}

export interface ContextBuilderOptions {
  tokenBudget: TokenBudget;            // Hard token limit
  maxDepth?: number;                   // Max traversal depth (default: 3)
  maxEntryPoints?: number;             // Max entry points (default: 5)
  includeTypes?: boolean;              // Include type definitions (default: true)
  includeConfig?: boolean;             // Include config fragments (default: true)
  includeTests?: boolean;              // Include test files (default: false)
  rankingStrategy?: RankingStrategy;   // Ranking algorithm (default: COMPOSITE)
  traversalStrategy?: TraversalStrategy; // Traversal algorithm (default: WEIGHTED_BFS)
  determinismSeed?: number;            // For reproducible ordering
}

export interface TokenBudget {
  maxTokens: number;                   // Hard ceiling (e.g., 8000)
  reserveTokens: number;               // Reserve for prompt/response (e.g., 2000)
  entryPointRatio: number;             // % for entry points (e.g., 0.4)
  dependencyRatio: number;             // % for dependencies (e.g., 0.35)
  dependentRatio: number;              // % for dependents (e.g., 0.15)
  typeRatio: number;                   // % for types (e.g., 0.1)
  configRatio: number;                 // % for config (e.g., 0.05)
}

export interface StructuredContext {
  entryPoints: SymbolContext[];
  dependencies: SymbolContext[];
  dependents: SymbolContext[];
  types: TypeDefinition[];
  config: ConfigFragment[];
  metadata: ContextMetadata;
}

export interface SymbolContext {
  symbol: SymbolNode;
  sourceCode: string;                  // Relevant source excerpt
  signature: SymbolSignature;          // Parsed signature
  docComment?: string;                 // JSDoc/TSDoc if available
  tokens: number;                      // Estimated token count
}

export interface ContextMetadata {
  totalTokens: number;
  budget: TokenBudget;
  coverage: CoverageMetrics;
  entryPointsUsed: number;
  traversalDepth: number;
  cyclesDetected: number;
  truncated: boolean;
  buildTimeMs: number;
}
```

### 3.2 Factory & Configuration

```typescript
// src/context-builder/context-builder-factory.ts
export interface ContextBuilderFactory {
  create(options: ContextBuilderOptions): ContextBuilder;
  createDefault(): ContextBuilder;
}

// Preset configurations for common use cases
export const ContextBuilderPresets = {
  // Minimal context for quick explanations
  EXPLAIN: {
    tokenBudget: { maxTokens: 4000, reserveTokens: 1000, ... },
    maxDepth: 2,
    maxEntryPoints: 3,
    includeTests: false,
  },

  // Comprehensive context for complex refactoring
  REFACTOR: {
    tokenBudget: { maxTokens: 12000, reserveTokens: 2000, ... },
    maxDepth: 4,
    maxEntryPoints: 8,
    includeTests: true,
  },

  // Focused context for debugging
  DEBUG: {
    tokenBudget: { maxTokens: 6000, reserveTokens: 1500, ... },
    maxDepth: 3,
    maxEntryPoints: 5,
    includeTests: true,
    rankingStrategy: RankingStrategy.DEPENDENCY_DISTANCE,
  },

  // Broad context for code review
  REVIEW: {
    tokenBudget: { maxTokens: 16000, reserveTokens: 3000, ... },
    maxDepth: 3,
    maxEntryPoints: 10,
    includeTests: true,
    traversalStrategy: TraversalStrategy.WEIGHTED_BFS,
  },
};
```

---

## 4. Internal Modules

### 4.1 Module Structure

```
src/context-builder/
├── context-builder.ts              # Main facade
├── context-builder-factory.ts      # Factory & presets
├── query-analyzer/
│   ├── query-analyzer.ts
│   ├── intent-classifier.ts
│   ├── constraint-extractor.ts
│   └── scope-hint-parser.ts
├── concept-extractor/
│   ├── concept-extractor.ts
│   ├── symbol-matcher.ts
│   ├── type-matcher.ts
│   ├── module-matcher.ts
│   └── pattern-matcher.ts
├── entry-point-selector/
│   ├── entry-point-selector.ts
│   ├── semantic-scorer.ts
│   ├── centrality-scorer.ts
│   ├── importance-heuristics.ts
│   └── composite-scorer.ts
├── graph-traversal/
│   ├── graph-traversal.ts
│   ├── bfs-traversal.ts
│   ├── dfs-traversal.ts
│   ├── weighted-bfs.ts
│   ├── cycle-detector.ts
│   └── depth-limiter.ts
├── ranking/
│   ├── symbol-ranker.ts
│   ├── relevance-scorer.ts
│   ├── structural-scorer.ts
│   ├── dependency-distance-scorer.ts
│   └── composite-ranker.ts
├── token-budget/
│   ├── token-budget.ts
│   ├── budget-calculator.ts
│   ├── priority-queue.ts
│   ├── truncation-strategy.ts
│   └── token-estimator.ts
├── context-assembler/
│   ├── context-assembler.ts
│   ├── source-extractor.ts
│   ├── signature-parser.ts
│   ├── config-extractor.ts
│   └── metadata-builder.ts
└── types/
    ├── context-types.ts
    ├── query-types.ts
    ├── graph-types.ts
    └── scoring-types.ts
```

### 4.2 Module Responsibilities

| Module | Responsibility | Key Algorithm |
|--------|----------------|---------------|
| **QueryAnalyzer** | Parse NL → structured intent | Rule-based + keyword extraction |
| **ConceptExtractor** | Map terms → KG nodes | Exact match → fuzzy → alias resolution |
| **EntryPointSelector** | Rank & select seed nodes | Composite scoring (semantic + structural) |
| **GraphTraversal** | Expand context via edges | Weighted BFS with cycle detection |
| **SymbolRanker** | Score relevance of visited nodes | Multi-factor composite ranking |
| **TokenBudget** | Allocate tokens across categories | Priority queue + proportional allocation |
| **ContextAssembler** | Build final structured output | Source extraction + token estimation |

---

## 5. Ranking Strategy

### 5.1 Multi-Factor Scoring Model

```
CompositeScore = w₁×Relevance + w₂×StructuralImportance + w₃×DependencyDistance + w₄×Recency + w₅×TestCoverage
```

| Factor | Weight | Computation |
|--------|--------|-------------|
| **Relevance** | 0.35 | Semantic match between query concepts & symbol |
| **StructuralImportance** | 0.25 | PageRank / betweenness centrality in KG |
| **DependencyDistance** | 0.20 | Inverse of graph distance from entry points |
| **Recency** | 0.10 | Git commit recency (normalized) |
| **TestCoverage** | 0.10 | Test file association bonus |

### 5.2 Relevance Scoring

```typescript
// Semantic relevance without embeddings
interface RelevanceScorer {
  score(symbol: SymbolNode, concepts: ConceptSet): number;
}

class DefaultRelevanceScorer implements RelevanceScorer {
  score(symbol: SymbolNode, concepts: ConceptSet): number {
    let score = 0;

    // Exact name match
    if (concepts.symbols.some(s => s.name === symbol.name)) score += 1.0;

    // Fuzzy name match (substring, camelCase split)
    if (concepts.symbols.some(s => fuzzyMatch(s.name, symbol.name))) score += 0.7;

    // Type match
    if (concepts.types.some(t => t.name === symbol.typeName)) score += 0.8;

    // Module match
    if (concepts.modules.some(m => m.path === symbol.filePath)) score += 0.6;

    // Pattern match (auth, middleware, etc.)
    if (concepts.patterns.some(p => p.matches(symbol))) score += 0.5;

    // Doc comment keyword overlap
    score += keywordOverlap(symbol.docComment, concepts.keywords) * 0.3;

    return Math.min(score, 1.0);
  }
}
```

### 5.3 Structural Importance

```typescript
// Pre-computed on KG build (offline)
interface StructuralMetrics {
  pageRank: number;                    // Global importance
  betweennessCentrality: number;       // Bridge/bottleneck score
  inDegree: number;                    // Dependents count
  outDegree: number;                   // Dependencies count
  clusterCoefficient: number;          // Module cohesion
}

class StructuralImportanceScorer {
  // Combines pre-computed metrics
  score(symbol: SymbolNode, metrics: StructuralMetrics): number {
    return (
      0.4 * normalize(metrics.pageRank) +
      0.3 * normalize(metrics.betweennessCentrality) +
      0.2 * normalize(metrics.inDegree) +
      0.1 * (1 - normalize(metrics.clusterCoefficient)) // Lower cohesion = more central
    );
  }
}
```

### 5.4 Dependency Distance

```typescript
class DependencyDistanceScorer {
  // Closer to entry points = higher score
  score(symbol: SymbolNode, depths: Map<SymbolId, number>): number {
    const depth = depths.get(symbol.id) ?? Infinity;
    if (depth === Infinity) return 0;
    if (depth === 0) return 1.0;          // Entry point itself
    if (depth === 1) return 0.8;          // Direct dependency
    if (depth === 2) return 0.5;          // Transitive
    if (depth === 3) return 0.2;          // Distant
    return 0.05;                          // Beyond budget depth
  }
}
```

---

## 6. Token Budgeting Strategy

### 6.1 Budget Allocation

```typescript
interface TokenBudget {
  maxTokens: number;        // e.g., 8000
  reserveTokens: number;    // e.g., 2000 (for prompt template + response)
  allocations: Allocation[];
}

interface Allocation {
  category: ContextCategory;
  ratio: number;            // Proportion of available tokens
  minTokens: number;        // Guaranteed minimum
  maxTokens: number;        // Category ceiling
}

const DEFAULT_ALLOCATIONS: Allocation[] = [
  { category: 'ENTRY_POINTS', ratio: 0.40, minTokens: 500, maxTokens: 4000 },
  { category: 'DEPENDENCIES', ratio: 0.35, minTokens: 300, maxTokens: 3000 },
  { category: 'DEPENDENTS',   ratio: 0.15, minTokens: 100, maxTokens: 1500 },
  { category: 'TYPES',        ratio: 0.07, minTokens: 50,  maxTokens: 800  },
  { category: 'CONFIG',       ratio: 0.03, minTokens: 20,  maxTokens: 400  },
];
```

### 6.2 Priority Queue Selection

```typescript
class TokenBudgetAllocator {
  allocate(rankedSymbols: RankedSymbol[], budget: TokenBudget): BudgetedSymbols {
    const available = budget.maxTokens - budget.reserveTokens;
    const selected: RankedSymbol[] = [];
    const truncated: RankedSymbol[] = [];

    // Group by category
    const byCategory = groupByCategory(rankedSymbols);

    // Allocate per category
    for (const alloc of budget.allocations) {
      const categoryTokens = Math.floor(available * alloc.ratio);
      const categoryBudget = Math.min(Math.max(categoryTokens, alloc.minTokens), alloc.maxTokens);

      const candidates = byCategory.get(alloc.category) ?? [];
      const { selected: catSelected, truncated: catTruncated } =
        this.selectByPriority(candidates, categoryBudget);

      selected.push(...catSelected);
      truncated.push(...catTruncated);
    }

    return { selected, truncated, budget: { ...budget, used: sumTokens(selected) } };
  }

  private selectByPriority(symbols: RankedSymbol[], budget: number) {
    // Sort by composite rank (already sorted)
    // Greedy selection until budget exhausted
    let used = 0;
    const selected: RankedSymbol[] = [];
    const truncated: RankedSymbol[] = [];

    for (const sym of symbols) {
      if (used + sym.estimatedTokens <= budget) {
        selected.push(sym);
        used += sym.estimatedTokens;
      } else {
        truncated.push(sym);
      }
    }

    return { selected, truncated };
  }
}
```

### 6.3 Token Estimation

```typescript
class TokenEstimator {
  // Character-based estimation (no tokenizer dependency)
  // ~4 chars/token for code, ~3.5 for comments
  estimate(symbol: SymbolNode, sourceCode: string): number {
    const codeTokens = Math.ceil(sourceCode.length / 4);
    const signatureTokens = Math.ceil(symbol.signature.length / 4);
    const docTokens = symbol.docComment ? Math.ceil(symbol.docComment.length / 3.5) : 0;
    const overhead = 50; // Metadata, formatting

    return codeTokens + signatureTokens + docTokens + overhead;
  }
}
```

---

## 7. Graph Traversal Strategy

### 7.1 Traversal Algorithms

```typescript
type TraversalStrategy = 'BFS' | 'DFS' | 'WEIGHTED_BFS' | 'PAGERANK_BFS';

interface GraphTraversal {
  traverse(entryPoints: SymbolNode[], graph: KnowledgeGraph, options: TraversalOptions): TraversalResult;
}

interface TraversalOptions {
  maxDepth: number;
  maxNodes: number;
  edgeWeights: EdgeWeightConfig;
  cyclePolicy: CyclePolicy;
}
```

#### 7.1.1 Weighted BFS (Default)

```typescript
class WeightedBFSTraversal implements GraphTraversal {
  traverse(entryPoints: SymbolNode[], graph: KnowledgeGraph, options: TraversalOptions): TraversalResult {
    const queue: TraversalItem[] = entryPoints.map(ep => ({
      node: ep,
      depth: 0,
      path: [ep.id],
      weight: 1.0
    }));

    const visited = new Map<SymbolId, TraversalState>();
    const edges: DependencyEdge[] = [];
    const cycles: CycleInfo[] = [];

    while (queue.length > 0 && visited.size < options.maxNodes) {
      // Sort by weight descending (priority queue behavior)
      queue.sort((a, b) => b.weight - a.weight);
      const current = queue.shift()!;

      if (current.depth > options.maxDepth) continue;

      const existing = visited.get(current.node.id);
      if (existing) {
        // Cycle detected
        if (options.cyclePolicy === 'RECORD') {
          cycles.push({ path: current.path, depth: current.depth });
        }
        if (options.cyclePolicy === 'PRUNE' && existing.depth <= current.depth) {
          continue; // Skip deeper revisit
        }
      }

      visited.set(current.node.id, { depth: current.depth, weight: current.weight });

      // Expand neighbors
      for (const edge of graph.getOutgoingEdges(current.node.id)) {
        const neighbor = graph.getNode(edge.targetId);
        if (!neighbor) continue;

        const edgeWeight = this.computeEdgeWeight(edge, options.edgeWeights);
        const newWeight = current.weight * edgeWeight;

        queue.push({
          node: neighbor,
          depth: current.depth + 1,
          path: [...current.path, neighbor.id],
          weight: newWeight
        });

        edges.push(edge);
      }
    }

    return { visited: Array.from(visited.keys()).map(id => graph.getNode(id)!), edges, depths: ..., cycles };
  }

  private computeEdgeWeight(edge: DependencyEdge, config: EdgeWeightConfig): number {
    switch (edge.type) {
      case 'IMPORTS': return config.importWeight ?? 1.0;
      case 'EXTENDS': return config.extendsWeight ?? 0.9;
      case 'IMPLEMENTS': return config.implementsWeight ?? 0.85;
      case 'CALLS': return config.callsWeight ?? 0.7;
      case 'REFERENCES': return config.referencesWeight ?? 0.6;
      case 'TYPE_USES': return config.typeUsesWeight ?? 0.8;
      default: return 0.5;
    }
  }
}
```

### 7.2 Cycle Detection & Prevention

```typescript
enum CyclePolicy {
  RECORD,    // Track cycles, continue traversal
  PRUNE,     // Skip revisiting at same or deeper depth
  BREAK      // Stop traversal on cycle detection
}

class CycleDetector {
  detect(path: SymbolId[]): CycleInfo | null {
    const seen = new Set<SymbolId>();
    for (const id of path) {
      if (seen.has(id)) {
        const cycleStart = path.indexOf(id);
        return {
          cycle: path.slice(cycleStart),
          length: path.length - cycleStart,
          entryPoint: id
        };
      }
      seen.add(id);
    }
    return null;
  }
}
```

### 7.3 Deterministic Ordering

```typescript
class DeterministicOrdering {
  // Stable sort for reproducible results
  static sortSymbols(symbols: SymbolNode[], seed: number): SymbolNode[] {
    return [...symbols].sort((a, b) => {
      // Primary: composite rank (descending)
      if (a.compositeScore !== b.compositeScore) {
        return b.compositeScore - a.compositeScore;
      }
      // Secondary: depth (ascending - closer first)
      if (a.depth !== b.depth) {
        return a.depth - b.depth;
      }
      // Tertiary: structural importance (descending)
      if (a.structuralScore !== b.structuralScore) {
        return b.structuralScore - a.structuralScore;
      }
      // Quaternary: stable ID sort (deterministic)
      return a.id.localeCompare(b.id);
    });
  }
}
```

---

## 8. Complexity Analysis

### 8.1 Time Complexity

| Stage | Complexity | Notes |
|-------|------------|-------|
| Query Analysis | O(Q) | Q = query length |
| Concept Extraction | O(C × log N) | C = concepts, N = KG nodes (indexed lookup) |
| Entry Point Selection | O(N log N) | Scoring all candidate nodes |
| Graph Traversal | O(V + E) | V = visited nodes, E = traversed edges |
| Symbol Ranking | O(V log V) | Sorting visited nodes |
| Token Budgeting | O(V) | Single pass with priority queue |
| Context Assembly | O(S × L) | S = selected symbols, L = avg source length |

**Overall**: O(N log N + V + E) where N = KG size, V = visited subset

### 8.2 Space Complexity

| Component | Space |
|-----------|-------|
| Knowledge Graph | O(N + E) - persisted, not in memory per request |
| Traversal State | O(V) - visited map, queue |
| Ranking Scores | O(V) - score maps |
| Context Output | O(S × L) - proportional to token budget |

### 8.3 Scalability Targets

| Repository Size | KG Nodes | Typical V | Build Time | Memory |
|-----------------|----------|-----------|------------|--------|
| Small (<10k LOC) | ~5,000 | ~50-100 | <50ms | <10MB |
| Medium (100k LOC) | ~50,000 | ~200-500 | <200ms | <50MB |
| Large (1M LOC) | ~500,000 | ~500-1000 | <500ms | <200MB |

---

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Over-fetching context** | High | High | Strict token budgeting, configurable ratios |
| **Missing critical symbols** | Medium | High | Multi-factor ranking, entry point diversity |
| **Cycle explosion in dense graphs** | Medium | Medium | Cycle detection + PRUNE policy, depth limits |
| **Non-deterministic output** | Low | Medium | Deterministic sorting with seed |
| **Token estimation inaccuracy** | Medium | Medium | Conservative estimation (4 chars/token), validation |
| **Query ambiguity** | High | Medium | Constraint extraction, scope hints, fallback to broader context |
| **KG staleness** | Medium | High | Incremental KG updates, version checking |
| **Large file token blowup** | Low | High | Per-file token caps, smart excerpting |

---

## 10. Future Extension Points

### 10.1 Pluggable Scorers

```typescript
interface ScorerPlugin {
  name: string;
  weight: number;
  score(symbol: SymbolNode, context: ScoringContext): number;
}

// Register custom scorers
ContextBuilder.registerScorer(new CustomBusinessLogicScorer());
```

### 10.2 Traversal Strategies

```typescript
interface TraversalStrategyPlugin {
  name: string;
  traverse(entryPoints: SymbolNode[], graph: KnowledgeGraph, options: TraversalOptions): TraversalResult;
}

// Examples: Bidirectional, Relevance-guided, Community-based
```

### 10.3 Budget Policies

```typescript
interface BudgetPolicyPlugin {
  name: string;
  allocate(budget: TokenBudget, ranked: RankedSymbol[]): BudgetedSymbols;
}

// Examples: Adaptive (based on query complexity), Task-specific
```

### 10.4 Context Formatters

```typescript
interface ContextFormatter {
  format(context: StructuredContext): string | object;
}

// Built-in: Markdown, JSON, XML, Prompt-optimized
// Custom: OpenAI function calling, Anthropic tool use, etc.
```

### 10.5 Learning Integration

```typescript
interface FeedbackCollector {
  record(query: string, context: StructuredContext, outcome: FeedbackOutcome): void;
}

// Enables future: ranking weight optimization via bandits/RL
```

---

## 11. Model-Agnostic Guarantees

The Context Builder **never**:

- Calls any LLM API
- Uses embeddings or vector search
- Generates prompts or prompt templates
- Makes assumptions about context window size (configurable via `TokenBudget`)
- Requires specific model capabilities (function calling, structured output, etc.)
- Depends on any external service

It **only**:

- Operates on the in-memory Knowledge Graph
- Produces structured data (`StructuredContext`)
- Uses deterministic algorithms
- Respects explicit token budgets
- Exposes pure TypeScript interfaces

---

## 12. Acceptance Criteria

| Criterion | Test |
|-----------|------|
| **Minimal context** | For "explain auth", context < 2000 tokens, includes AuthController→AuthService→UserRepository→JWT |
| **Token budget respected** | Output tokens ≤ `maxTokens - reserveTokens` for all presets |
| **Deterministic** | Same query + KG + seed → identical `StructuredContext` |
| **Cycle safe** | Circular deps (A→B→A) don't cause infinite loops |
| **Depth bounded** | No symbols beyond `maxDepth` in output |
| **Model agnostic** | No imports from LLM SDKs, no API calls in tests |
| **Extensible** | Can swap ranking/traversal/budget via plugins |

---

## Appendix: Type Definitions Reference

```typescript
// Core KG types (from upstream)
interface KnowledgeGraph {
  getNode(id: SymbolId): SymbolNode | undefined;
  getNodes(): SymbolNode[];
  getOutgoingEdges(id: SymbolId): DependencyEdge[];
  getIncomingEdges(id: SymbolId): DependencyEdge[];
  getSymbolIndex(): SymbolIndex;  // Name → SymbolId mapping
}

interface SymbolNode {
  id: SymbolId;
  name: string;
  kind: SymbolKind;           // FUNCTION | CLASS | INTERFACE | TYPE | VARIABLE | MODULE
  filePath: string;
  startLine: number;
  endLine: number;
  signature: string;
  docComment?: string;
  typeName?: string;
  modulePath: string;
  exports: boolean;
}

interface DependencyEdge {
  sourceId: SymbolId;
  targetId: SymbolId;
  type: EdgeType;             // IMPORTS | EXTENDS | IMPLEMENTS | CALLS | REFERENCES | TYPE_USES
  weight?: number;            // Static analysis confidence
}
```

---

*End of Design Document*