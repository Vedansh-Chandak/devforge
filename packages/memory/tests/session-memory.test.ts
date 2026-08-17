import { describe, expect, it } from "vitest";
import { buildSessionRecord, SessionMemory } from "../src/session-memory.js";
import { InvalidRecordError } from "../src/errors.js";
import { makeClock, makeMemory } from "./helpers.js";

function ctx() {
  const clock = makeClock();
  return {
    repositoryId: "repo-s",
    now: clock.clock,
    id: (input: { seed: string }) => `id-${input.seed}`,
  };
}

describe("buildSessionRecord", () => {
  it("builds a session record deterministically", () => {
    const input = {
      title: "Session: memory wiring",
      sessionId: "sess-123",
      userRequest: "wire memory into brain",
      actions: ["explored APIs", "added imports"],
      result: "integration stubbed",
      discoveries: ["MemoryStore is generic"],
    };
    const a = buildSessionRecord(ctx(), input);
    const b = buildSessionRecord(ctx(), input);
    expect(a.id).toBe(b.id);
    expect(a.data.sessionId).toBe("sess-123");
  });

  it("rejects missing session ids and requests", () => {
    expect(() =>
      buildSessionRecord(ctx(), {
        title: "t",
        sessionId: "",
        userRequest: "req",
        result: "done",
      }),
    ).toThrow(InvalidRecordError);
    expect(() =>
      buildSessionRecord(ctx(), {
        title: "t",
        sessionId: "s",
        userRequest: "",
        result: "done",
      }),
    ).toThrow(InvalidRecordError);
  });
});

describe("SessionMemory", () => {
  it("adds, lists, and gets sessions", async () => {
    const { memory } = makeMemory();
    await memory.load();
    const session = await memory.sessions.add({
      title: "S1",
      sessionId: "abc",
      userRequest: "build memory package",
      actions: ["scaffolded", "tested"],
      result: "shipped",
      discoveries: ["deterministic ids"],
    });
    expect(await memory.sessions.count()).toBe(1);
    expect(await memory.sessions.get(session.id)).not.toBeNull();
  });

  it("latest returns the newest session by updatedAt", async () => {
    const { memory, clock } = makeMemory();
    await memory.load();
    await memory.sessions.add({
      title: "old",
      sessionId: "s1",
      userRequest: "first",
      result: "done",
    });
    clock.advance(5000);
    const newer = await memory.sessions.add({
      title: "new",
      sessionId: "s2",
      userRequest: "second",
      result: "done",
    });
    expect((await memory.sessions.latest())?.id).toBe(newer.id);
  });

  it("records important discoveries for future retrieval", async () => {
    const { memory } = makeMemory();
    await memory.load();
    await memory.sessions.add({
      title: "discovery session",
      sessionId: "d1",
      userRequest: "investigate ranking",
      result: "found deterministic comparator",
      actions: [],
      discoveries: ["tie-break on id asc"],
    });
    const result = await memory.retrieve("tie-break comparator", {
      types: ["session"],
    });
    expect(result.total).toBeGreaterThan(0);
  });
});