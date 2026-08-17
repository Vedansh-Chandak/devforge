import { describe, expect, it } from "vitest";
import {
  JsonDatasetLoader,
  normalizeParsed,
  parseDataset,
} from "../src/task-loader.js";
import { DatasetError, TaskValidationError } from "../src/errors.js";
import { InMemoryFileSystemIO } from "../src/file-system.js";

const VALID_JSON = JSON.stringify({
  datasetName: "json-ds",
  datasetVersion: "1.2.3",
  repositories: [
    {
      id: "repo-a",
      description: "repo a",
      isGit: false,
      files: { "src/a.ts": "export const a = 1;\n" },
    },
  ],
  tasks: [
    {
      id: "t1",
      title: "Task one",
      description: "Desc one",
      repository: { id: "repo-a" },
      baseRevision: "main",
      expectedBehavior: { summary: "Sum one" },
      verification: { kind: "tests", mustPass: ["a.test.js"] },
      timeoutMs: 5000,
      tags: ["x"],
      difficulty: "EASY",
      category: "BUG_FIX",
      version: 2,
    },
  ],
});

describe("parseDataset", () => {
  it("parses a valid dataset and normalizes defaults", () => {
    const dataset = parseDataset(VALID_JSON, "inline");
    expect(dataset.datasetName).toBe("json-ds");
    expect(dataset.datasetVersion).toBe("1.2.3");
    expect(dataset.schemaVersion).toBe(1);
    expect(dataset.tasks).toHaveLength(1);
    expect(dataset.tasks[0]!.id).toBe("t1");
    expect(dataset.tasks[0]!.version).toBe(2);
    expect(dataset.repositories[0]!.files["src/a.ts"]).toContain("export");
  });

  it("rejects invalid JSON with DatasetError", () => {
    expect(() => parseDataset("{ nope", "bad")).toThrow(DatasetError);
  });

  it("rejects non-object payloads", () => {
    expect(() => parseDataset("42", "bad")).toThrow(DatasetError);
    expect(() => parseDataset("null", "bad")).toThrow(DatasetError);
  });

  it("requires a string datasetName", () => {
    expect(() => parseDataset('{ "datasetName": 12, "tasks": [] }', "bad")).toThrow(
      DatasetError,
    );
  });

  it("defaults difficulty and category when omitted", () => {
    const json = JSON.stringify({
      datasetName: "d",
      tasks: [
        {
          id: "t1",
          title: "T",
          description: "D",
          repository: { id: "r" },
          baseRevision: "main",
          expectedBehavior: { summary: "S" },
          verification: { kind: "build", command: "npm run build" },
          timeoutMs: 1000,
        },
      ],
    });
    const dataset = parseDataset(json, "inline");
    expect(dataset.tasks[0]!.difficulty).toBe("MEDIUM");
    expect(dataset.tasks[0]!.category).toBe("FEATURE");
  });

  it("validates the loaded dataset structurally", () => {
    const json = JSON.stringify({
      datasetName: "d",
      tasks: [
        {
          id: "t1",
          title: "T",
          description: "D",
          repository: { id: "r" },
          baseRevision: "main",
          expectedBehavior: { summary: "S" },
          verification: { kind: "nope" },
          timeoutMs: 1000,
        },
      ],
    });
    expect(() => parseDataset(json, "bad")).toThrow(/invalid/);
  });

  it("relaxes verification coercion to the typed union parseable by graders", () => {
    const json = JSON.stringify({
      datasetName: "d",
      tasks: [
        {
          id: "t1",
          title: "T",
          description: "D",
          repository: { id: "r" },
          baseRevision: "main",
          expectedBehavior: { summary: "S" },
          verification: { kind: "files", expected: ["README.md"] },
          timeoutMs: 1000,
        },
      ],
    });
    const dataset = parseDataset(json, "inline");
    expect(dataset.tasks[0]!.verification.kind).toBe("files");
  });

  it("throws TaskValidationError when tasks are missing", () => {
    expect(() => parseDataset('{ "datasetName": "d" }', "bad")).toThrow(
      TaskValidationError,
    );
  });
});

describe("normalizeParsed", () => {
  it("throws for null and primitives", () => {
    expect(() => normalizeParsed(null, "s")).toThrow(DatasetError);
    expect(() => normalizeParsed("x", "s")).toThrow(DatasetError);
    expect(() => normalizeParsed([], "s")).toThrow(DatasetError);
  });
});

describe("JsonDatasetLoader", () => {
  it("loads a dataset from an absolute ref", async () => {
    const io = InMemoryFileSystemIO.create();
    await io.writeFile("/datasets/x.json", VALID_JSON);
    const loader = new JsonDatasetLoader(io, "/");
    const dataset = await loader.load("/datasets/x.json");
    expect(dataset.datasetName).toBe("json-ds");
  });

  it("resolves relative refs against baseDir", async () => {
    const io = InMemoryFileSystemIO.create();
    await io.writeFile("/benchmarks/ds.json", VALID_JSON);
    const loader = new JsonDatasetLoader(io, "/benchmarks");
    const dataset = await loader.load("ds.json");
    expect(dataset.tasks).toHaveLength(1);
  });

  it("throws DatasetError for missing files", async () => {
    const loader = new JsonDatasetLoader(InMemoryFileSystemIO.create(), "/");
    await expect(loader.load("missing.json")).rejects.toThrow(DatasetError);
  });
});