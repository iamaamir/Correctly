import { beforeEach, describe, expect, it, vi } from "vitest";
import { AbstractProvider } from "../../providers/abstract-provider.js";
import { createChromeStub } from "../helpers/chrome-stub.js";

class CascadeProvider extends AbstractProvider {
  static get id() {
    return "cascade-test";
  }

  static get displayName() {
    return "Cascade Test";
  }

  static get models() {
    return [{ id: "cascade-model", label: "Cascade Model", hint: "For cascade tests" }];
  }

  static get defaultModel() {
    return "cascade-model";
  }

  static get keyPlaceholder() {
    return "test-key";
  }

  static get requiresApiKey() {
    return false;
  }

  constructor(levels = {}) {
    super("", "cascade-model");
    this.levels = {
      level1: vi.fn(async () => ({ corrected: "Hello world", changes: [], confidence: 10 })),
      level2: vi.fn(async () => ({ corrected: "Hello world", changes: [], confidence: 10 })),
      level3: vi.fn(async () => ({ corrected: "Hello world", changes: [], confidence: 5 })),
      ...levels,
    };
  }

  async _doCorrectGrammar(text) {
    return await this.levels.level1(text);
  }

  async _doCorrectGrammarLevel2(text) {
    return await this.levels.level2(text);
  }

  async _doCorrectGrammarLevel3(text) {
    return await this.levels.level3(text);
  }
}

describe("AbstractProvider cascade", () => {
  beforeEach(() => {
    vi.stubGlobal("chrome", createChromeStub());
  });

  it("accepts a valid level 1 response and increments level 1 cache", async () => {
    const provider = new CascadeProvider({
      level1: vi.fn(async () => ({
        corrected: "Hello earth",
        changes: [{ original: "world", replacement: "earth", explanation: "Use the intended noun." }],
        confidence: 10,
      })),
    });

    const result = await provider.correctGrammar("Hello world");

    expect(result.cascadeLevel).toBe(1);
    expect(provider.levels.level1).toHaveBeenCalledOnce();
    expect(provider.levels.level2).not.toHaveBeenCalled();
    expect(provider.levels.level3).not.toHaveBeenCalled();
    expect(chrome.storage.local._store.get("modelLevelCache")).toEqual({
      "cascade-test:cascade-model": { level: 1, checksAtLevel: 1 },
    });
  });

  it("cascades from level 1 to level 2 on invalid structured response", async () => {
    const provider = new CascadeProvider({
      level1: vi.fn(async () => ({ changes: [], confidence: 10 })),
      level2: vi.fn(async () => ({
        corrected: "Hello earth",
        changes: [{ original: "world", replacement: "earth", explanation: "Use the intended noun." }],
        confidence: 10,
      })),
    });

    const result = await provider.correctGrammar("Hello world");

    expect(result.cascadeLevel).toBe(2);
    expect(provider.levels.level1).toHaveBeenCalledOnce();
    expect(provider.levels.level2).toHaveBeenCalledOnce();
    expect(provider.levels.level3).not.toHaveBeenCalled();
    expect(chrome.storage.local._store.get("modelLevelCache")).toEqual({
      "cascade-test:cascade-model": { level: 2, checksAtLevel: 0 },
    });
  });

  it("cascades through level 2 and accepts level 3 plain-text fallback shape", async () => {
    const provider = new CascadeProvider({
      level1: vi.fn(async () => ({ changes: [], confidence: 10 })),
      level2: vi.fn(async () => ({ corrected: "Hello earth", changes: [] })),
      level3: vi.fn(async () => ({ corrected: "Hello earth", changes: [], confidence: 5 })),
    });

    const result = await provider.correctGrammar("Hello world");

    expect(result).toMatchObject({
      corrected: "Hello earth",
      changes: [],
      cascadeLevel: 3,
      confidence: 55,
    });
    expect(provider.levels.level1).toHaveBeenCalledOnce();
    expect(provider.levels.level2).toHaveBeenCalledOnce();
    expect(provider.levels.level3).toHaveBeenCalledOnce();
    expect(chrome.storage.local._store.get("modelLevelCache")).toEqual({
      "cascade-test:cascade-model": { level: 3, checksAtLevel: 0 },
    });
  });

  it("starts at the cached cascade level", async () => {
    await chrome.storage.local.set({
      modelLevelCache: {
        "cascade-test:cascade-model": { level: 2, checksAtLevel: 3 },
      },
    });
    const provider = new CascadeProvider({
      level2: vi.fn(async () => ({
        corrected: "Hello earth",
        changes: [{ original: "world", replacement: "earth", explanation: "Use the intended noun." }],
        confidence: 10,
      })),
    });

    const result = await provider.correctGrammar("Hello world");

    expect(result.cascadeLevel).toBe(2);
    expect(provider.levels.level1).not.toHaveBeenCalled();
    expect(provider.levels.level2).toHaveBeenCalledOnce();
    expect(provider.levels.level3).not.toHaveBeenCalled();
  });

  it("does not cascade non-cascadeable errors", async () => {
    const provider = new CascadeProvider({
      level1: vi.fn(async () => {
        throw new Error("API key is required");
      }),
    });

    await expect(provider.correctGrammar("Hello world")).rejects.toThrow("API key is required");
    expect(provider.levels.level1).toHaveBeenCalledOnce();
    expect(provider.levels.level2).not.toHaveBeenCalled();
    expect(provider.levels.level3).not.toHaveBeenCalled();
  });

  it("does not downgrade cache when cascading because a response scored too low", async () => {
    const provider = new CascadeProvider({
      level1: vi.fn(async () => ({
        corrected: "Hello there world",
        changes: [],
        confidence: 10,
      })),
      level2: vi.fn(async () => ({
        corrected: "Hello there world",
        changes: [],
        confidence: 10,
      })),
      level3: vi.fn(async () => ({
        corrected: "Hello there world",
        changes: [],
        confidence: 5,
      })),
    });

    const result = await provider.correctGrammar("Hello world");

    expect(result.cascadeLevel).toBe(3);
    expect(provider.levels.level1).toHaveBeenCalledOnce();
    expect(provider.levels.level2).toHaveBeenCalledOnce();
    expect(provider.levels.level3).toHaveBeenCalledOnce();
    expect(chrome.storage.local._store.get("modelLevelCache")).toBeUndefined();
  });
});
