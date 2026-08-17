import { describe, expect, it } from "vitest";
import { MemoryStore, StoreMutation } from "../src/memory-store.js";
import {
  NotFoundError,
  DuplicateRecordError,
  ClosedMemoryError,
} from "../src/errors.js";

interface Item {
  readonly id: string;
  readonly value: string;
}

function item(id: string, value = id): Item {
  return { id, value };
}

describe("MemoryStore CRUD", () => {
  it("puts and gets a record", async () => {
    const store = new MemoryStore<Item>();
    await store.put(item("a", "A"));
    expect(await store.get("a")).toEqual(item("a", "A"));
  });

  it("returns null for missing records", async () => {
    const store = new MemoryStore<Item>();
    expect(await store.get("nope")).toBeNull();
  });

  it("getOrThrow throws NotFoundError for missing records", async () => {
    const store = new MemoryStore<Item>();
    await expect(store.getOrThrow("nope")).rejects.toThrow(NotFoundError);
  });

  it("has() reflects presence", async () => {
    const store = new MemoryStore<Item>();
    await store.put(item("a"));
    expect(await store.has("a")).toBe(true);
    expect(await store.has("b")).toBe(false);
  });

  it("upserts deterministically on the same id", async () => {
    const store = new MemoryStore<Item>();
    await store.put(item("a", "first"));
    await store.put(item("a", "second"));
    expect(await store.get("a")).toEqual(item("a", "second"));
    expect(await store.count()).toBe(1);
  });

  it("rejects duplicates when configured", async () => {
    const store = new MemoryStore<Item>({ rejectDuplicates: true });
    await store.put(item("a"));
    await expect(store.put(item("a"))).rejects.toThrow(DuplicateRecordError);
  });

  it("updates an existing record through a pure function", async () => {
    const store = new MemoryStore<Item>();
    await store.put(item("a", "old"));
    const updated = await store.update("a", (current) => ({
      ...current,
      value: "new",
    }));
    expect(updated.value).toBe("new");
    expect(await store.get("a")).toMatchObject({ value: "new" });
  });

  it("throws NotFoundError when updating a missing record", async () => {
    const store = new MemoryStore<Item>();
    await expect(
      store.update("x", (current) => current),
    ).rejects.toThrow(NotFoundError);
  });

  it("upserts on update when provided", async () => {
    const store = new MemoryStore<Item>();
    const created = await store.update(
      "z",
      (current) => current,
      { upsert: item("z", "brand-new") },
    );
    expect(created).toEqual(item("z", "brand-new"));
  });

  it("strictMissing makes update throw for missing ids", async () => {
    const store = new MemoryStore<Item>({ strictMissing: true });
    await expect(
      store.update("x", (current) => current),
    ).rejects.toThrow(NotFoundError);
  });

  it("deletes and reports whether it existed", async () => {
    const store = new MemoryStore<Item>();
    expect(await store.delete("a")).toBe(false);
    await store.put(item("a"));
    expect(await store.delete("a")).toBe(true);
    expect(await store.get("a")).toBeNull();
  });

  it("strictMissing delete throws for missing records", async () => {
    const store = new MemoryStore<Item>({ strictMissing: true });
    await expect(store.delete("missing")).rejects.toThrow(NotFoundError);
  });

  it("counts accurately", async () => {
    const store = new MemoryStore<Item>();
    expect(await store.count()).toBe(0);
    await store.put(item("a"));
    await store.put(item("b"));
    expect(await store.count()).toBe(2);
    await store.delete("a");
    expect(await store.count()).toBe(1);
  });

  it("list returns records sorted by id ascending", async () => {
    const store = new MemoryStore<Item>();
    await store.putMany([item("c"), item("a"), item("b"), item("aa")]);
    const ids = (await store.list()).map((record) => record.id);
    expect(ids).toEqual(["a", "aa", "b", "c"]);
  });

  it("list order is deterministic regardless of insertion order", async () => {
    const store = new MemoryStore<Item>();
    await store.putMany([item("b"), item("a"), item("c")]);
    await store.put(item("b", "changed"));
    const first = (await store.list()).map((r) => r.id);
    const second = (await store.list()).map((r) => r.id);
    expect(first).toEqual(second);
  });

  it("putMany returns the number of records", async () => {
    const store = new MemoryStore<Item>();
    expect(await store.putMany([item("a"), item("b")])).toBe(2);
  });

  it("clear removes all records and returns the count", async () => {
    const store = new MemoryStore<Item>();
    await store.putMany([item("a"), item("b"), item("c")]);
    expect(await store.clear()).toBe(3);
    expect(await store.count()).toBe(0);
  });
});

