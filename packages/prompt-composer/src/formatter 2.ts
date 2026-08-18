import type {
  ComposerContext,
  ComposerSymbol,
  ComposerDependency,
  ComposerArchitecture,
} from './types.js';

/**
 * Formats repository context into readable, structured text.
 * Deterministic — stable ordering, consistent whitespace.
 */

export function formatSymbols(symbols: ComposerSymbol[]): string {
  if (symbols.length === 0) return '';
  const sorted = [...symbols].sort((a, b) => a.name.localeCompare(b.name));
  return sorted
    .map((s) => {
      const parts = [s.name];
      if (s.kind) parts.push(`— ${s.kind}`);
      if (s.file) parts.push(`— ${s.file}`);
      if (s.module) parts.push(`(${s.module})`);
      return `- ${parts.join(' ')}`;
    })
    .join('\n');
}

export function formatDependencies(dependencies: ComposerDependency[]): string {
  if (dependencies.length === 0) return '';
  const sorted = [...dependencies].sort((a, b) =>
    `${a.from}->${a.to}`.localeCompare(`${b.from}->${b.to}`),
  );
  return sorted.map((d) => `- ${d.from} → ${d.to}`).join('\n');
}

export function formatArchitecture(arch: ComposerArchitecture): string {
  const sections: string[] = [];

  const addSection = (label: string, items?: string[]) => {
    if (items && items.length > 0) {
      const sorted = [...items].sort((a, b) => a.localeCompare(b));
      sections.push(`${label}:\n${sorted.map((i) => `- ${i}`).join('\n')}`);
    }
  };

  addSection('Modules', arch.modules);
  addSection('Services', arch.services);
  addSection('APIs', arch.apis);
  addSection('Repositories', arch.repositories);
  addSection('Databases', arch.databases);

  if (arch.relationships && arch.relationships.length > 0) {
    sections.push(
      `Relationships:\n${formatDependencies(arch.relationships)}`,
    );
  }

  return sections.join('\n\n');
}

/**
 * Builds the user message content from question + context.
 * Delimits repository content clearly from the question.
 * Returns the user message content string.
 */
export function buildUserContent(
  question: string,
  context: ComposerContext,
): string {
  const sections: string[] = [];

  sections.push(`Question:\n${question}`);

  // Symbols section
  const symbolSection = formatSymbols(context.symbols || []);
  if (symbolSection) {
    sections.push(`Relevant Symbols:\n${symbolSection}`);
  }

  // Dependencies section
  const depSection = formatDependencies(context.dependencies || []);
  if (depSection) {
    sections.push(`Dependencies:\n${depSection}`);
  }

  // Architecture section
  if (context.architecture) {
    const archSection = formatArchitecture(context.architecture);
    if (archSection) {
      sections.push(`Architecture:\n${archSection}`);
    }
  }

  // Search results section
  if (context.searchResults && context.searchResults.length > 0) {
    const searchSection = formatSymbols(context.searchResults);
    sections.push(`Search Results:\n${searchSection}`);
  }

  // Raw context section
  if (context.raw && context.raw.trim().length > 0) {
    sections.push(`Additional Context:\n---\n${context.raw}\n---`);
  }

  return sections.join('\n\n');
}

/**
 * Truncates content deterministically to fit within character budget.
 * Truncates at the last complete line before the limit.
 */
export function truncateContent(
  content: string,
  maxChars: number,
): { content: string; truncated: boolean } {
  if (content.length <= maxChars) {
    return { content, truncated: false };
  }

  const cutoff = content.lastIndexOf('\n', maxChars - 1);
  const truncateAt = cutoff > 0 ? cutoff : maxChars;
  const truncatedContent =
    content.substring(0, truncateAt) +
    '\n\n[Context truncated — exceeds character limit]';

  return { content: truncatedContent, truncated: true };
}