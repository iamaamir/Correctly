import { describe, expect, it, vi } from "vitest";
import {
  AbstractOpenAICompatibleProvider,
  RESPONSE_SCHEMA,
} from "../../providers/abstract-openai-compatible-provider.js";
import { AbstractProvider } from "../../providers/abstract-provider.js";
import { createChromeStub } from "../helpers/chrome-stub.js";

class TestProvider extends AbstractProvider {
  static get id() {
    return "test";
  }

  static get displayName() {
    return "Test";
  }

  static get models() {
    return [{ id: "test-model", label: "Test Model", hint: "For tests" }];
  }

  static get defaultModel() {
    return "test-model";
  }

  static get keyPlaceholder() {
    return "test-key";
  }

  static get requiresApiKey() {
    return false;
  }
}

class TestOpenAICompatibleProvider extends AbstractOpenAICompatibleProvider {
  static get id() {
    return "test-openai-compatible";
  }

  static get displayName() {
    return "Test OpenAI Compatible";
  }

  static get models() {
    return [{ id: "test-model", label: "Test Model", hint: "For tests" }];
  }

  static get defaultModel() {
    return "test-model";
  }

  static get keyPlaceholder() {
    return "test-key";
  }
}

describe("AbstractProvider response validation", () => {
  it("requires confidence in model responses", () => {
    const provider = new TestProvider("", "test-model");

    expect(() => provider._validateResponse({ corrected: "Hello.", changes: [] }, "Hello.")).toThrow(
      'Provider response missing "confidence" number from 1-10',
    );
  });

  it("accepts confidence from 1 to 10", () => {
    const provider = new TestProvider("", "test-model");

    expect(provider._validateResponse({ corrected: "Hello.", changes: [], confidence: 10 }, "Hello.")).toEqual({
      corrected: "Hello.",
      changes: [],
      confidence: 10,
    });
  });

  it("rejects confidence outside 1 to 10", () => {
    const provider = new TestProvider("", "test-model");

    expect(() => provider._validateResponse({ corrected: "Hello.", changes: [], confidence: 0 }, "Hello.")).toThrow(
      'Provider response missing "confidence" number from 1-10',
    );
  });
});

describe("OpenAI-compatible response schema", () => {
  it("requires every strict schema property", () => {
    const schema = RESPONSE_SCHEMA.json_schema.schema;

    expect(schema.required).toEqual(["corrected", "changes", "confidence"]);
    expect(Object.keys(schema.properties).sort()).toEqual([...schema.required].sort());
  });

  it("extracts fenced JSON when structured output is unsupported", async () => {
    const provider = new TestOpenAICompatibleProvider("test-key", "test-model");
    const calls = [];

    provider._callApi = async (_text, _systemPrompt, { useSchema }) => {
      calls.push(useSchema);
      if (useSchema) throw new Error("This model does not support response_format json_schema");
      return {
        content: `Here is the correction:

\`\`\`json
{
  "corrected": "He went to school yesterday.",
  "changes": [
    {
      "original": "go",
      "replacement": "went",
      "explanation": "Use past tense for yesterday."
    }
  ],
  "confidence": 10
}
\`\`\``,
        usage: null,
      };
    };

    await expect(provider._doCorrectGrammar("He go to school yesterday.")).resolves.toEqual({
      corrected: "He went to school yesterday.",
      changes: [{ original: "go", replacement: "went", explanation: "Use past tense for yesterday." }],
      confidence: 10,
      usage: null,
    });
    expect(calls).toEqual([true, false]);
    expect(provider._noStructuredOutput).toBe(true);
  });

  it("reuses no-schema parsing once structured output has been rejected", async () => {
    const provider = new TestOpenAICompatibleProvider("test-key", "no-schema-cache-model");
    provider._callApi = async (_text, _systemPrompt, { useSchema }) => {
      if (useSchema) throw new Error("This model does not support response_format json_schema");
      return {
        content:
          '```json\n{"corrected":"Hello world.","changes":[{"original":"world","replacement":"world.","explanation":"Add terminal punctuation."}],"confidence":10}\n```',
        usage: null,
      };
    };

    await expect(provider._doCorrectGrammar("Hello world")).resolves.toMatchObject({
      corrected: "Hello world.",
      confidence: 10,
    });

    const nextProvider = new TestOpenAICompatibleProvider("test-key", "no-schema-cache-model");
    nextProvider._callApi = async (_text, _systemPrompt, { useSchema }) => {
      expect(useSchema).toBe(false);
      return {
        content:
          '```json\n{"corrected":"Hello world.","changes":[{"original":"world","replacement":"world.","explanation":"Add terminal punctuation."}],"confidence":10}\n```',
        usage: null,
      };
    };

    await expect(nextProvider._doCorrectGrammar("Hello world")).resolves.toMatchObject({
      corrected: "Hello world.",
      confidence: 10,
    });
  });

  it("cascades to level 2 when unsupported structured output fallback is not parseable", async () => {
    vi.stubGlobal("chrome", createChromeStub());
    const provider = new TestOpenAICompatibleProvider("test-key", "compound-style-model");
    const calls = [];

    provider._callApi = async (_text, systemPrompt, { useSchema }) => {
      calls.push({ useSchema, level2: systemPrompt.includes("Think through the text step by step") });
      if (useSchema) throw new Error("This model does not support response_format json_schema");
      if (!systemPrompt.includes("Think through the text step by step")) {
        return {
          content: "The corrected sentence is: He went to school yesterday.",
          usage: null,
        };
      }
      return {
        content: `Reasoning...

\`\`\`json
{
  "corrected": "He went to school yesterday.",
  "changes": [
    {
      "original": "go",
      "replacement": "went",
      "explanation": "Use past tense for yesterday."
    }
  ],
  "confidence": 10
}
\`\`\``,
        usage: null,
      };
    };

    const result = await provider.correctGrammar("He go to school yesterday.");

    expect(result).toMatchObject({
      corrected: "He went to school yesterday.",
      cascadeLevel: 2,
    });
    expect(calls).toEqual([
      { useSchema: true, level2: false },
      { useSchema: false, level2: false },
      { useSchema: false, level2: true },
    ]);
  });

  it("keeps level 3 as plain-text fallback when JSON levels are unusable", async () => {
    vi.stubGlobal("chrome", createChromeStub());
    const provider = new TestOpenAICompatibleProvider("test-key", "plain-text-fallback-model");
    const calls = [];

    provider._callApi = async (_text, systemPrompt, { useSchema }) => {
      calls.push({ useSchema, level3: systemPrompt.includes("Return ONLY the corrected text") });
      if (useSchema) throw new Error("This model does not support response_format json_schema");
      if (systemPrompt.includes("Return ONLY the corrected text")) {
        return { content: "He went to school yesterday.", usage: null };
      }
      return { content: "I can fix it, but not as JSON.", usage: null };
    };

    const result = await provider.correctGrammar("He go to school yesterday.");

    expect(result).toMatchObject({
      corrected: "He went to school yesterday.",
      changes: [],
      cascadeLevel: 3,
    });
    expect(result.confidence).toBeGreaterThanOrEqual(45);
    expect(result.confidence).toBeLessThanOrEqual(55);
    expect(calls).toEqual([
      { useSchema: true, level3: false },
      { useSchema: false, level3: false },
      { useSchema: false, level3: false },
      { useSchema: false, level3: true },
    ]);
  });
});
