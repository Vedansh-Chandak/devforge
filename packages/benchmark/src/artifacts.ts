/**
 * @devforge/benchmark — Artifacts (DF-024).
 *
 * Execution artifacts (stdout, stderr, diffs, patches, events, verification
 * and agent reports, failure diagnostics) are stored separately from results
 * and only when explicitly enabled. Everything is redacted before
 * persistence; credentials and environment dumps are never stored.
 */
import type { FileSystemIO } from "./file-system.js";
import type { AgentRunResult, TaskResult } from "./types.js";
import { ArtifactAccessError } from "./errors.js";
import { patchToText } from "./patch.js";
import { redactValue } from "./redact.js";

export const ARTIFACT_KINDS = [
  "stdout",
  "stderr",
  "diff",
  "patch",
  "events",
  "verification",
  "agent",
  "failure",
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export interface Artifact {
  readonly kind: ArtifactKind;
  readonly name: string;
  readonly content: string;
}

export interface ArtifactOptions {
  /** Master switch; defaults to true when an artifact store is configured. */
  readonly enabled?: boolean;
  /** Explicit allow-list of kinds to store (default: all kinds). */
  readonly include?: readonly ArtifactKind[];
  /** Per-artifact byte cap; truncated deterministically when exceeded. */
  readonly maxBytes?: number;
  /** Redactor applied before persistence. */
  readonly redactor?: (text: string) => string;
}

export interface ArtifactStore {
  save(runId: string, taskId: string, artifact: Artifact): Promise<string | null>;
  list(runId: string, taskId?: string): Promise<string[]>;
  read(runId: string, taskId: string, name: string): Promise<string | null>;
}

/** Deterministic truncation with a fixed marker. */
export function truncate(content: string, maxBytes: number): string {
  if (content.length <= maxBytes) return content;
  return `${content.slice(0, maxBytes)}...[truncated]`;
}

interface Storable {
  readonly runId: string;
  readonly taskId: string;
  readonly artifact: Artifact;
}

function sanitize(options: ArtifactOptions, content: string): string {
  let value = content;
  if (options.redactor) value = options.redactor(value);
  if (options.maxBytes !== undefined) value = truncate(value, options.maxBytes);
  return value;
}

/** In-memory artifact store for tests and ephemeral use. */
export class MemoryArtifactStore implements ArtifactStore {
  readonly artifacts = new Map<string, string>();

  constructor(private readonly options: ArtifactOptions = {}) {}

  private keyFor(runId: string, taskId: string, name: string): string {
    return `${runId}/${taskId}/${name}`;
  }

  async save(
    runId: string,
    taskId: string,
    artifact: Artifact,
  ): Promise<string | null> {
    if (this.options.enabled === false) return null;
    if (
      this.options.include !== undefined &&
      !this.options.include.includes(artifact.kind)
    ) {
      return null;
    }
    const key = this.keyFor(runId, taskId, `${artifact.kind}-${artifact.name}`);
    this.artifacts.set(key, sanitize(this.options, artifact.content));
    return key;
  }

  async list(runId: string, taskId?: string): Promise<string[]> {
    const prefix = taskId === undefined ? `${runId}/` : `${runId}/${taskId}/`;
    return Array.from(this.artifacts.keys())
      .filter((key) => key.startsWith(prefix))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  async read(
    runId: string,
    taskId: string,
    name: string,
  ): Promise<string | null> {
    return this.artifacts.get(this.keyFor(runId, taskId, name)) ?? null;
  }
}

/** File-backed artifact store under `artifacts/<runId>/<taskId>/`. */
export class FileArtifactStore implements ArtifactStore {
  constructor(
    private readonly io: FileSystemIO,
    private readonly baseDir: string,
    private readonly options: ArtifactOptions = {},
  ) {}

  private dirFor(runId: string, taskId: string): string {
    return `${this.baseDir.replace(/\/+$/, "")}/${runId}/${taskId}`;
  }

  async save(
    runId: string,
    taskId: string,
    artifact: Artifact,
  ): Promise<string | null> {
    if (this.options.enabled === false) return null;
    if (
      this.options.include !== undefined &&
      !this.options.include.includes(artifact.kind)
    ) {
      return null;
    }
    const dir = this.dirFor(runId, taskId);
    await this.io.mkdir(dir);
    const filePath = `${dir}/${artifact.kind}-${artifact.name}.txt`;
    await this.io.writeFile(filePath, sanitize(this.options, artifact.content));
    return filePath;
  }

  async list(runId: string, taskId?: string): Promise<string[]> {
    try {
      const dirs = taskId === undefined ? [runId] : [`${runId}/${taskId}`];
      const names: string[] = [];
      for (const dir of dirs) {
        try {
          const entries = await this.io.listFiles(
            `${this.baseDir.replace(/\/+$/, "")}/${dir}`,
          );
          names.push(...entries);
        } catch {
          /* directory missing → no artifacts */
        }
      }
      return Array.from(new Set(names)).sort((a, b) =>
        a < b ? -1 : a > b ? 1 : 0,
      );
    } catch {
      return [];
    }
  }

  async read(
    runId: string,
    taskId: string,
    name: string,
  ): Promise<string | null> {
    const filePath = `${this.dirFor(runId, taskId)}/${name}.txt`;
    try {
      return await this.io.readFile(filePath);
    } catch {
      return null;
    }
  }
}

/** Default redactor from an explicit environment (skipped when absent). */
export function environmentRedactor(
  environment?: { get(name: string): string | undefined },
): (text: string) => string {
  return environment === undefined
    ? (text: string) => redactValue(text)
    : (text: string) => redactValue(text, { environment });
}

/** Standard artifacts for a finished task, as used by runners. */
export function buildTaskArtifacts(
  agent: AgentRunResult | null,
  result: TaskResult,
): Artifact[] {
  const artifacts: Artifact[] = [];
  const eventText = result.evidence.join("\n");
  if (eventText.length > 0) {
    artifacts.push({
      kind: "events",
      name: "events",
      content: eventText,
    });
  }
  artifacts.push({
    kind: "verification",
    name: "verification",
    content: `${result.grader.reason}\n${result.errors.join("\n")}`,
  });
  if (agent !== null) {
    const agentText = [
      `status: ${agent.status}`,
      `plan: ${agent.plan.summary}`,
      ...agent.steps.map(
        (step) => `${step.intent}: ${step.status} ${step.message}`,
      ),
    ].join("\n");
    artifacts.push({ kind: "agent", name: "agent", content: agentText });
    for (const step of agent.steps) {
      for (const command of step.commandsRun) {
        artifacts.push({ kind: "stdout", name: "stdout", content: command });
      }
    }
  }
  if (agent?.patch !== undefined) {
    const text = patchToText(agent.patch);
    artifacts.push({ kind: "patch", name: "patch", content: text });
    artifacts.push({ kind: "diff", name: "diff", content: text });
  }
  if (result.errors.length > 0) {
    artifacts.push({
      kind: "failure",
      name: "failure",
      content: result.errors.join("\n"),
    });
  }
  return artifacts;
}

export { ArtifactAccessError };