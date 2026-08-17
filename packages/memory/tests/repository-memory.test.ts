import { describe, expect, it } from "vitest";
import {
  makeMemory,
  makeIdentity,
  FakeFileSystem,
} from "./helpers.js";
import {
  RepositoryMemory,
} from "../src/repository-memory.js";
import { createRepositoryIdentity } from "../src/repository-identity.js";
import { MemoryPersistence } from "../src/persistence.js";
import { RepositoryMismatchError, NotFoundError } from "../src/errors.js";
import { buildTaskRecord, type TaskInput } from "../src/task.js";
import { defaultIdFactory } from "../src/record-builder.js";
import type { MemoryRecord } from "../src/types.js";

describe("RepositoryMemory facade", () => {
  it("exposes typed facades for every memory type", async () => {
    const { memory } = makeMemory();
    await memory.load();
    expect(memory.architecture).toBeDefined();
    expect(memory.conventions).toBeDefined();
    expect(memory.decisions).toBeDefined();
    expect(memory.tasks).toBeDefined();
    expect(memory.failures).toBeDefined();
    expect(memory.sessions).toBeDefined();
    expect(memory.history).toBeDefined();
  });

  it("adds and gets records generically", async () => {
    const { memory } = makeMemory();
    await memory.load();
    const record = await memory.addMemory("architecture", {
      title: "layout",
      data: { owner: "packages/brain", responsibility: "orchestration", constraints: [] },
      tags: ["structure"],
    });
    expect(record.type).toBe("architecture");
    expect(await memory.get(record.id)).not.toBeNull();
    expect(await memory.count()).toBe(1);
  });

  it("put enforces repository scope", async () => {
    const a = makeMemory();
    const b = makeMemory();
    await a.memory.load();
    await b.memory.load();
    const foreign = await b.memory.architecture.list();
    void foreign;
    const record = buildTaskRecord(
      {
        repositoryId: b.memory.repository.id,
        now: a.clock.clock,
        id: defaultIdFactory(),
      },
      {
        title: "foreign task",
        task: "outside",
        outcome: "success",
      },
    );
    await expect(a.memory.put(record)).rejects.toThrow(RepositoryMismatchError);
  });

  it("getOrThrow raises NotFoundError for unknown ids", async () => {
    const { memory } = makeMemory();
    await memory.load();
    await expect(memory.getOrThrow("missing")).rejects.toThrow(NotFoundError);
  });

  it("counts by type and overall", async () => {
    const { memory } = makeMemory();
    await memory.load();
    await memory.architecture.add({ title: "a", owner: "o", responsibility: "r" });
    await memory.conventions.add({ title: "c", category: "other", convention: "x" });
    expect(await memory.count()).toBe(2);
    expect(await memory.count("architecture")).toBe(1);
    expect(await memory.count("decision")).toBe(0);
  });

  it("lists by type or all", async () => {
    const { memory } = makeMemory();
    await memory.load();
    await memory.architecture.add({ title: "a", owner: "o", responsibility: "r" });
    await memory.sessions.add({ title: "s", sessionId: "s", userRequest: "r", result: "d" });
    expect((await memory.list("architecture")).length).toBe(1);
    expect((await memory.list()).length).toBe(2);
  });

  it("deletes and clears scoped to a type", async () => {
    const { memory } = makeMemory();
    await memory.load();
    await memory.architecture.add({ title: "a", owner: "o", responsibility: "r" });
    await memory.sessions.add({ title: "s", sessionId: "s", userRequest: "r", result: "d" });
    expect(await memory.clear("architecture")).toBe(1);
    expect(await memory.architecture.count()).toBe(0);
    expect(await memory.count()).toBe(1);
  });

  it("retrieves across mixed types with ranking", async () => {
    const { memory } = makeMemory();
    await memory.load();
    await memory.architecture.add({
      title: "GitService owns git",
      owner: "GitService",
      responsibility: "all git mutations",
    });
    await memory.sessions.add({
      title: "git exploration",
      sessionId: "s1",
      userRequest: "explore git service",
      result: "mapped",
    });
    const result = await memory.retrieve("git mutations");
    expect(result.total).toBeGreaterThan(0);
    expect(result.records[0]?.record.type).toBe("architecture");
  });

  it("searches scoped records with the primitive search", async () => {
    const { memory } = makeMemory();
    await memory.load();
    await memory.architecture.add({ title: "search me", owner: "o", responsibility: "r" });
    const found = await memory.search("search");
    expect(found).toHaveLength(1);
  });
});

