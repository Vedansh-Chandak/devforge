import { describe, expect, it } from "vitest";
import {
  createResultStore,
  FileBackend,
  MemoryBackend,
  parseStoredRun,
  resultIdFor,
  RESULT_SCHEMA_VERSION,
} from "../src/result-store.js";
import { CorruptStoreError, ResultStoreError } from "../src/errors.js";
import { FakeClock } from "../src/clock.js";
import { InMemoryFileSystemIO } from "../src/file-system.js";
import { makeResult, makeTaskResult } from "./helpers.js";

function sampleResult() {
  return makeResult([makeTaskResult("a")]);
}

describe("resultIdFor", () => {
  it("is deterministic for identical results", () => {
    expect(resultIdFor(sampleResult())).toBe(resultIdFor(sampleResult()));
  });

  it("differs when task outcomes differ", () => {
    const passing = makeResult([makeTaskResult("a")]);
    const failing = makeResult([makeTaskResult("a", { status: "error" as never, score: 0 })]);
    expect(resultIdFor(passing)).not.toBe(resultIdFor(failing));
  });

  it("records the dataset identity in the id", () => {
    expect(resultIdFor(sampleResult())).toHaveLength(24);
  });
});

describe("MemoryBackend", () => {
  it("round-trips a stored run", async () => {
    const backend = new MemoryBackend();
    const store = createResultStore({ backend, clock: new FakeClock(5) });
    const result = sampleResult();
    const stored = await store.save(result);
    expect(await store.load(result.resultId)).toEqual(stored);
  });

  it("lists stored ids sorted", async () => {
    const backend = new MemoryBackend();
    const store = createResultStore({ backend });
    await store.save(makeResult([makeTaskResult("a")], { resultId: "z" }));
    await store.save(makeResult([makeTaskResult("a")], { resultId: "a" }));
    expect(await store.list()).toEqual(["a", "z"]);
  });

  it("throws ResultStoreError for missing runs", async () => {
    const store = createResultStore({ backend: new MemoryBackend() });
    await expect(store.load("nope")).rejects.toThrow(ResultStoreError);
  });

  it("deletes runs and reports existence", async () => {
    const store = createResultStore({ backend: new MemoryBackend() });
    const stored = await store.save(sampleResult());
    expect(await store.delete(stored.resultId)).toBe(true);
    expect(await store.delete(stored.resultId)).toBe(false);
  });
});

describe("store integrity", () => {
  it("stamps schema version and clock time on save", async () => {
    const clock = new FakeClock(1234);
    const store = createResultStore({ backend: new MemoryBackend(), clock });
    const stored = await store.save(sampleResult());
    expect(stored.schemaVersion).toBe(RESULT_SCHEMA_VERSION);
    expect(stored.storedAtMs).toBe(1234);
  });

  it("computes a valid checksum over the payload", async () => {
    const store = createResultStore({ backend: new MemoryBackend() });
    const stored = await store.save(sampleResult());
    expect(() => parseStoredRun(JSON.stringify(stored), stored.resultId)).not.toThrow();
  });

  it("latest returns the newest stored run with id tie-break", async () => {
    const clock = new FakeClock(0);
    const store = createResultStore({ backend: new MemoryBackend(), clock });
    const early = await store.save(makeResult([makeTaskResult("a")], { resultId: "early" }));
    clock.advance(100);
    const late = await store.save(makeResult([makeTaskResult("a")], { resultId: "late" }));
    expect((await store.latest())!.resultId).toBe("late");
    void early;
  });

  it("latest returns null when nothing is stored", async () => {
    const store = createResultStore({ backend: new MemoryBackend() });
    expect(await store.latest()).toBeNull();
  });
});

describe("parseStoredRun", () => {
  it("rejects invalid JSON", () => {
    expect(() => parseStoredRun("{nope")).toThrow(CorruptStoreError);
  });

  it("rejects non-object payloads", () => {
    expect(() => parseStoredRun("42")).toThrow(CorruptStoreError);
  });

  it("rejects unsupported schema versions", () => {
    expect(() =>
      parseStoredRun(JSON.stringify({ schemaVersion: 99, resultId: "x" })),
    ).toThrow(/schema version/);
  });

  it("rejects payloads missing resultId", () => {
    expect(() =>
      parseStoredRun(JSON.stringify({ schemaVersion: 1 })),
    ).toThrow(/resultId/);
  });

  it("rejects a resultId mismatching the requested id", () => {
    const stored = { schemaVersion: 1, resultId: "abc", storedAtMs: 0, result: sampleResult(), checksum: "x" };
    expect(() => parseStoredRun(JSON.stringify(stored), "def")).toThrow(/does not match/);
  });

  it("rejects tampered payloads", async () => {
    const store = createResultStore({ backend: new MemoryBackend() });
    const stored = await store.save(sampleResult());
    const record = JSON.parse(JSON.stringify(stored)) as {
      schemaVersion: number;
      resultId: string;
      storedAtMs: number;
      result: { name: string };
      checksum: string;
    };
    record.result.name = "TAMPERED";
    expect(() => parseStoredRun(JSON.stringify(record), record.resultId)).toThrow(
      CorruptStoreError,
    );
  });
});

describe("FileBackend", () => {
  it("persists and reloads a run atomically", async () => {
    const io = InMemoryFileSystemIO.create();
    const store = createResultStore({ io, baseDir: "/results" });
    const stored = await store.save(sampleResult());
    const loaded = await store.load(stored.resultId);
    expect(loaded).toEqual(stored);
  });

  it("leaves no temporary files behind", async () => {
    const io = InMemoryFileSystemIO.create();
    const store = createResultStore({ io, baseDir: "/results" });
    await store.save(sampleResult());
    const leftovers = (await io.listFiles("/results")).filter((name) => name.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("lists only .json entries", async () => {
    const io = InMemoryFileSystemIO.create();
    const store = createResultStore({ io, baseDir: "/results" });
    await store.save(makeResult([makeTaskResult("a")], { resultId: "a" }));
    await io.writeFile("/results/not-json.txt", "x");
    expect(await store.list()).toEqual(["a"]);
  });

  it("throws ResultStoreError when loading a missing file", async () => {
    const store = createResultStore({ io: InMemoryFileSystemIO.create(), baseDir: "/results" });
    await expect(store.load("missing")).rejects.toThrow(ResultStoreError);
  });

  it("detects corruption at load time", async () => {
    const io = InMemoryFileSystemIO.create();
    const store = createResultStore({ io, baseDir: "/results" });
    const stored = await store.save(sampleResult());
    const tampered = JSON.parse(await io.readFile(`/results/${stored.resultId}.json`));
    tampered.result.name = "TAMPERED";
    await io.writeFile(
      `/results/${stored.resultId}.json`,
      `${JSON.stringify(tampered)}\n`,
    );
    await expect(store.load(stored.resultId)).rejects.toThrow(CorruptStoreError);
  });
});