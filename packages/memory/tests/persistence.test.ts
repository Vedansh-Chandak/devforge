import { describe, expect, it } from "vitest";
import {
  MemoryPersistence,
  serializeRecords,
  deserializeRecords,
  redactMemoryRecord,
  PERSISTENCE_VERSION,
  RECORDS_FILE,
} from "../src/persistence.js";
import { StorageCorruptError } from "../src/errors.js";
import { buildMemoryRecord, defaultIdFactory } from "../src/record-builder.js";
import { makeClock, FakeFileSystem } from "./helpers.js";
import type { MemoryRecord } from "../src/types.js";

function rec(
  repositoryId: string,
  title: string,
  overrides: Partial<MemoryRecord> = {},
): MemoryRecord {
  const clock = makeClock();
  return buildMemoryRecord(
    {
      repositoryId,
      now: clock.clock,
      id: defaultIdFactory(),
    },
    "architecture",
    title,
    { owner: "o", responsibility: title, constraints: [] },
    { id: overrides.id, createdAt: overrides.createdAt, tags: overrides.tags, confidence: overrides.confidence },
  );
}

function buildPersistence(
  fs: FakeFileSystem,
  repositoryId: string,
  baseDir = "/memory-root",
  config: Partial<ConstructorParameters<typeof MemoryPersistence>[0]> = {},
) {
  return new MemoryPersistence({
    baseDir,
    repositoryId,
    now: makeClock().clock,
    fs,
    ...config,
  });
}