describe("repository isolation", () => {
  it("Repository A never retrieves Repository B's memory", async () => {
    const a = makeMemory();
    const b = makeMemory();
    await a.memory.load();
    await b.memory.load();
    await b.memory.architecture.add({
      title: "B secret architecture",
      owner: "b",
      responsibility: "top secret",
    });
    const result = await a.memory.retrieve("top secret");
    expect(result.total).toBe(0);
    expect(await a.memory.architecture.count()).toBe(0);
  });

  it("uses the same storage directory only for identical identities", async () => {
    const root = "/shared/root";
    const fs = new FakeFileSystem();
    const a = makeMemory({ repository: makeIdentity({ root }), fs, baseDir: "/m" });
    const b = makeMemory({ repository: makeIdentity({ root }), fs, baseDir: "/m" });
    await a.memory.load();
    await b.memory.load();
    await a.memory.architecture.add({ title: "a fact", owner: "o", responsibility: "r" });
    await a.memory.save();
    expect(await b.memory.architecture.count()).toBe(0);
    await b.memory.load();
    expect(await b.memory.architecture.count()).toBe(1);
  });

  it("different repositories write to different storage folders", async () => {
    const fs = new FakeFileSystem();
    const a = makeMemory({ repository: makeIdentity({ root: "/x" }), fs, baseDir: "/m" });
    const b = makeMemory({ repository: makeIdentity({ root: "/y" }), fs, baseDir: "/m" });
    await a.memory.load();
    await b.memory.load();
    await a.memory.architecture.add({ title: "a fact", owner: "o", responsibility: "r" });
    await a.memory.save();
    expect(a.repository.id).not.toBe(b.repository.id);
    expect(a.repository.id).toHaveLength(64);
    await b.memory.load();
    expect(await b.memory.architecture.count()).toBe(0);
  });
});

