import type { IntentKind, ClassifyIntentResult } from './types.js';

interface IntentRule {
  intent: IntentKind;
  patterns: RegExp[];
  keywords: string[];
}

const INTENT_RULES: IntentRule[] = [
  {
    intent: 'FindDependencies',
    patterns: [
      /^what\s+depends\s+on\s/i,
      /^what\s+(does|do)\s+.+\s+depend\s+on/i,
      /^find\s+depend(encies|ents)\s+of\s/i,
      /^show\s+(the\s+)?depend(encies|ents)\s+(of\s|for\s)/i,
      /^what\s+is\s+used\s+by\s/i,
      /^who\s+uses\s+/i,
      /^what\s+imports\s+/i,
      /^find\s+all\s+depend(encies|ents)\s+of\s/i,
    ],
    keywords: ['depends', 'dependency', 'dependencies', 'dependents', 'imports', 'uses', 'used by'],
  },
  {
    intent: 'Architecture',
    patterns: [
      /^show\s+(me\s+)?(the\s+)?architecture/i,
      /^what\s+is\s+(the\s+)?architecture/i,
      /^describe\s+(the\s+)?(project\s+)?architecture/i,
      /^show\s+(me\s+)?(the\s+\w+\s+)?structure/i,
      /^what\s+is\s+(the\s+)?structure/i,
      /^list\s+(all\s+)?(services|modules|repositories)/i,
      /^show\s+(all\s+)?(modules|services|repositories)/i,
      /^how\s+is\s+(the\s+)?project\s+organized/i,
    ],
    keywords: ['architecture', 'structure', 'overview', 'services', 'modules', 'repositories', 'organized'],
  },
  {
    intent: 'FindSymbol',
    patterns: [
      /^find\s+(the\s+\w+\s+)?(class|function|interface|type|enum|variable|method|module|service|controller|repository|component)\s/i,
      /^search\s+for\s+(a\s+|the\s+)?(class|function|interface|type|enum|variable|method|module|service|controller|repository|component)\s/i,
      /^where\s+(is|are)\s+(the\s+\w+\s+)?(class|function|interface|type|enum|variable|method|module|service|controller|repository|component)\s/i,
      /^find\s+(the\s+)?\w+Service\b/i,
      /^find\s+(the\s+)?\w+Repository\b/i,
      /^find\s+(the\s+)?\w+Controller\b/i,
      /^find\s+(the\s+)?\w+Handler\b/i,
      /^find\s+(the\s+)?\w+Component\b/i,
      /^locate\s+/i,
      /^where\s+is\s+\w+/i,
    ],
    keywords: ['find', 'locate', 'symbol', 'class', 'function', 'interface', 'type', 'enum', 'variable', 'method'],
  },
  {
    intent: 'ExplainCode',
    patterns: [
      /^explain\s/i,
      /^describe\s+(?!architecture)/i,
      /^how\s+(does|do)\s/i,
      /^tell\s+me\s+about\s/i,
      /^what\s+is\s+the\s+purpose\s+of\s/i,
      /^how\s+does\s+\w+\s+work/i,
      /^what\s+(does|do)\s+.+\s+(do|mean|contain|include)/i,
      /^what\s+is\s+(?!architecture|structure)/i,
    ],
    keywords: ['explain', 'purpose', 'mean'],
  },
  {
    intent: 'Search',
    patterns: [
      /^search\s+for\s+/i,
      /^search\s+\w+/i,
      /^look\s+up\s+/i,
      /^grep\s+/i,
      /^filter\s+/i,
      /^find\s+/i,
    ],
    keywords: ['search', 'look up', 'grep', 'filter'],
  },
];

export function classifyIntent(question: string): ClassifyIntentResult {
  const normalized = question.trim().toLowerCase();

  if (!normalized) {
    return { intent: 'Unknown', confidence: 1.0, keywords: [] };
  }

  let bestMatch: ClassifyIntentResult = { intent: 'Unknown', confidence: 0, keywords: [] };

  for (const rule of INTENT_RULES) {
    let matched = false;

    for (const pattern of rule.patterns) {
      if (pattern.test(normalized)) {
        matched = true;
        break;
      }
    }

    if (matched) {
      const matchedKeywords = rule.keywords.filter((kw) => normalized.includes(kw));
      const confidence = Math.min(0.5 + matchedKeywords.length * 0.15, 0.95);

      if (confidence > bestMatch.confidence) {
        bestMatch = {
          intent: rule.intent,
          confidence,
          keywords: matchedKeywords,
        };
      }
    }
  }

  return bestMatch;
}
