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

  async _doCorrectGrammar(text, _options) {
    return await this.levels.level1(text, _options);
  }

  async _doCorrectGrammarLevel2(text, _options) {
    return await this.levels.level2(text, _options);
  }

  async _doCorrectGrammarLevel3(text, _options) {
    return await this.levels.level3(text, _options);
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
    expect(provider.levels.level1).toHaveBeenCalledOnce();
    expect(provider.levels.level2).toHaveBeenCalledOnce();
    expect(provider.levels.level3).toHaveBeenCalledOnce();
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

  it("does not cascade unknown provider errors", async () => {
    const provider = new CascadeProvider({
      level1: vi.fn(async () => {
        throw new Error("Unexpected provider bug");
      }),
    });

    await expect(provider.correctGrammar("Hello world")).rejects.toThrow("Unexpected provider bug");
    expect(provider.levels.level1).toHaveBeenCalledOnce();
    expect(provider.levels.level2).not.toHaveBeenCalled();
    expect(provider.levels.level3).not.toHaveBeenCalled();
  });

  it("does not cascade 429 rate-limit errors", async () => {
    const provider = new CascadeProvider({
      level1: vi.fn(async () => {
        throw new Error("Provider API error: 429");
      }),
    });

    await expect(provider.correctGrammar("Hello world")).rejects.toThrow("Provider API error: 429");
    expect(provider.levels.level1).toHaveBeenCalledOnce();
    expect(provider.levels.level2).not.toHaveBeenCalled();
    expect(provider.levels.level3).not.toHaveBeenCalled();
  });

  it("downgrades cache only when a capability hint is present", async () => {
    const err = new Error("Fallback JSON parse failed after schema rejection");
    err.cacheLevelHint = 2;
    err.cacheReason = "structured_output_unsupported";
    const provider = new CascadeProvider({
      level1: vi.fn(async () => {
        throw err;
      }),
      level2: vi.fn(async () => ({
        corrected: "Hello earth",
        changes: [{ original: "world", replacement: "earth", explanation: "Use the intended noun." }],
        confidence: 10,
      })),
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
    expect(provider.levels.level1).toHaveBeenCalledOnce();
    expect(provider.levels.level2).toHaveBeenCalledOnce();
    expect(provider.levels.level3).toHaveBeenCalledOnce();
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

// ── Signal / abort propagation ──

describe("cascade signal propagation", () => {
  beforeEach(() => {
    chrome.storage.local._store.clear();
  });
  it("rejects with AbortError for pre-aborted signal before any level is attempted", async () => {
    const provider = new CascadeProvider();
    const ac = new AbortController();
    ac.abort();
    await expect(provider.correctGrammar("Hello world", { signal: ac.signal })).rejects.toThrow();
    expect(provider.levels.level1).not.toHaveBeenCalled();
  });

  it("increments cascade aborted counter on AbortError", async () => {
    const provider = new CascadeProvider();
    const ac = new AbortController();
    ac.abort();
    try {
      await provider.correctGrammar("Hello world", { signal: ac.signal });
    } catch {}
    expect(provider.getCascadeMetrics().aborted).toBe(0);
  });

  it("increments cascade aborted counter when AbortError is caught inside try block", async () => {
    const provider = new CascadeProvider();
    const ac = new AbortController();
    // Make the first checkpoint pass (not aborted), then abort during fn()
    // by passing signal through to the provider which checks it mid-flight
    provider.levels.level1 = vi.fn(async (_text, options) => {
      await new Promise((r) => setTimeout(r, 5));
      options?.signal?.throwIfAborted?.();
      return { corrected: "Hello", changes: [], confidence: 10 };
    });
    const p = provider.correctGrammar("Hello world", { signal: ac.signal });
    await new Promise((r) => setTimeout(r, 2));
    ac.abort();
    await expect(p).rejects.toThrow();
    expect(provider.getCascadeMetrics().aborted).toBe(1);
  });

  it("does not cascade AbortError to level 2", async () => {
    const level1 = vi.fn(async (_text, options) => {
      await new Promise((r) => setTimeout(r, 5));
      options?.signal?.throwIfAborted?.();
      return { corrected: "Hello world", changes: [], confidence: 10 };
    });
    const level2 = vi.fn();
    const provider = new CascadeProvider({ level1, level2 });
    const ac = new AbortController();
    const p = provider.correctGrammar("Hello world", { signal: ac.signal });
    await new Promise((r) => setTimeout(r, 2));
    ac.abort();
    await expect(p).rejects.toThrow();
    expect(level2).not.toHaveBeenCalled();
  });

  it("does not update cache when aborted mid-flight after provider returns", async () => {
    const provider = new CascadeProvider({
      level1: vi.fn(async (_text, options) => {
        await new Promise((r) => setTimeout(r, 5));
        options?.signal?.throwIfAborted?.();
        return { corrected: "Hello", changes: [], confidence: 10 };
      }),
    });
    const ac = new AbortController();
    const p = provider.correctGrammar("Hello world", { signal: ac.signal });
    await new Promise((r) => setTimeout(r, 2));
    ac.abort();
    await expect(p).rejects.toThrow();
    expect(chrome.storage.local._store.get("modelLevelCache")).toBeUndefined();
  });

  it("passes unknown providerOptions through to _doCorrectGrammar", async () => {
    const provider = new CascadeProvider({
      level1: vi.fn(async (text, options) => {
        expect(options.customParam).toBe("hello");
        return { corrected: "Hello world", changes: [], confidence: 10 };
      }),
    });
    const result = await provider.correctGrammar("Hello world", {
      customParam: "hello",
    });
    expect(result.cascadeLevel).toBe(1);
    await vi.waitFor(() => {
      expect(provider.levels.level1).toHaveBeenCalledWith(
        "Hello world",
        expect.objectContaining({ customParam: "hello" }),
      );
    });
  });
});