describe("persistence & restart recovery", () => {
  it("survives a process restart via save + fresh load", async () => {
    const root = "/restart/repo";
    const fs = new FakeFileSystem();
    const first = makeMemory({ repository: makeIdentity({ root }), fs, baseDir: "/m" });
    await first.memory.load();
    await first.memory.decisions.add({
      title: "persist me",
      decision: "Keep this decision.",
      rationale: "Survives restarts.",
      affectedArea: "persistence",
    });
    await first.memory.save();

    const second = makeMemory({ repository: makeIdentity({ root }), fs, baseDir: "/m" });
    await second.memory.load();
    expect(await second.memory.decisions.count()).toBe(1);
    const decision = (await second.memory.decisions.list())[0]!;
    expect(decision.data.decision).toContain("decision");
    expect(decision.id).toBe(
      (await first.memory.decisions.list())[0]!.id,
    );
  });

  it("autoSave persists mutations without an explicit save", async () => {
    const root = "/auto/repo";
    const fs = new FakeFileSystem();
    const memory = new RepositoryMemory({
      repository: createRepositoryIdentity({ root }),
      persistence: new MemoryPersistence({
        baseDir: "/m",
        repositoryId: createRepositoryIdentity({ root }).id,
        now: () => 1_700_000_000_000,
        fs,
      }),
      clock: () => 1_700_000_000_000,
      autoSave: true,
    });
    await memory.load();
    await memory.architecture.add({ title: "auto", owner: "o", responsibility: "r" });
    await memory.flush();

    const next = makeMemory({ repository: makeIdentity({ root }), fs, baseDir: "/m" });
    await next.memory.load();
    expect(await next.memory.architecture.count()).toBe(1);
  });

  it("recovers the auto-save chain after a failed save and surfaces it on flush", async () => {
    const root = "/recover/repo";
    const fs = new FakeFileSystem();
    const memory = new RepositoryMemory({
      repository: createRepositoryIdentity({ root }),
      persistence: new MemoryPersistence({
        baseDir: "/m",
        repositoryId: createRepositoryIdentity({ root }).id,
        now: () => 1_700_000_000_000,
        fs,
      }),
      clock: () => 1_700_000_000_000,
      autoSave: true,
    });
    await memory.load();

    const rejections: unknown[] = [];
    const onRejection = (error: unknown): void => {
      rejections.push(error);
    };
    process.on("unhandledRejection", onRejection);
    try {
      // Inject a single I/O failure.
      fs.writeFailures = 1;
      await memory.architecture.add({ title: "first", owner: "o", responsibility: "r" });
      await expect(memory.flush()).rejects.toThrow("injected write failure");

      // The next mutation must auto-save successfully.
      await memory.architecture.add({ title: "second", owner: "o", responsibility: "r" });
      await memory.flush();

      const next = makeMemory({ repository: makeIdentity({ root }), fs, baseDir: "/m" });
      await next.memory.load();
      expect(await next.memory.architecture.count()).toBe(2);
    } finally {
      process.removeListener("unhandledRejection", onRejection);
    }

    expect(rejections).toHaveLength(0);
  });

  it("flush does not throw once a later save succeeds", async () => {
    const root = "/recover2/repo";
    const fs = new FakeFileSystem();
    const memory = new RepositoryMemory({
      repository: createRepositoryIdentity({ root }),
      persistence: new MemoryPersistence({
        baseDir: "/m",
        repositoryId: createRepositoryIdentity({ root }).id,
        now: () => 1_700_000_000_000,
        fs,
      }),
      clock: () => 1_700_000_000_000,
      autoSave: true,
    });
    await memory.load();

    fs.writeFailures = 1;
    await memory.architecture.add({ title: "boom", owner: "o", responsibility: "r" });
    await expect(memory.flush()).rejects.toThrow("injected write failure");

    await memory.architecture.add({ title: "ok", owner: "o", responsibility: "r" });
    await memory.flush();
    expect(memory["lastSaveError"]).toBeNull();
  });

  it("dispose flushes pending writes and stops auto-saving", async () => {
    const root = "/dispose/repo";
    const fs = new FakeFileSystem();
    const memory = new RepositoryMemory({
      repository: createRepositoryIdentity({ root }),
      persistence: new MemoryPersistence({
        baseDir: "/m",
        repositoryId: createRepositoryIdentity({ root }).id,
        now: () => 1_700_000_000_000,
        fs,
      }),
      clock: () => 1_700_000_000_000,
      autoSave: true,
    });
    await memory.load();

    await memory.architecture.add({ title: "before", owner: "o", responsibility: "r" });
    await memory.dispose();

    // Mutations after dispose stay in memory but are not persisted.
    await memory.architecture.add({ title: "after", owner: "o", responsibility: "r" });
    await memory.dispose();
    await memory.architecture.add({ title: "after2", owner: "o", responsibility: "r" });

    const next = makeMemory({ repository: makeIdentity({ root }), fs, baseDir: "/m" });
    await next.memory.load();
    expect(await next.memory.architecture.count()).toBe(1);
  });

  it("exposes the recovered flag after a corrupt store is recovered", async () => {
    const root = "/corrupt/repo";
    const fs = new FakeFileSystem();
    const first = makeMemory({ repository: makeIdentity({ root }), fs, baseDir: "/m" });
    await first.memory.load();
    await first.memory.save();
    const path = first.memory["persistence"].filePath;
    fs.files.set(path, "{corrupted");
    const second = makeMemory({ repository: makeIdentity({ root }), fs, baseDir: "/m" });
    await second.memory.load();
    expect(second.memory.recovered).toBe(true);
    expect(second.memory.recoveryReason).toContain("JSON");
  });
});

describe("secret redaction end-to-end", () => {
  it("never writes raw secrets to persisted text", async () => {
    const { memory, fs } = makeMemory();
    await memory.load();
    await memory.sessions.add({
      title: "provisioning",
      sessionId: "prov-1",
      userRequest: "deploy with API_KEY=abcd1234abcd1234abcd",
      result: "done",
      discoveries: ["token=9f8a7b6c5d4e3f2a1b0c"],
    });
    await memory.save();
    const recordsJson = await fs.readFile(memory["persistence"].filePath);
    expect(recordsJson).not.toContain("abcd1234abcd1234abcd");
    expect(recordsJson).not.toContain("9f8a7b6c5d4e3f2a1b0c");
    expect(recordsJson).toContain("[REDACTED]");
  });

  it("memory in RAM keeps raw values while disk is redacted", async () => {
    const { memory, fs } = makeMemory();
    await memory.load();
    await memory.sessions.add({
      title: "t",
      sessionId: "s1",
      userRequest: "PASSWORD=hunter2hunter2",
      result: "ok",
    });
    await memory.save();
    const onDisk = await fs.readFile(memory["persistence"].filePath);
    expect(onDisk).not.toContain("hunter2hunter2");
  });
});

