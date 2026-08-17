/**
 * @devforge/benchmark — Dataset loading (DF-024).
 *
 * Loaders turn external representations (JSON files, in-memory values) into
 * validated {@link BenchmarkDataset} instances. Loading never touches the
 * network and never executes anything.
 */
import type { FileSystemIO } from "./file-system.js";
import {
  DATASET_SCHEMA_VERSION,
  type BenchmarkDataset,
  type BenchmarkTask,
  type DatasetRepository,
} from "./types.js";
import { createDataset, type DatasetInput } from "./dataset.js";
import { assertValidDataset } from "./task-validator.js";
import { DatasetError } from "./errors.js";

/** Any source that can produce a validated dataset. */
export interface DatasetLoader {
  load(ref: string): Promise<BenchmarkDataset>;
}

/** Loader over an arbitrary {@link FileSystemIO} (real or in-memory). */
export class JsonDatasetLoader implements DatasetLoader {
  constructor(
    private readonly io: FileSystemIO,
    private readonly baseDir = "/",
  ) {}

  async load(ref: string): Promise<BenchmarkDataset> {
    const filePath = ref.startsWith("/")
      ? ref
      : `${this.baseDir.replace(/\/+$/, "")}/${ref}`;
    let raw: string;
    try {
      raw = await this.io.readFile(filePath);
    } catch (error) {
      throw new DatasetError(
        `cannot read dataset '${ref}': ${(error as Error).message}`,
      );
    }
    return parseDataset(raw, ref);
  }
}

/** Parse dataset JSON text deterministically. */
export function parseDataset(json: string, sourceName = "dataset"): BenchmarkDataset {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new DatasetError(
      `dataset '${sourceName}' is not valid JSON: ${(error as Error).message}`,
    );
  }
  return normalizeParsed(parsed, sourceName);
}

/** Coerce a JSON object into a normalized dataset. */
export function normalizeParsed(parsed: unknown, sourceName: string): BenchmarkDataset {
  if (typeof parsed !== "object" || parsed === null) {
    throw new DatasetError(`dataset '${sourceName}' must be an object`);
  }
  const record = parsed as Record<string, unknown>;
  const datasetInput = buildDatasetInput(record, sourceName);
  const dataset = createDataset(datasetInput);
  assertValidDataset(dataset);
  return dataset;
}

function buildDatasetInput(
  record: Record<string, unknown>,
  sourceName: string,
): DatasetInput {
  if (typeof record.datasetName !== "string") {
    throw new DatasetError(`dataset '${sourceName}' missing string 'datasetName'`);
  }
  const tasks = Array.isArray(record.tasks) ? record.tasks : [];
  const repositories = Array.isArray(record.repositories) ? record.repositories : [];
  return {
    datasetName: record.datasetName,
    datasetVersion:
      typeof record.datasetVersion === "string"
        ? record.datasetVersion
        : undefined,
    repositories: repositories.map(
      (entry, index) => coerceRepository(entry, sourceName, index),
    ),
    tasks: tasks.map((entry, index) => coerceTask(entry, sourceName, index)),
    metadata: coerceStringRecord(record.metadata),
  };
}

