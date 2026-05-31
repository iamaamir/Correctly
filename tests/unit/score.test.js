import { describe, expect, it } from "vitest";
import {
  classifyProviderFailure,
  extractDisplayChanges,
  mergeConfidence,
  scoreAcceptedCorrection,
  scoreResponse,
  validateGrammarResponse,
} from "../../lib/score.js";

describe("validateGrammarResponse", () => {
  it("accepts valid Level 1 response with confidence", () => {
    const result = validateGrammarResponse(
      {
        corrected: "Hello world.",
        changes: [{ original: "hello", replacement: "Hello", explanation: "Cap." }],
        confidence: 10,
      },
      { level: 1 },
    );
    expect(result.ok).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.value).toEqual({
      corrected: "Hello world.",
      changes: [{ original: "hello", replacement: "Hello", explanation: "Cap." }],
      confidence: 10,
    });
  });

  it("accepts valid Level 2 response with confidence", () => {
    const result = validateGrammarResponse({ corrected: "Hello world.", changes: [], confidence: 8 }, { level: 2 });
    expect(result.ok).toBe(true);
  });

  it("accepts Level 3 response without confidence", () => {
    const result = validateGrammarResponse({ corrected: "Hello world.", changes: [] }, { level: 3 });
    expect(result.ok).toBe(true);
  });

  it("rejects null response", () => {
    expect(validateGrammarResponse(null, { level: 1 }).ok).toBe(false);
  });

  it("rejects non-object response", () => {
    expect(validateGrammarResponse("string", { level: 1 }).ok).toBe(false);
  });

  it("rejects missing corrected", () => {
    const result = validateGrammarResponse({ changes: [], confidence: 10 }, { level: 1 });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("corrected");
  });

  it("rejects non-string corrected", () => {
    const result = validateGrammarResponse({ corrected: 123, changes: [], confidence: 10 }, { level: 1 });
    expect(result.ok).toBe(false);
  });

  it("rejects missing changes", () => {
    const result = validateGrammarResponse({ corrected: "Hello.", confidence: 10 }, { level: 1 });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("changes");
  });

  it("rejects non-array changes", () => {
    const result = validateGrammarResponse({ corrected: "Hello.", changes: "oops", confidence: 10 }, { level: 1 });
    expect(result.ok).toBe(false);
  });

  it("rejects missing confidence at Level 1", () => {
    const result = validateGrammarResponse({ corrected: "Hello.", changes: [] }, { level: 1 });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("confidence");
  });

  it("rejects missing confidence at Level 2", () => {
    const result = validateGrammarResponse({ corrected: "Hello.", changes: [] }, { level: 2 });
    expect(result.ok).toBe(false);
  });

  it("rejects confidence 0 at Level 1", () => {
    const result = validateGrammarResponse({ corrected: "Hello.", changes: [], confidence: 0 }, { level: 1 });
    expect(result.ok).toBe(false);
  });

  it("rejects confidence 11 at Level 1", () => {
    const result = validateGrammarResponse({ corrected: "Hello.", changes: [], confidence: 11 }, { level: 1 });
    expect(result.ok).toBe(false);
  });

  it("rejects non-numeric confidence at Level 1", () => {
    const result = validateGrammarResponse({ corrected: "Hello.", changes: [], confidence: "high" }, { level: 1 });
    expect(result.ok).toBe(false);
  });
});

describe("extractDisplayChanges", () => {
  it("returns empty arrays for null/undefined parsed", () => {
    const result = extractDisplayChanges(null, "hello");
    expect(result.displayChanges).toEqual([]);
    expect(result.hiddenChanges).toEqual([]);
  });

  it("keeps grounded changes in displayChanges", () => {
    const result = extractDisplayChanges(
      {
        corrected: "Hello world.",
        changes: [
          { original: "hello", replacement: "Hello", explanation: "Capitalize first word." },
          { original: "world", replacement: "Earth", explanation: "Use proper noun." },
        ],
      },
      "hello world",
    );
    expect(result.displayChanges).toHaveLength(2);
    expect(result.hiddenChanges).toHaveLength(0);
  });

  it("hides changes whose original is not found in source", () => {
    const result = extractDisplayChanges(
      {
        corrected: "Hello world.",
        changes: [{ original: "nonexistent", replacement: "something", explanation: "fix typo" }],
      },
      "Hello world",
    );
    expect(result.displayChanges).toHaveLength(0);
    expect(result.hiddenChanges).toHaveLength(1);
    expect(result.hiddenChanges[0].reason).toContain("original not found in source text");
  });

  it("hides insertion-only punctuation changes as benign", () => {
    const result = extractDisplayChanges(
      {
        corrected: "Hello world.",
        changes: [
          { original: "hello", replacement: "Hello", explanation: "Capitalize." },
          { original: "", replacement: ".", explanation: "Add period." },
        ],
      },
      "hello world",
    );
    expect(result.displayChanges).toHaveLength(1);
    expect(result.hiddenChanges).toHaveLength(1);
    expect(result.hiddenChanges[0].reason).toContain("insertion-only punctuation");
  });

  it("hides equal original/replacement changes", () => {
    const result = extractDisplayChanges(
      {
        corrected: "Hello world.",
        changes: [
          { original: "hello", replacement: "Hello", explanation: "Capitalize." },
          { original: "world", replacement: "world", explanation: "no change" },
        ],
      },
      "hello world",
    );
    expect(result.displayChanges).toHaveLength(1);
    expect(result.hiddenChanges).toHaveLength(1);
    expect(result.hiddenChanges[0].reason).toContain("original equals replacement");
  });
});

