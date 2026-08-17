import { describe, expect, it } from "vitest";
import {
  createDataset,
  hasTask,
  orderTasks,
  repositoryFor,
  taskById,
  taskIds,
  tasksByCategory,
  taskVersions,
} from "../src/dataset.js";
import { DATASET_SCHEMA_VERSION } from "../src/types.js";
import { makeDataset, makeRepository, makeTask } from "./helpers.js";

describe("createDataset", () => {
  it("applies the current schema version", () => {
    const dataset = createDataset({ datasetName: "x", tasks: [makeTask("t1")] });
    expect(dataset.schemaVersion).toBe(DATASET_SCHEMA_VERSION);
    expect(dataset.schemaVersion).toBe(1);
  });

  it("defaults datasetVersion to 1.0.0", () => {
    const dataset = createDataset({ datasetName: "x", tasks: [] });
    expect(dataset.datasetVersion).toBe("1.0.0");
  });

  it("preserves an explicit datasetVersion", () => {
    const dataset = createDataset({
      datasetName: "x",
      datasetVersion: "2.1.0",
      tasks: [],
    });
    expect(dataset.datasetVersion).toBe("2.1.0");
  });

  it("defaults task versions to 1 when unset", () => {
    const task = { ...makeTask("t1"), version: undefined };
    const dataset = createDataset({ datasetName: "x", tasks: [task] });
    expect(dataset.tasks[0]!.version).toBe(1);
  });

  it("keeps explicit task versions", () => {
    const dataset = createDataset({
      datasetName: "x",
      tasks: [makeTask("t1", { kind: "tests", mustPass: [] }, { version: 3 })],
    });
    expect(dataset.tasks[0]!.version).toBe(3);
  });

  it("defaults repositories to an empty list", () => {
    const dataset = createDataset({ datasetName: "x", tasks: [] });
    expect(dataset.repositories).toEqual([]);
  });

  it("preserves metadata", () => {
    const dataset = createDataset({
      datasetName: "x",
      tasks: [],
      metadata: { source: "internal" },
    });
    expect(dataset.metadata).toEqual({ source: "internal" });
  });
});

describe("taskById and hasTask", () => {
  const dataset = makeDataset("d", [makeTask("a"), makeTask("b")]);

  it("finds a task by id", () => {
    expect(taskById(dataset, "a")?.id).toBe("a");
  });

  it("returns undefined for unknown ids", () => {
    expect(taskById(dataset, "zz")).toBeUndefined();
  });

  it("hasTask mirrors taskById", () => {
    expect(hasTask(dataset, "a")).toBe(true);
    expect(hasTask(dataset, "zz")).toBe(false);
  });
});

describe("repositoryFor", () => {
  it("finds the declared repository for a task", () => {
    const repo = makeRepository("custom");
    const task = makeTask("t", undefined, { repository: { id: "custom" } });
    const dataset = makeDataset("d", [task], [repo]);
    expect(repositoryFor(dataset, dataset.tasks[0]!)?.id).toBe("custom");
  });

  it("returns undefined for undeclared repositories", () => {
    const dataset = makeDataset("d", [makeTask("t")], []);
    expect(repositoryFor(dataset, dataset.tasks[0]!)).toBeUndefined();
  });
});

describe("orderTasks", () => {
  it("keeps dataset ordering by default", () => {
    const dataset = makeDataset("d", [makeTask("b"), makeTask("a"), makeTask("c")]);
    const ordered = orderTasks(dataset);
    expect(ordered.map((task) => task.id)).toEqual(["b", "a", "c"]);
  });

  it("sorts by id when requested", () => {
    const dataset = makeDataset("d", [makeTask("b"), makeTask("a"), makeTask("c")]);
    const ordered = orderTasks(dataset, "id");
    expect(ordered.map((task) => task.id)).toEqual(["a", "b", "c"]);
  });

  it("is stable when enabled explicitly", () => {
    const dataset = makeDataset("d", [makeTask("x"), makeTask("y")]);
    expect(orderTasks(dataset, "dataset").map((task) => task.id)).toEqual(["x", "y"]);
  });
});

describe("taskIds", () => {
  it("returns sorted unique ids", () => {
    const dataset = makeDataset("d", [
      makeTask("b"),
      makeTask("a"),
      { ...makeTask("b"), description: "dup" },
    ]);
    expect(taskIds(dataset)).toEqual(["a", "b"]);
  });
});

describe("taskVersions", () => {
  it("maps task ids to versions", () => {
    const dataset = makeDataset("d", [
      makeTask("a"),
      makeTask("b", { kind: "tests", mustPass: [] }, { version: 2 }),
    ]);
    expect(taskVersions(dataset).get("a")).toBe(1);
    expect(taskVersions(dataset).get("b")).toBe(2);
  });
});

describe("tasksByCategory", () => {
  it("counts tasks per category alphabetically", () => {
    const dataset = makeDataset("d", [
      makeTask("a", { kind: "tests", mustPass: ["s"] }, { category: "BUG_FIX" }),
      makeTask("b", { kind: "tests", mustPass: ["s"] }, { category: "FEATURE" }),
      makeTask("c", { kind: "tests", mustPass: ["s"] }, { category: "BUG_FIX" }),
    ]);
    expect(tasksByCategory(dataset)).toEqual({ BUG_FIX: 2, FEATURE: 1 });
  });
});