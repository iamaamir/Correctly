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

  const earthCorrection = () => ({
    corrected: "Hello earth",
    changes: [{ original: "world", replacement: "earth", explanation: "Use the intended noun." }],
    confidence: 10,
  });

  function expectLevelsCalled(provider, { level1, level2, level3 }) {
    if (level1) expect(provider.levels.level1).toHaveBeenCalledOnce();
    else expect(provider.levels.level1).not.toHaveBeenCalled();
    if (level2) expect(provider.levels.level2).toHaveBeenCalledOnce();
    else expect(provider.levels.level2).not.toHaveBeenCalled();
    if (level3) expect(provider.levels.level3).toHaveBeenCalledOnce();
    else expect(provider.levels.level3).not.toHaveBeenCalled();
  }

  it("accepts a valid level 1 response and increments level 1 cache", async () => {
    const provider = new CascadeProvider({
      level1: vi.fn(async () => earthCorrection()),
    });

    const result = await provider.correctGrammar("Hello world");

    expect(result.cascadeLevel).toBe(1);
    expectLevelsCalled(provider, { level1: true, level2: false, level3: false });
    expect(chrome.storage.local._store.get("modelLevelCache")).toEqual({
      "cascade-test:cascade-model": {
        level: 1,
        checksAtLevel: 1,
        level2Failures: 0,
        reason: "structured_output_supported",
      },
    });
  });

  it("cascades from level 1 to level 2 on invalid structured response without downgrading cache", async () => {
    const provider = new CascadeProvider({
      level1: vi.fn(async () => ({ changes: [], confidence: 10 })),
      level2: vi.fn(async () => earthCorrection()),
    });

    const result = await provider.correctGrammar("Hello world");

    expect(result.cascadeLevel).toBe(2);
    expectLevelsCalled(provider, { level1: true, level2: true, level3: false });
    expect(chrome.storage.local._store.get("modelLevelCache")).toBeUndefined();
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
    expectLevelsCalled(provider, { level1: true, level2: true, level3: true });
    // Validation failures (missing fields) are score-based, not capability-based,
    // so no plain_text_only cached. But L2 json_not_followed IS tracked.
    expect(chrome.storage.local._store.get("modelLevelCache")).toEqual({
      "cascade-test:cascade-model": {
        level: 1,
        checksAtLevel: 0,
        level2Failures: 1,
        reason: undefined,
      },
    });
  });

  it("starts at the cached cascade level", async () => {
    await chrome.storage.local.set({
      modelLevelCache: {
        "cascade-test:cascade-model": { level: 2, checksAtLevel: 3 },
      },
    });
    const provider = new CascadeProvider({
      level2: vi.fn(async () => earthCorrection()),
    });

    const result = await provider.correctGrammar("Hello world");

    expect(result.cascadeLevel).toBe(2);
    expectLevelsCalled(provider, { level1: false, level2: true, level3: false });
  });

  const nonCascadeableErrors = [
    { name: "non-cascadeable errors", message: "API key is required" },
    { name: "unknown provider errors", message: "Unexpected provider bug" },
    { name: "429 rate-limit errors", message: "Provider API error: 429" },
  ];

  it.each(nonCascadeableErrors)("does not cascade $name", async ({ message }) => {
    const provider = new CascadeProvider({
      level1: vi.fn(async () => {
        throw new Error(message);
      }),
    });

    await expect(provider.correctGrammar("Hello world")).rejects.toThrow(message);
    expectLevelsCalled(provider, { level1: true, level2: false, level3: false });
  });

  it("downgrades cache only when a capability hint is present", async () => {
    const err = new Error("Fallback JSON parse failed after schema rejection");
    err.cacheLevelHint = 2;
    err.cacheReason = "structured_output_unsupported";
    const provider = new CascadeProvider({
      level1: vi.fn(async () => {
        throw err;
      }),
      level2: vi.fn(async () => earthCorrection()),
    });

    const result = await provider.correctGrammar("Hello world");

    expect(result.cascadeLevel).toBe(2);
    expect(chrome.storage.local._store.get("modelLevelCache")).toEqual({
      "cascade-test:cascade-model": {
        level: 2,
        checksAtLevel: 0,
        level2Failures: 0,
        reason: "structured_output_unsupported",
      },
    });
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
    expectLevelsCalled(provider, { level1: true, level2: true, level3: true });
    expect(chrome.storage.local._store.get("modelLevelCache")).toBeUndefined();
  });

  it("caches plain_text_only when capability cascade reaches level 3", async () => {
    const provider = new CascadeProvider({
      level1: vi.fn(async () => {
        throw new Error("Provider response invalid: missing corrected");
      }),
      level2: vi.fn(async () => {
        throw new Error("response_format not supported: 400");
      }),
      level3: vi.fn(async () => ({
        corrected: "Hello earth",
        changes: [],
        confidence: 5,
      })),
    });

    const result = await provider.correctGrammar("Hello world");

    expect(result.cascadeLevel).toBe(3);
    // L1 json_not_followed: cacheLevelHint stays null
    // L2 response_format: sets cacheLevelHint = 2 → capability cascade
    // L3 success: writes plain_text_only
    expect(chrome.storage.local._store.get("modelLevelCache")).toEqual({
      "cascade-test:cascade-model": {
        level: 3,
        checksAtLevel: 0,
        level2Failures: 0,
        reason: "plain_text_only",
      },
    });
  });

  it("tracks Level 2 JSON failure count when L3 succeeds after L2 json_not_followed", async () => {
    const providerLevel2JsonFail = new CascadeProvider({
      level1: vi.fn(async () => ({
        corrected: "Hello there world",
        changes: [],
        confidence: 10,
      })),
      level2: vi.fn(async () => {
        throw new Error("Failed to parse response from provider");
      }),
      level3: vi.fn(async () => ({
        corrected: "Hello earth",
        changes: [],
        confidence: 5,
      })),
    });

    const result = await providerLevel2JsonFail.correctGrammar("Hello world");

    expect(result.cascadeLevel).toBe(3);
    // L1 empty changes + different corrected → score < 60 → cascades to L2
    // L2 json_not_followed → level2CascadeFailed = true
    // L3 succeeds (score-based, no capability hint) → _recordLevel2Failure()
    // No cache downgrade since cacheLevelHint is null
    expect(chrome.storage.local._store.get("modelLevelCache")).toEqual({
      "cascade-test:cascade-model": {
        level: 1,
        checksAtLevel: 0,
        level2Failures: 1,
        reason: undefined,
      },
    });
  });

  it("caches json_prompt_unreliable after 3 repeated Level 2 JSON failures", async () => {
    const err = new Error("Failed to parse response from provider");
    const provider = new CascadeProvider({
      level1: vi.fn(async () => ({
        corrected: "Hello there world",
        changes: [],
        confidence: 10,
      })),
      level2: vi.fn(async () => {
        throw err;
      }),
      level3: vi.fn(async () => {
        throw new Error("Failed to parse level 3");
      }),
    });

    // First failure: L1 succeeds, L2 json_not_followed, L3 json_not_followed → exhaust
    await expect(provider.correctGrammar("Hello world")).rejects.toThrow("Grammar check failed");
    let cache = chrome.storage.local._store.get("modelLevelCache");
    expect(cache["cascade-test:cascade-model"].level2Failures).toBe(1);

    // Second failure
    await expect(provider.correctGrammar("Hello world")).rejects.toThrow("Grammar check failed");
    cache = chrome.storage.local._store.get("modelLevelCache");
    expect(cache["cascade-test:cascade-model"].level2Failures).toBe(2);

    // Third failure → crosses L2_FAILURE_THRESHOLD (3)
    await expect(provider.correctGrammar("Hello world")).rejects.toThrow("Grammar check failed");
    cache = chrome.storage.local._store.get("modelLevelCache");
    expect(cache["cascade-test:cascade-model"]).toEqual({
      level: 3,
      checksAtLevel: 0,
      level2Failures: 3,
      reason: "json_prompt_unreliable",
    });
  });
});
