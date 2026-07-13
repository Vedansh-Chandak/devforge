import { describe, it, expect } from "vitest";
import { scanRepository } from "./indexer.js";

describe("repository-indexer", () => {
  it("exports scanRepository function", () => {
    expect(typeof scanRepository).toBe("function");
  });
});