describe("scoreAcceptedCorrection", () => {
  it("returns accepted=true for valid grounded corrections", () => {
    const result = scoreAcceptedCorrection(
      {
        corrected: "Hello world.",
        changes: [{ original: "hello", replacement: "Hello", explanation: "Capitalize first word." }],
      },
      "hello world",
      1,
    );
    expect(result.accepted).toBe(true);
    expect(result.acceptanceScore).toBeGreaterThanOrEqual(60);
  });

  it("returns accepted=false for empty changes with different corrected at Level 1", () => {
    const result = scoreAcceptedCorrection({ corrected: "Hello there world", changes: [] }, "Hello world", 1);
    expect(result.accepted).toBe(false);
    expect(result.acceptanceScore).toBeLessThan(60);
  });

  it("accepts empty changes with same corrected at Level 3", () => {
    const result = scoreAcceptedCorrection({ corrected: "Hello world", changes: [] }, "Hello world", 3);
    expect(result.accepted).toBe(true);
    expect(result.acceptanceScore).toBe(80);
  });

  it("rejects non-object parsed", () => {
    const result = scoreAcceptedCorrection(null, "hello", 1);
    expect(result.accepted).toBe(false);
    expect(result.acceptanceScore).toBe(0);
  });

  it("level 3 empty changes with different corrected text scores low but is accepted by cascade", async () => {
    const result = await scoreResponse({ corrected: "Hello there world", changes: [] }, "Hello world", 3);
    expect(result.score).toBe(55);
    expect(result.tier).toBe("low");
  });

  it("returns reasons array with pass/fail entries", () => {
    const result = scoreAcceptedCorrection({ corrected: "Hello.", changes: [] }, "hello", 1);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons.some((r) => r.pass === false)).toBe(true);
  });
});

function theirThereTheyreResponse() {
  return {
    corrected: "They're going to their house after work, and then they're meeting us there for dinner.",
    changes: [
      { original: "Their", replacement: "They're", explanation: "Use They're for 'they are'." },
      { original: "they're", replacement: "their", explanation: "Use their for possession." },
      { original: "there", replacement: "they're", explanation: "Use they're for 'they are'." },
      { original: "their", replacement: "there", explanation: "Use there for location." },
    ],
    confidence: 10,
  };
}

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
    expect(result.usable.find((c) => c.original === "i" && c.replacement === "I")).toBeTruthy();
  });
});

describe("classifyProviderFailure", () => {
  it("classifies structured_output_unsupported for response_format rejection", () => {
    const result = classifyProviderFailure(new Error("This model does not support response_format json_schema"));
    expect(result.kind).toBe("structured_output_unsupported");
    expect(result.cascadeable).toBe(true);
    expect(result.cacheLevelHint).toBe(2);
  });

  it("classifies json_not_followed for parse failure", () => {
    const result = classifyProviderFailure(new Error("Failed to parse grammar correction response"));
    expect(result.kind).toBe("json_not_followed");
    expect(result.cascadeable).toBe(true);
    expect(result.cacheLevelHint).toBeNull();
  });

  it("classifies network_or_auth_failure for API key errors", () => {
    const result = classifyProviderFailure(new Error("API key is required"));
    expect(result.kind).toBe("network_or_auth_failure");
    expect(result.cascadeable).toBe(false);
  });

  it("classifies network_or_auth_failure for timeout", () => {
    const result = classifyProviderFailure(new Error("Request timeout"));
    expect(result.kind).toBe("network_or_auth_failure");
    expect(result.cascadeable).toBe(false);
  });

  it("classifies network_or_auth_failure for 401", () => {
    const result = classifyProviderFailure(new Error("OpenAI API error: 401"));
    expect(result.kind).toBe("network_or_auth_failure");
    expect(result.cascadeable).toBe(false);
  });

  it("classifies rate_limit separately from network errors", () => {
    const result = classifyProviderFailure(new Error("API rate limit exceeded"));
    expect(result.kind).toBe("rate_limit");
    expect(result.cascadeable).toBe(false);
  });

  it("classifies 429 errors as non-cascadeable rate limits", () => {
    const result = classifyProviderFailure(new Error("OpenAI Compatible API error: 429"));
    expect(result.kind).toBe("rate_limit");
    expect(result.cascadeable).toBe(false);
  });

  it("classifies unknown_failure as non-cascadeable for unrecognized errors", () => {
    const result = classifyProviderFailure(new Error("Something completely unexpected"));
    expect(result.kind).toBe("unknown_failure");
    expect(result.cascadeable).toBe(false);
    expect(result.cacheLevelHint).toBeNull();
  });

  it("handles null/undefined error gracefully", () => {
    expect(classifyProviderFailure(null).kind).toBe("unknown_failure");
    expect(classifyProviderFailure(undefined).kind).toBe("unknown_failure");
  });
});

