/**
 * @devforge/benchmark — Dataset construction and lookup (DF-024).
 *
 * Datasets are immutable versioned bundles of fixture repositories plus tasks.
 * Construction normalizes defaults (schema version, task versions) so the
 * same input always produces the same dataset.
 */
import {
  DATASET_SCHEMA_VERSION,
  type BenchmarkDataset,
  type BenchmarkTask,
  type DatasetRepository,
} from "./types.js";

export interface DatasetInput {
  readonly datasetName: string;
  readonly datasetVersion?: string;
  readonly repositories?: readonly DatasetRepository[];
  readonly tasks: readonly BenchmarkTask[];
  readonly metadata?: Readonly<Record<string, string>>;
}

/** Build a normalized dataset with schema/version defaults applied. */
export function createDataset(input: DatasetInput): BenchmarkDataset {
  const tasks = input.tasks.map((task) => ({
    ...task,
    version: task.version ?? 1,
  }));
  return {
    datasetName: input.datasetName,
    datasetVersion: input.datasetVersion ?? "1.0.0",
    schemaVersion: DATASET_SCHEMA_VERSION,
    repositories: input.repositories ?? [],
    tasks,
    metadata: input.metadata,
  };
}

/** Look up a task by id; undefined when absent. */
export function taskById(
  dataset: BenchmarkDataset,
  id: string,
): BenchmarkTask | undefined {
  return dataset.tasks.find((task) => task.id === id);
}

/** True when the dataset contains the given task id. */
export function hasTask(dataset: BenchmarkDataset, id: string): boolean {
  return taskById(dataset, id) !== undefined;
}

/** The repository a task runs against; undefined when not declared. */
export function repositoryFor(
  dataset: BenchmarkDataset,
  task: BenchmarkTask,
): DatasetRepository | undefined {
  return dataset.repositories.find(
    (repository) => repository.id === task.repository.id,
  );
}

/** Sorted unique task ids — canonical enumeration order. */
export function taskIds(dataset: BenchmarkDataset): string[] {
  return Array.from(
    new Set(dataset.tasks.map((task) => task.id)),
  ).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Deterministic task ordering used for execution and results. */
export function orderTasks(
  dataset: BenchmarkDataset,
  order: "dataset" | "id" = "dataset",
): BenchmarkTask[] {
  const tasks = Array.from(dataset.tasks);
  if (order === "id") {
    return tasks.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  return tasks;
}

/** Per-task version map keyed by task id. */
export function taskVersions(dataset: BenchmarkDataset): Map<string, number> {
  const versions = new Map<string, number>();
  for (const task of dataset.tasks) {
    versions.set(task.id, task.version ?? 1);
  }
  return versions;
}

/** Count tasks per category, ordered alphabetically (deterministic). */
export function tasksByCategory(
  dataset: BenchmarkDataset,
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const task of dataset.tasks) {
    counts[task.category] = (counts[task.category] ?? 0) + 1;
  }
  const sorted: Record<string, number> = {};
  for (const category of Object.keys(counts).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    sorted[category] = counts[category] as number;
  }
  return sorted;
}