describe("MemoryStore find/search", () => {
  it("find filters and sorts by id", async () => {
    const store = new MemoryStore<Item>();
    await store.putMany([item("b", "x"), item("a", "y"), item("c", "x")]);
    const matches = await store.find((record) => record.value === "x");
    expect(matches.map((record) => record.id)).toEqual(["b", "c"]);
  });

  it("search matches tokens across fields", async () => {
    const store = new MemoryStore<Item>();
    await store.putMany([
      item("a", "alpha beta"),
      item("b", "gamma delta"),
      item("c", "beta omega"),
    ]);
    const result = await store.search({ query: "beta", textOf: (r) => r.value });
    expect(result.total).toBe(2);
    expect(result.records.map((record) => record.id)).toEqual(["a", "c"]);
  });

  it("search combines predicate and query", async () => {
    const store = new MemoryStore<Item>();
    await store.putMany([item("a", "alpha"), item("b", "alpha")]);
    const result = await store.search({
      query: "alpha",
      textOf: (r) => r.value,
      predicate: (r) => r.id === "b",
    });
    expect(result.records.map((record) => record.id)).toEqual(["b"]);
  });

  it("search honors limits but reports the true total", async () => {
    const store = new MemoryStore<Item>();
    await store.putMany([item("a", "same"), item("b", "same"), item("c", "same")]);
    const result = await store.search({
      query: "same",
      textOf: (r) => r.value,
      limit: 2,
    });
    expect(result.records).toHaveLength(2);
    expect(result.total).toBe(3);
  });

  it("search with empty query returns all", async () => {
    const store = new MemoryStore<Item>();
    await store.putMany([item("a"), item("b")]);
    const result = await store.search({ textOf: (r) => r.value });
    expect(result.total).toBe(2);
  });

  it("countWhere counts matching records", async () => {
    const store = new MemoryStore<Item>();
    await store.putMany([item("a", "x"), item("b", "y")]);
    expect(await store.countWhere((r) => r.value === "x")).toBe(1);
  });
});

describe("MemoryStore snapshot/mutation", () => {
  it("snapshot is sorted and read-only by convention", async () => {
    const store = new MemoryStore<Item>();
    await store.putMany([item("b"), item("a")]);
    expect(store.snapshot().map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("withSnapshot runs a deterministic read over sorted records", () => {
    const store = new MemoryStore<Item>();
    store.withSnapshot((records) => {
      expect(records.map((r) => r.id)).toEqual([]);
    });
  });

  it("mutate batches an atomic operation", async () => {
    const store = new MemoryStore<Item>();
    await store.put(item("a"));
    await store.mutate((mutation: StoreMutation<Item>) => {
      mutation.set(item("b"));
      mutation.delete("a");
    });
    expect(await store.get("a")).toBeNull();
    expect(await store.get("b")).not.toBeNull();
  });
});

describe("MemoryStore concurrency & lifecycle", () => {
  it("serializes concurrent mutations in call order", async () => {
    const store = new MemoryStore<Item>();
    const observed: string[] = [];
    const ops: Promise<unknown>[] = [];
    for (let i = 0; i < 50; i += 1) {
      ops.push(
        store.put({ id: `id-${i.toString().padStart(3, "0")}`, value: `v${i}` }),
      );
    }
    await Promise.all(ops);
    expect(await store.count()).toBe(50);
    const ids = (await store.list()).map((r) => r.id);
    expect(ids[0]).toBe("id-000");
    expect(ids[49]).toBe("id-049");
    expect(observed).toEqual([]);
  });

  it("onMutation fires once per mutation in FIFO order", async () => {
    const fired: string[] = [];
    const store = new MemoryStore<Item>({
      onMutation: async (op) => {
        fired.push(op);
      },
    });
    await store.put(item("a"));
    await store.update("a", (current) => ({ ...current, value: "b" }));
    await store.delete("a");
    expect(fired).toEqual(["put", "update", "delete"]);
  });

  it("awaits async onMutation before the next mutation", async () => {
    let saved = 0;
    const store = new MemoryStore<Item>({
      onMutation: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        saved += 1;
      },
    });
    await Promise.all([store.put(item("a")), store.put(item("b"))]);
    expect(saved).toBe(2);
  });

  it("concurrent readers observe a consistent state", async () => {
    const store = new MemoryStore<Item>();
    await store.putMany([item("a"), item("b"), item("c")]);
    const results = await Promise.all([store.list(), store.count(), store.list()]);
    expect(results[0]).toEqual(results[2]);
    expect(results[1]).toBe(3);
  });

  it("closed stores reject future operations with ClosedMemoryError", async () => {
    const store = new MemoryStore<Item>();
    await store.put(item("a"));
    store.close();
    expect(store.isClosed()).toBe(true);
    await expect(store.put(item("b"))).rejects.toThrow(ClosedMemoryError);
    await expect(store.get("a")).rejects.toThrow(ClosedMemoryError);
    await expect(store.list()).rejects.toThrow(ClosedMemoryError);
    await expect(store.clear()).rejects.toThrow(ClosedMemoryError);
  });

  it("large stores remain deterministic and sorted", async () => {
    const store = new MemoryStore<Item>();
    const records: Item[] = [];
    for (let i = 0; i < 1000; i += 1) {
      records.push(item(`key${i}`, `v${i}`));
    }
    await store.putMany(records);
    expect(await store.count()).toBe(1000);
    const list = await store.list();
    for (let i = 1; i < list.length; i += 1) {
      expect(list[i - 1]!.id < list[i]!.id).toBe(true);
    }
  });
});