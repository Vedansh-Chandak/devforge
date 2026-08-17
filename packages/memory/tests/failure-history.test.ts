import { describe, expect, it } from "vitest";
import {
  buildFailureRecord,
  FailureMemory,
  failureFingerprint,
} from "../src/failure.js";
import { InvalidRecordError } from "../src/errors.js";
import { makeClock, makeMemory } from "./helpers.js";

function ctx() {
  const clock = makeClock();
  return {
    repositoryId: "repo-f",
    now: clock.clock,
    id: (input: { seed: string }) => `id-${input.seed}`,
  };
}

describe("failureFingerprint", () => {
  it("produces a deterministic digest of its parts", () => {
    expect(failureFingerprint("build", "tsc", "TS2322")).toBe(
      failureFingerprint("build", "tsc", "TS2322"),
    );
  });

  it("changes when any part changes", () => {
    expect(failureFingerprint("build", "tsc", "TS2322")).not.toBe(
      failureFingerprint("build", "tsc", "TS2323"),
    );
  });

  it("is stable across order of identical inputs", () => {
    expect(failureFingerprint("a", "b")).toBe(failureFingerprint("a", "b"));
  });
});

describe("buildFailureRecord", () => {
  it("builds a typed failure record deterministically", () => {
    const input = {
      title: "TS build broke",
      fingerprint: failureFingerprint("build", "tsc"),
      errorCategory: "build",
      affectedSubsystem: "packages/memory",
      attemptedSolution: "fixed types",
      result: "resolved" as const,
    };
    const a = buildFailureRecord(ctx(), input);
    const b = buildFailureRecord(ctx(), input);
    expect(a.id).toBe(b.id);
    expect(a.data.result).toBe("resolved");
  });

  it("rejects unknown results and empty fingerprints", () => {
    expect(() =>
      buildFailureRecord(ctx(), {
        title: "t",
        fingerprint: "",
        errorCategory: "build",
        affectedSubsystem: "x",
        attemptedSolution: "x",
        result: "unknown",
      }),
    ).toThrow(InvalidRecordError);
    expect(() =>
      buildFailureRecord(ctx(), {
        title: "t",
        fingerprint: "fp",
        errorCategory: "build",
        affectedSubsystem: "x",
        attemptedSolution: "x",
        // @ts-expect-error invalid result
        result: "bogus",
      }),
    ).toThrow(InvalidRecordError);
  });
});

describe("FailureMemory", () => {
  it("records and retrieves failures", async () => {
    const { memory } = makeMemory();
    await memory.load();
    const failure = await memory.failures.add({
      title: "Vitest crashed",
      fingerprint: "vitest-worker-timeout",
      errorCategory: "test",
      affectedSubsystem: "packages/memory/tests",
      attemptedSolution: "raise timeout",
      result: "unresolved",
    });
    expect(await memory.failures.get(failure.id)).not.toBeNull();
  });

  it("finds repeated failures by fingerprint", async () => {
    const { memory, clock } = makeMemory();
    await memory.load();
    const fp = failureFingerprint("build", "tsc", "TS2304");
    const first = await memory.failures.add({
      title: "first sighting",
      fingerprint: fp,
      errorCategory: "type",
      affectedSubsystem: "packages/core",
      attemptedSolution: "import type",
      result: "unresolved",
    });
    clock.advance(1000);
    const second = await memory.failures.add({
      title: "second sighting",
      fingerprint: fp,
      errorCategory: "type",
      affectedSubsystem: "packages/core",
      attemptedSolution: "import type",
      result: "unresolved",
    });
    const found = await memory.failures.findByFingerprint(fp);
    expect(found.length).toBe(2);
    expect(found[0]?.id).toBe(second.id);
    expect(found[1]?.id).toBe(first.id);
  });

  it("marks an unresolved failure resolved", async () => {
    const { memory } = makeMemory();
    await memory.load();
    const failure = await memory.failures.add({
      title: "flaky port",
      fingerprint: "port-busy",
      errorCategory: "runtime",
      affectedSubsystem: "apps/cli",
      attemptedSolution: "none",
      result: "unresolved",
    });
    const resolved = await memory.failures.markResolved(
      failure.id,
      "pick a random free port",
    );
    expect(resolved.data.result).toBe("resolved");
    expect(resolved.data.attemptedSolution).toBe("pick a random free port");
    expect(resolved.id).toBe(failure.id);
  });

  it("groups failures by error category on retrieval", async () => {
    const { memory } = makeMemory();
    await memory.load();
    await memory.failures.add({
      title: "build failure",
      fingerprint: "build-1",
      errorCategory: "build",
      affectedSubsystem: "pkg",
      attemptedSolution: "fix",
      result: "workaround",
    });
    const result = await memory.retrieve("build", { types: ["failure"] });
    expect(result.records.some((r) => r.record.data.errorCategory === "build")).toBe(true);
  });
});