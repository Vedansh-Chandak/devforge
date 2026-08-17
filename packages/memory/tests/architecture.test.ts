import { describe, expect, it } from "vitest";
import {
  buildArchitectureRecord,
  ArchitectureMemory,
} from "../src/architecture.js";
import { InvalidRecordError, NotFoundError } from "../src/errors.js";
import { makeClock, makeMemory } from "./helpers.js";

describe("buildArchitectureRecord", () => {
  it("builds a deterministic record from typed inputs", () => {
    const clock = makeClock();
    const ctx = {
      repositoryId: "repo-x",
      now: clock.clock,
      id: (input: { seed: string }) => `id-${input.seed}`,
    };
    const r1 = buildArchitectureRecord(ctx, {
      title: "Brain owns reasoning",
      owner: "packages/brain",
      responsibility: "reasoning orchestration",
      constraints: ["no file mutation"],
    });
    const r2 = buildArchitectureRecord(ctx, {
      title: "Brain owns reasoning",
      owner: "packages/brain",
      responsibility: "reasoning orchestration",
      constraints: ["no file mutation"],
    });
    expect(r1.id).toBe(r2.id);
    expect(r1.type).toBe("architecture");
    expect(r1.repositoryId).toBe("repo-x");
    expect(r1.data.owner).toBe("packages/brain");
  });

  it("defaults confidence and importance deterministically", () => {
    const clock = makeClock();
    const ctx = {
      repositoryId: "r",
      now: clock.clock,
      id: (input: { seed: string }) => `id-${input.seed}`,
    };
    const record = buildArchitectureRecord(ctx, {
      title: "t",
      owner: "o",
      responsibility: "resp",
    });
    expect(record.confidence).toBe(0.5);
    expect(record.importance).toBe(0.5);
  });

  it("stores constraints in a stable order", () => {
    const clock = makeClock();
    const ctx = {
      repositoryId: "r",
      now: clock.clock,
      id: (input: { seed: string }) => `id-${input.seed}`,
    };
    const record = buildArchitectureRecord(ctx, {
      title: "t",
      owner: "o",
      responsibility: "resp",
      constraints: ["b", "a"],
    });
    expect(record.data.constraints).toEqual(["b", "a"]);
  });

  it("rejects missing titles, owners, and responsibilities", () => {
    const ctx = {
      repositoryId: "r",
      now: makeClock().clock,
      id: (input: { seed: string }) => `id-${input.seed}`,
    };
    expect(() =>
      buildArchitectureRecord(ctx, { title: "", owner: "o", responsibility: "r" }),
    ).toThrow(InvalidRecordError);
    expect(() =>
      buildArchitectureRecord(ctx, { title: "t", owner: "", responsibility: "r" }),
    ).toThrow(InvalidRecordError);
    expect(() =>
      buildArchitectureRecord(ctx, { title: "t", owner: "o", responsibility: "" }),
    ).toThrow(InvalidRecordError);
  });
});

describe("ArchitectureMemory facade", () => {
  it("adds, gets, and lists architecture facts", async () => {
    const { memory } = makeMemory();
    await memory.load();
    const added = await memory.architecture.add({
      title: "GitService is the only Git mutation interface",
      owner: "GitService",
      responsibility: "all Git mutations",
    });
    expect(await memory.architecture.get(added.id)).toMatchObject({ type: "architecture" });
    expect(await memory.architecture.count()).toBe(1);
    expect((await memory.architecture.list())[0]?.id).toBe(added.id);
  });

  it("updates an architecture fact in place", async () => {
    const { memory } = makeMemory();
    await memory.load();
    const added = await memory.architecture.add({
      title: "Executor process boundary",
      owner: "Executor",
      responsibility: "runs long tasks",
    });
    const updated = await memory.architecture.update(added.id, {
      responsibility: "never spawns processes",
    });
    expect(updated.data.responsibility).toBe("never spawns processes");
    expect(updated.id).toBe(added.id);
    expect(updated.createdAt).toBe(added.createdAt);
  });

  it("deletes reachable records and reports false otherwise", async () => {
    const { memory } = makeMemory();
    await memory.load();
    const added = await memory.architecture.add({
      title: "t",
      owner: "o",
      responsibility: "r",
    });
    expect(await memory.architecture.delete(added.id)).toBe(true);
    expect(await memory.architecture.delete(added.id)).toBe(false);
    expect(await memory.architecture.count()).toBe(0);
  });

  it("updating a missing record throws NotFoundError", async () => {
    const { memory } = makeMemory();
    await memory.load();
    await expect(
      memory.architecture.update("ghost", { responsibility: "x" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("retrieves only architecture records", async () => {
    const { memory } = makeMemory();
    await memory.load();
    await memory.architecture.add({
      title: "Planner plans work",
      owner: "planner",
      responsibility: "task planning",
    });
    await memory.conventions.add({
      title: "use pnpm",
      category: "dependencies",
      convention: "pnpm",
    });
    const result = await memory.architecture.retrieve("planner planning");
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.records.every((r) => r.record.type === "architecture")).toBe(true);
  });

  it("would not summon foreign repositories (scope enforced at facade boundary)", async () => {
    const other = makeMemory();
    const { memory } = makeMemory();
    await memory.load();
    await other.memory.load();
    await other.memory.architecture.add({
      title: "foreign fact",
      owner: "foreign",
      responsibility: "x",
    });
    expect(await memory.architecture.count()).toBe(0);
    expect(await other.memory.architecture.count()).toBe(1);
  });

  it("clears only architecture memories", async () => {
    const { memory } = makeMemory();
    await memory.load();
    await memory.architecture.add({ title: "t", owner: "o", responsibility: "r" });
    await memory.sessions.add({
      title: "session",
      sessionId: "s1",
      userRequest: "req",
      result: "done",
    });
    expect(await memory.architecture.clear()).toBe(1);
    expect(await memory.architecture.count()).toBe(0);
    expect(await memory.sessions.count()).toBe(1);
  });
});