function coerceRepository(
  entry: unknown,
  sourceName: string,
  index: number,
): DatasetRepository {
  if (typeof entry !== "object" || entry === null) {
    throw new DatasetError(`dataset '${sourceName}' repositories[${index}] must be an object`);
  }
  const record = entry as Record<string, unknown>;
  if (typeof record.id !== "string") {
    throw new DatasetError(`dataset '${sourceName}' repositories[${index}].id must be a string`);
  }
  const files: Record<string, string> = {};
  if (typeof record.files === "object" && record.files !== null) {
    const entries = Object.entries(record.files as Record<string, unknown>).sort(
      (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
    );
    for (const [filePath, content] of entries) {
      if (typeof content !== "string") {
        throw new DatasetError(
          `dataset '${sourceName}' repositories[${index}].files['${filePath}'] must be a string`,
        );
      }
      files[filePath] = content;
    }
  }
  return {
    id: record.id,
    description:
      typeof record.description === "string" ? record.description : "",
    isGit: record.isGit === true,
    files,
  };
}

function coerceTask(
  entry: unknown,
  sourceName: string,
  index: number,
): BenchmarkTask {
  if (typeof entry !== "object" || entry === null) {
    throw new DatasetError(`dataset '${sourceName}' tasks[${index}] must be an object`);
  }
  const record = entry as Record<string, unknown>;
  const required = (name: string): string => {
    if (typeof record[name] !== "string" || (record[name] as string).length === 0) {
      throw new DatasetError(
        `dataset '${sourceName}' tasks[${index}].${name} must be a non-empty string`,
      );
    }
    return record[name] as string;
  };
  const stringArray = (name: string, fallback: string[] = []): string[] => {
    const value = record[name];
    if (value === undefined) return fallback;
    if (!Array.isArray(value)) {
      throw new DatasetError(`dataset '${sourceName}' tasks[${index}].${name} must be an array`);
    }
    return value.map((item) => {
      if (typeof item !== "string") {
        throw new DatasetError(`dataset '${sourceName}' tasks[${index}].${name} must be string[]`);
      }
      return item;
    });
  };
  const repository = record.repository;
  if (typeof repository !== "object" || repository === null) {
    throw new DatasetError(`dataset '${sourceName}' tasks[${index}].repository must be an object`);
  }
  if (typeof (repository as Record<string, unknown>).id !== "string") {
    throw new DatasetError(`dataset '${sourceName}' tasks[${index}].repository.id must be a string`);
  }
  const verificationValue = record.verification;
  if (typeof verificationValue !== "object" || verificationValue === null) {
    throw new DatasetError(`dataset '${sourceName}' tasks[${index}].verification must be an object`);
  }
  const expectedBehaviorEntry = record.expectedBehavior;
  const expectedBehaviorSummary =
    typeof expectedBehaviorEntry === "object" &&
    expectedBehaviorEntry !== null &&
    typeof (expectedBehaviorEntry as Record<string, unknown>).summary === "string"
      ? ((expectedBehaviorEntry as Record<string, unknown>).summary as string)
      : typeof record.expectedBehaviorSummary === "string"
        ? (record.expectedBehaviorSummary as string)
        : undefined;
  if (expectedBehaviorSummary === undefined) {
    throw new DatasetError(
      `dataset '${sourceName}' tasks[${index}].expectedBehavior.summary must be a non-empty string`,
    );
  }
  const timeoutMs = record.timeoutMs;
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new DatasetError(`dataset '${sourceName}' tasks[${index}].timeoutMs must be a positive number`);
  }
  return {
    id: required("id"),
    title: required("title"),
    description: required("description"),
    repository: { id: (repository as Record<string, unknown>).id as string },
    baseRevision: required("baseRevision"),
    setup: stringArray("setup"),
    expectedBehavior: {
      summary: expectedBehaviorSummary,
    },
    verification: verificationValue as BenchmarkTask["verification"],
    timeoutMs,
    tags: stringArray("tags"),
    difficulty: (record.difficulty as Task["difficulty"]) ?? "MEDIUM",
    category: (record.category as Task["category"]) ?? "FEATURE",
    version:
      typeof record.version === "number" ? record.version : undefined,
    metadata: coerceStringRecord(record.metadata),
  };
}

function coerceStringRecord(
  value: unknown,
): Readonly<Record<string, string>> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record: Record<string, string> = {};
  const entries = Object.entries(value as Record<string, unknown>).sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  );
  for (const [key, entry] of entries) {
    if (typeof entry === "string") record[key] = entry;
    else record[key] = String(entry);
  }
  return record;
}

type Task = BenchmarkTask;

export { DATASET_SCHEMA_VERSION };