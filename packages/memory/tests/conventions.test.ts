import { describe, expect, it } from "vitest";
import { buildConventionRecord, ConventionMemory } from "../src/conventions.js";
import { InvalidRecordError } from "../src/errors.js";
import { makeClock, makeMemory } from "./helpers.js";

function ctx() {
  const clock = makeClock();
  return {
    repositoryId: "repo-c",
    now: clock.clock,
    id: (input: { seed: string }) => `id-${input.seed}`,
  };
}

describe("buildConventionRecord", () => {
  it("builds a deterministic, categorized convention", () => {
    const r1 = buildConventionRecord(ctx(), {
      title: "TypeScript strict mode",
      category: "testing",
      convention: "strict: true in every tsconfig",
    });
    const r2 = buildConventionRecord(ctx(), {
      title: "TypeScript strict mode",
      category: "testing",
      convention: "strict: true in every tsconfig",
    });
    expect(r1.id).toBe(r2.id);
    expect(r1.type).toBe("convention");
    expect(r1.data.category).toBe("testing");
  });

  it("rejects unknown categories", () => {
    expect(() =>
      buildConventionRecord(ctx(), {
        title: "t",
        // @ts-expect-error invalid category
        category: "bogus",
        convention: "x",
      }),
    ).toThrow(InvalidRecordError);
  });

  it("rejects empty conventions", () => {
    expect(() =>
      buildConventionRecord(ctx(), {
        title: "t",
        category: "formatting",
        convention: "",
      }),
    ).toThrow(InvalidRecordError);
  });

  it("supports all documented categories", () => {
    const categories = ["naming", "formatting", "testing", "dependencies", "patterns", "other"] as const;
    for (const category of categories) {
      const record = buildConventionRecord(ctx(), {
        title: `convention ${category}`,
        category,
        convention: "x",
      });
      expect(record.data.category).toBe(category);
    }
  });

  it("does not invent conventions: same seed, stable only when supplied", () => {
    const a = buildConventionRecord(ctx(), { title: "t", category: "other", convention: "x" });
    const b = buildConventionRecord(ctx(), { title: "t", category: "other", convention: "y" });
    expect(a.id).not.toBe(b.id);
  });
});

describe("ConventionMemory facade", () => {
  it("adds, updates, and lists conventions", async () => {
    const { memory } = makeMemory();
    await memory.load();
    const added = await memory.conventions.add({
      title: "use pnpm",
      category: "dependencies",
      convention: "pnpm over npm/yarn",
    });
    await memory.conventions.add({
      title: "single quotes",
      category: "formatting",
      convention: "use single quotes in TS",
    });
    expect(await memory.conventions.count()).toBe(2);
    const updated = await memory.conventions.update(added.id, {
      convention: "pnpm only",
    });
    expect(updated.data.convention).toBe("pnpm only");
  });

  it("retrieves conventions by matching text", async () => {
    const { memory } = makeMemory();
    await memory.load();
    await memory.conventions.add({
      title: "quotes preference",
      category: "formatting",
      convention: "prefer single quotes",
    });
    const result = await memory.conventions.retrieve("single quotes formatting");
    expect(result.records.length).toBeGreaterThan(0);
    expect(result.records[0]?.record.data.category).toBe("formatting");
  });

  it("deduplicates identical conventions deterministically", async () => {
    const { memory } = makeMemory();
    await memory.load();
    const first = await memory.conventions.add({
      title: "use vitest",
      category: "testing",
      convention: "vitest",
    });
    const second = await memory.conventions.add({
      title: "use vitest",
      category: "testing",
      convention: "vitest",
    });
    expect(first.id).toBe(second.id);
    expect(await memory.conventions.count()).toBe(1);
  });
});