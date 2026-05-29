import { describe, expect, it } from "vitest";
import { mergeConfidence, scoreResponse } from "../../lib/score.js";

describe("scoreResponse", () => {
  it("empty response with unchanged text scores high", async () => {
    const result = await scoreResponse({ corrected: "Hello world", changes: [] }, "Hello world", 1);
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.tier).toBe("high");
    expect(result.usable).toEqual([]);
  });

  it("corrected text changed with empty changes scores low before level 3", async () => {
    const result = await scoreResponse({ corrected: "Hello there world", changes: [] }, "Hello world", 1);
    expect(result.score).toBeLessThan(35);
    expect(result.tier).toBe("low");
  });

  it("corrected text changed with empty changes scores better at level 3", async () => {
    const result = await scoreResponse({ corrected: "Hello there world", changes: [] }, "Hello world", 3);
    expect(result.score).toBeGreaterThanOrEqual(25);
    expect(result.tier).toBe("low");
  });

  it("phrase not found in source is suppressed", async () => {
    const result = await scoreResponse(
      {
        corrected: "Hello world",
        changes: [{ original: "nonexistent", replacement: "ghost", explanation: "fix typo" }],
      },
      "Hello world",
      1,
    );
    expect(result.suppressed).toHaveLength(1);
    expect(result.suppressed[0]._issues).toContain("phrase not found in source");
  });

  it("duplicate changes penalize score", async () => {
    const result = await scoreResponse(
      {
        corrected: "Hello world and universe",
        changes: [
          { original: "world", replacement: "earth", explanation: "fix terminology" },
          { original: "world", replacement: "earth", explanation: "fix terminology again" },
        ],
      },
      "Hello world and universe",
      1,
    );
    const dupCheck = result.checks.find((c) => c.name === "duplicate changes");
    expect(dupCheck).toBeDefined();
    expect(dupCheck.pass).toBe(false);
  });

  it("overlapping changes penalize score", async () => {
    const result = await scoreResponse(
      {
        corrected: "Hello big wide world",
        changes: [
          { original: "big wide", replacement: "huge", explanation: "shorter" },
          { original: "big wide world", replacement: "massive globe", explanation: "rewrite" },
        ],
      },
      "Hello big wide world",
      1,
    );
    const overlapCheck = result.checks.find((c) => c.name === "overlapping changes");
    expect(overlapCheck).toBeDefined();
    expect(overlapCheck.pass).toBe(false);
  });

  it("usable changes reconstruct corrected text", async () => {
    const result = await scoreResponse(
      {
        corrected: "Hello earth",
        changes: [{ original: "world", replacement: "earth", explanation: "fix terminology" }],
      },
      "Hello world",
      1,
    );
    expect(result.usable).toHaveLength(1);
    expect(result.score).toBeGreaterThanOrEqual(60);
  });
});

describe("mergeConfidence", () => {
  it("gives more weight to internal score than model confidence", async () => {
    const result = await mergeConfidence(1, 80);
    const resultLow = await mergeConfidence(10, 20);

    expect(result).toBeGreaterThan(50);
    expect(resultLow).toBeLessThan(30);
  });
});