describe("scoring acceptance — real examples from logs", () => {
  it("accepts Their/There/They're correction with grounded changes", async () => {
    const result = await scoreResponse(
      theirThereTheyreResponse(),
      "Their going to they're house after work, and then there meeting us their for dinner.",
      1,
    );

    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.tier).toBe("medium");
    expect(result.usable.length).toBe(4);
  });

  it("accepts 'i could care less' idiom correction", async () => {
    const result = await scoreResponse(
      {
        corrected: "I couldn't care less.",
        changes: [
          { original: "i", replacement: "I", explanation: "Capitalize first-person singular pronoun." },
          { original: "could", replacement: "couldn't", explanation: "Correct idiom requires the negative form." },
          { original: "", replacement: ".", explanation: "Add terminal period." },
        ],
        confidence: 10,
      },
      "i could care less",
      1,
    );

    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.usable).toHaveLength(2);
    expect(result.suppressed).toHaveLength(1);
    expect(result.suppressed[0]._issues).toContain("insertion-only change");
  });

  it("accepts 'There is less people' with is->are and less->fewer", async () => {
    const result = await scoreResponse(
      {
        corrected: "There are fewer people here today.",
        changes: [
          { original: "is", replacement: "are", explanation: "Use 'are' with plural 'people'." },
          { original: "less", replacement: "fewer", explanation: "Use 'fewer' for countable nouns." },
        ],
        confidence: 10,
      },
      "There is less people here today.",
      1,
    );

    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.usable).toHaveLength(2);
    expect(result.suppressed).toHaveLength(0);
  });

  it("accepts 'so i didnt had any time tolarend' real example", async () => {
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
        confidence: 10,
      },
      "so i didnt had any time tolarend",
      1,
    );

    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.usable).toHaveLength(5);
    expect(result.suppressed).toHaveLength(1);
  });
});

describe("scoring rejection", () => {
  it("rejects whole-text rewrite as a single change", async () => {
    const result = await scoreResponse(
      {
        corrected: "The quick brown fox jumps over the lazy dog near the riverbank.",
        changes: [
          {
            original: "The quick brown fox jumps over the lazy dog",
            replacement: "The quick brown fox jumps over the lazy dog near the riverbank.",
            explanation: "Added location detail.",
          },
        ],
        confidence: 10,
      },
      "The quick brown fox jumps over the lazy dog",
      1,
    );

    const wholeTextCheck = result.checks.find((c) => c.name === "granularity");
    expect(wholeTextCheck).toBeDefined();
    expect(wholeTextCheck.pass).toBe(false);
    expect(result.score).toBe(82);
  });

  it("penalizes broad rewrite replacement", async () => {
    const result = await scoreResponse(
      {
        corrected: "The meeting has been rescheduled to next Tuesday at 2 PM.",
        changes: [
          {
            original: "The meeting is now moved to Tues",
            replacement: "The meeting has been rescheduled to next Tuesday at 2 PM.",
            explanation: "Clarify meeting time.",
          },
        ],
        confidence: 10,
      },
      "The meeting is now moved to Tues",
      1,
    );

    const granularityCheck = result.checks.find((c) => c.name === "granularity");
    expect(granularityCheck).toBeDefined();
    expect(granularityCheck.pass).toBe(false);
    expect(result.score).toBe(82);
  });

  it("penalizes corrected text that contradicts usable changes", async () => {
    const result = await scoreResponse(
      {
        corrected: "She went to the store.",
        changes: [
          { original: "He", replacement: "She", explanation: "Correct gender pronoun." },
          { original: "store", replacement: "park", explanation: "Fix location." },
        ],
        confidence: 10,
      },
      "He went to the store yesterday.",
      1,
    );

    const consistencyCheck = result.checks.find((c) => c.name === "corrected consistency");
    expect(consistencyCheck).toBeDefined();
    expect(consistencyCheck.pass).toBe(false);
    expect(result.score).toBeLessThan(80);
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