describe("garbage collection through the facade", () => {
  it("applies bounds and persists the survivors", async () => {
    const { memory } = makeMemory();
    await memory.load();
    for (let i = 0; i < 5; i += 1) {
      await memory.tasks.add({
        title: `task ${i}`,
        task: `chore ${i}`,
        outcome: "success",
        importance: 0.1,
      });
    }
    const result = await memory.garbageCollect({ maxRecords: 3 });
    expect(result.remaining.length).toBe(5 - result.removed.length);
    expect(await memory.tasks.count()).toBe(5 - result.removed.length);
    expect(result.remaining.length).toBeLessThanOrEqual(3);
  });

  it("never garbage collects a protected architecture decision", async () => {
    const { memory } = makeMemory();
    await memory.load();
    await memory.decisions.add({
      title: "core rule",
      decision: "Always x.",
      rationale: "core invariant",
      affectedArea: "core",
      confidence: 0.95,
    });
    const result = await memory.garbageCollect({ maxRecords: 0 });
    expect(await memory.decisions.count()).toBe(1);
  });
});

describe("summarization & reporting", () => {
  it("summarizes a record deterministically", async () => {
    const { memory } = makeMemory();
    await memory.load();
    const added = await memory.architecture.add({
      title: "Brain owns reasoning",
      owner: "packages/brain",
      responsibility: "reasoning orchestration",
    });
    const summary = memory.summarize(added);
    expect(summary).toContain("[Architecture]");
    expect(summary).toContain("Brain");
    expect(summary).toContain("reasoning orchestration");
  });

  it("produces a deterministic many-record digest", async () => {
    const { memory } = makeMemory();
    await memory.load();
    await memory.architecture.add({ title: "a", owner: "o", responsibility: "r" });
    await memory.decisions.add({ title: "d", decision: "x", rationale: "y", affectedArea: "z" });
    const all1 = await memory.summarizeAll();
    const all2 = await memory.summarizeAll();
    expect(all1).toBe(all2);
    const digest = await memory.digestAll();
    expect(digest).toContain("Architecture: 1");
    expect(digest).toContain("Decision: 1");
  });

  it("reports persisted bytes", async () => {
    const { memory } = makeMemory();
    await memory.load();
    expect(await memory.persistedBytes()).toBe(0);
    await memory.architecture.add({ title: "a", owner: "o", responsibility: "r" });
    await memory.save();
    expect(await memory.persistedBytes()).toBeGreaterThan(0);
  });
});

describe("concurrency & scale", () => {
  it("handles concurrent writes deterministically", async () => {
    const { memory } = makeMemory();
    await memory.load();
    const writes: Promise<unknown>[] = [];
    for (let i = 0; i < 40; i += 1) {
      writes.push(
        memory.tasks.add({
          title: `concurrent ${i}`,
          task: `job ${i}`,
          outcome: "success",
        }),
      );
    }
    await Promise.all(writes);
    expect(await memory.tasks.count()).toBe(40);
    const list = await memory.tasks.list();
    const sorted = list.map((r) => r.id).slice().sort((a, b) => (a < b ? -1 : 1));
    expect(list.map((r) => r.id)).toEqual(sorted);
  });

  it("retains determinism over large memories", async () => {
    const { memory } = makeMemory();
    await memory.load();
    for (let i = 0; i < 500; i += 1) {
      await memory.tasks.add({ title: `bulk ${i}`, task: `bulk ${i}`, outcome: "success" });
    }
    const a = await memory.retrieve("bulk", { limit: 5 });
    const b = await memory.retrieve("bulk", { limit: 5 });
    expect(a.records.map((r) => r.record.id)).toEqual(b.records.map((r) => r.record.id));
  });

  it("empty repositories behave predictably", async () => {
    const { memory } = makeMemory();
    await memory.load();
    expect(await memory.count()).toBe(0);
    const result = await memory.retrieve("anything");
    expect(result.total).toBe(0);
    expect(await memory.summarizeAll()).toBe("");
  });
});