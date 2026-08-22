/**
 * @devforge/memory — Summarization (DF-023).
 *
 * The base implementation, {@link DeterministicSummarizer}, summarizes
 * structured memory purely offline with no network access and no AI model.
 * Future model-backed summarizers implement the injectable {@link Summarizer}
 * interface.
 */
import { compare } from "./ids.js";
import type { MemoryRecord, MemoryType } from "./types.js";

export interface Summarizer {
  /** A deterministic one-line summary of a single record. */
  summarize(record: MemoryRecord): string;
  /** Deterministic, ordered summary of many records. */
  summarizeMany(records: readonly MemoryRecord[]): string;
  /** A deterministic multi-line digest of the repository's memory. */
  digest(records: readonly MemoryRecord[]): string;
}

/** Human-readable labels for the memory types. */
export const TYPE_LABELS: Readonly<Record<MemoryType, string>> = {
  architecture: "Architecture",
  convention: "Convention",
  decision: "Decision",
  task: "Task",
  failure: "Failure",
  session: "Session",
};

/**
 * Fully offline, fully deterministic summarizer. Output for the same record is
 * byte-identical on every invocation; ordering of many-record summaries is by
 * record id.
 */
export class DeterministicSummarizer implements Summarizer {
  summarize(record: MemoryRecord): string {
    const label = TYPE_LABELS[record.type];
    switch (record.type) {
      case "architecture": {
        const constraints =
          record.data.constraints.length > 0
            ? ` constraints: ${record.data.constraints.join("; ")}`
            : "";
        return `[${label}] ${record.title}: ${record.data.owner} owns ${record.data.responsibility}.${constraints}`;
      }
      case "convention":
        return `[${label}:${record.data.category}] ${record.title}: ${record.data.convention}`;
      case "decision": {
        const supersedes = record.supersedes
          ? ` (supersedes ${record.supersedes})`
          : "";
        const superseded = record.supersededBy
          ? ` (superseded by ${record.supersededBy})`
          : "";
        return `[${label}] ${record.title}: ${record.data.decision} — rationale: ${record.data.rationale}${supersedes}${superseded}`;
      }
      case "task": {
        const files = `${record.data.affectedFiles.length} files`;
        const repairs = record.data.repairs.length > 0
          ? `; repairs: ${record.data.repairs.length}`
          : "";
        return `[${label}:${record.data.outcome}] ${record.title}: ${record.data.task} (${files}${repairs})`;
      }
      case "failure":
        return `[${label}:${record.data.result}] ${record.title} (${record.data.errorCategory} @ ${record.data.affectedSubsystem})`;
      case "session": {
        const actions = `${record.data.actions.length} actions`;
        const discoveries = `${record.data.discoveries.length} discoveries`;
        return `[${label}] ${record.title}: ${record.data.userRequest} (${actions}; ${discoveries})`;
      }
    }
  }

  summarizeMany(records: readonly MemoryRecord[]): string {
    return records
      .slice()
      .sort((a, b) => compare(a.id, b.id))
      .map((record) => this.summarize(record))
      .join("\n");
  }

  digest(records: readonly MemoryRecord[]): string {
    const counts: Record<MemoryType, number> = {
      architecture: 0,
      convention: 0,
      decision: 0,
      task: 0,
      failure: 0,
      session: 0,
    };
    for (const record of records) counts[record.type] += 1;
    const header = `Memory digest for ${records.length} record(s):`;
    const lines = (Object.keys(counts) as MemoryType[])
      .filter((type) => counts[type] > 0)
      .sort(compare)
      .map((type) => `  ${TYPE_LABELS[type]}: ${counts[type]}`);
    return [header, ...lines].join("\n");
  }
}

/** Shared instance for consumers that want a default offline summarizer. */
export const deterministicSummarizer = new DeterministicSummarizer();