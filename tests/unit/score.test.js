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

  it("accepts capitalization fixes and suppresses insertion-only punctuation without cascading", async () => {
    const result = await scoreResponse(
      {
        corrected: "He went to school yesterday.",
        changes: [
          { original: "he", replacement: "He", explanation: "Capitalize first word of sentence." },
          { original: "go", replacement: "went", explanation: "Use past tense for yesterday." },
          { original: "scool", replacement: "school", explanation: "Correct spelling." },
          { original: "yestday", replacement: "yesterday", explanation: "Correct spelling." },
          { original: "", replacement: ".", explanation: "Add period at end of sentence." },
        ],
      },
      "he go to scool yestday",
      1,
    );

    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.usable).toHaveLength(4);
    expect(result.suppressed).toHaveLength(1);
    expect(result.suppressed[0]._issues).toContain("insertion-only change");
  });

  it("accepts mostly grounded corrections when one misspelling edit is not perfectly reconstructable", async () => {
    const result = await scoreResponse(
      {
        corrected: "So I didn't have any time to learn.",
        changes: [
          { original: "so", replacement: "So", explanation: "Capitalize first word of sentence." },
          { original: "i", replacement: "I", explanation: "Pronoun I should be capitalized." },
          { original: "didnt", replacement: "didn't", explanation: "Add apostrophe for contraction." },
          { original: "had", replacement: "have", explanation: "Use base verb after didn't." },
          { original: "tolarend", replacement: "learn", explanation: "Correct misspelled word." },
          { original: "", replacement: ".", explanation: "Add terminal period." },
        ],
      },
      "so i didnt had any time tolarend",
      1,
    );

    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.usable).toHaveLength(5);
    expect(result.usable[1]._issues).not.toContain("original phrase is ambiguous");
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