describe("serializeRecords", () => {
  it("is deterministic for identical record sets", () => {
    const a = serializeRecords("r", [rec("r", "b"), rec("r", "a")]);
    const b = serializeRecords("r", [rec("r", "a"), rec("r", "b")]);
    expect(a).toBe(b);
  });

  it("sorts records by id in the payload", () => {
    const serialized = serializeRecords("r", [rec("r", "zeta", { id: "z" }), rec("r", "alpha", { id: "a" })]);
    const parsed = JSON.parse(serialized);
    expect(parsed.records.map((r: { id: string }) => r.id)).toEqual(["a", "z"]);
  });

  it("embeds a checksum of the payload", () => {
    const file = JSON.parse(serializeRecords("r", [rec("r", "t")])) as { checksum: string };
    expect(file.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("redacts secrets from persisted text", () => {
    const secretRecord = buildMemoryRecord(
      { repositoryId: "r", now: makeClock().clock, id: defaultIdFactory() },
      "session",
      "API_KEY=abcdefghij1234567890 provisioning",
      { sessionId: "s", userRequest: "API_KEY=abcdefghij1234567890", actions: [], result: "done", discoveries: [] },
      { id: "s1" },
    );
    const serialized = serializeRecords("r", [secretRecord]);
    expect(serialized).not.toContain("abcdefghij1234567890");
    expect(serialized).toContain("[REDACTED]");
  });
});

describe("redactMemoryRecord", () => {
  it("redacts string fields and preserves structure", () => {
    const record = rec("r", "safe");
    const redacted = redactMemoryRecord(record, (t) => t.replace(/api_key=\S+/g, "api_key=[REDACTED]"));
    expect(redacted.id).toBe(record.id);
    expect(redacted.title).toBe("safe");
  });

  it("redacts nested arrays and objects", () => {
    const record = buildMemoryRecord(
      { repositoryId: "r", now: makeClock().clock, id: defaultIdFactory() },
      "task",
      "deploy",
      { task: "deploy with token=za1za2za3za4za5", outcome: "success" as const, affectedFiles: ["secret=4f3jf3k3j3k3j3k3"], tests: [], failures: [], repairs: [] },
      { id: "t1" },
    );
    const redacted = redactMemoryRecord(record);
    expect(redacted.data.affectedFiles[0]).not.toContain("4f3jf3k3j3k3j3k3");
  });
});

describe("deserializeRecords", () => {
  it("round-trips serialized content", () => {
    const content = serializeRecords("r", [rec("r", "t")]);
    const parsed = deserializeRecords(content);
    expect(parsed.version).toBe(PERSISTENCE_VERSION);
    expect(parsed.repositoryId).toBe("r");
    expect(parsed.records).toHaveLength(1);
  });

  it("rejects invalid JSON", () => {
    expect(() => deserializeRecords("not json{")).toThrow(StorageCorruptError);
  });

  it("rejects envelopes without a records array", () => {
    expect(() => deserializeRecords('{"version":1}')).toThrow(StorageCorruptError);
  });

  it("rejects checksum mismatches (tampering)", () => {
    const content = serializeRecords("r", [rec("r", "original")]);
    const tampered = content.replace("original", "tampered!");
    expect(() => deserializeRecords(tampered)).toThrow(StorageCorruptError);
  });
});

describe("MemoryPersistence.load/save", () => {
  it("loads an empty state when nothing has been saved", async () => {
    const fs = new FakeFileSystem();
    const persistence = buildPersistence(fs, "repo");
    const state = await persistence.load();
    expect(state.records).toEqual([]);
    expect(state.recovered).toBe(false);
  });

  it("round-trips records through save/load", async () => {
    const fs = new FakeFileSystem();
    const persistence = buildPersistence(fs, "repo");
    const saved = await persistence.save([rec("repo", "alpha", { id: "a" }), rec("repo", "beta", { id: "b" })]);
    expect(saved.bytes).toBeGreaterThan(0);
    const state = await persistence.load();
    expect(state.records.map((r) => r.id)).toEqual(["a", "b"]);
    expect(state.recovered).toBe(false);
  });

  it("writes atomically via temp file + rename", async () => {
    const fs = new FakeFileSystem();
    const persistence = buildPersistence(fs, "repo");
    await persistence.save([rec("repo", "t")]);
    expect(fs.renames.length).toBe(1);
    expect(fs.renames[0]![0]).toContain(".tmp");
    expect(fs.renames[0]![1]).toContain(RECORDS_FILE);
    expect(fs.files.has(`${persistence.filePath}.tmp`)).toBe(false);
  });

  it("cleans up the temp file when the atomic rename fails", async () => {
    const fs = new FakeFileSystem();
    fs.renameFailures = 1;
    const persistence = buildPersistence(fs, "repo");
    await expect(persistence.save([rec("repo", "t")])).rejects.toThrow();
    expect(fs.files.has(`${persistence.filePath}.tmp`)).toBe(false);
  });

  it("surfaces injected write failures", async () => {
    const fs = new FakeFileSystem();
    const persistence = buildPersistence(fs, "repo");
    fs.writeFailures = 1;
    await expect(persistence.save([rec("repo", "t")])).rejects.toThrow(
      "injected write failure",
    );
  });

  it("isolates storage between repositories on the same filesystem", async () => {
    const fs = new FakeFileSystem();
    await buildPersistence(fs, "repo-a").save([rec("repo-a", "only-a")]);
    const bState = await buildPersistence(fs, "repo-b").load();
    expect(bState.records).toEqual([]);
    const aState = await buildPersistence(fs, "repo-a").load();
    expect(aState.records).toHaveLength(1);
  });

  it("detects corruption and safely recovers with a fresh state", async () => {
    const fs = new FakeFileSystem();
    const persistence = buildPersistence(fs, "repo");
    await persistence.save([rec("repo", "t")]);
    const path = persistence.filePath;
    fs.files.set(path, "{ this is not valid json");
    const state = await persistence.load();
    expect(state.recovered).toBe(true);
    expect(state.recoveryReason).toContain("JSON");
    expect(state.records).toEqual([]);
    // The corrupt bytes are preserved aside, never destroyed.
    const corruptFiles = Array.from(fs.files.keys()).filter((p) => p.includes(".corrupt-"));
    expect(corruptFiles.length).toBe(1);
    expect(fs.files.get(corruptFiles[0]!)).toBe("{ this is not valid json");
  });

  it("reports recovered=true when the repository id mismatches", async () => {
    const fs = new FakeFileSystem();
    const persistence = buildPersistence(fs, "repo");
    await persistence.save([rec("repo", "t")]);
    // Overwrite the file with content claiming a different repository.
    const content = serializeRecords("other", [rec("other", "t", { id: "x" })]);
    fs.files.set(persistence.filePath, content);
    const state = await persistence.load();
    expect(state.recovered).toBe(true);
    expect(state.records).toEqual([]);
  });

  it("detects checksum-tampered content as corruption", async () => {
    const fs = new FakeFileSystem();
    const persistence = buildPersistence(fs, "repo");
    await persistence.save([rec("repo", "tampered")]);
    const path = persistence.filePath;
    const content = fs.files.get(path)!.replace("tampered", "changed");
    fs.files.set(path, content);
    const state = await persistence.load();
    expect(state.recovered).toBe(true);
  });

  it("strict mode throws StorageCorruptError instead of recovering", async () => {
    const fs = new FakeFileSystem();
    const persistence = buildPersistence(fs, "repo", "/memory-root", { strict: true });
    await persistence.save([rec("repo", "t")]);
    fs.files.set(persistence.filePath, "garbage");
    await expect(persistence.load()).rejects.toThrow(StorageCorruptError);
  });

  it("persistedBytes reports the on-disk size", async () => {
    const fs = new FakeFileSystem();
    const persistence = buildPersistence(fs, "repo");
    expect(await persistence.persistedBytes()).toBe(0);
    const result = await persistence.save([rec("repo", "alpha")]);
    expect(await persistence.persistedBytes()).toBe(result.bytes);
  });

  it("existsOnDisk reflects file presence", async () => {
    const fs = new FakeFileSystem();
    const persistence = buildPersistence(fs, "repo");
    expect(await persistence.existsOnDisk()).toBe(false);
    await persistence.save([rec("repo", "t")]);
    expect(await persistence.existsOnDisk()).toBe(true);
  });

  it("saves are deterministic: identical state writes identical bytes", async () => {
    const fs = new FakeFileSystem();
    const persistence = buildPersistence(fs, "repo");
    await persistence.save([rec("repo", "same", { id: "s" })]);
    const bytes1 = fs.files.get(persistence.filePath)!;
    await persistence.save([rec("repo", "same", { id: "s" })]);
    const bytes2 = fs.files.get(persistence.filePath)!;
    expect(bytes1).toBe(bytes2);
  });
});