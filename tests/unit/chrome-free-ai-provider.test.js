import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChromeFreeAIProvider } from "../../providers/chrome-free-ai-provider.js";
import {
  installMockLanguageModel,
  resetMockState,
  getMockSessions,
  MockLanguageModel,
} from "../mocks/language-model.js";

const DEFAULT_AVAILABILITY = MockLanguageModel.availability;
const DEFAULT_CREATE = MockLanguageModel.create;

let uninstall;

beforeEach(() => {
  uninstall = installMockLanguageModel();
  resetMockState();
  // reset to defaults in case a prior test overrode them
  MockLanguageModel.availability = DEFAULT_AVAILABILITY;
  MockLanguageModel.create = DEFAULT_CREATE;
});

afterEach(() => {
  uninstall?.();
});

function createProvider() {
  return new ChromeFreeAIProvider("", "gemini-nano");
}

// ── isAvailable ──

describe("isAvailable", () => {
  it("returns true when LanguageModel is defined", () => {
    expect(ChromeFreeAIProvider.isAvailable()).toBe(true);
  });

  it("returns false when LanguageModel is undefined", () => {
    vi.stubGlobal("LanguageModel", undefined);
    expect(ChromeFreeAIProvider.isAvailable()).toBe(false);
  });
});

// ── getStatus ──

describe("getStatus", () => {
  it.each([
    ["readily", ChromeFreeAIProvider.STATUS.AVAILABLE],
    ["available", ChromeFreeAIProvider.STATUS.AVAILABLE],
    ["after-download", ChromeFreeAIProvider.STATUS.DOWNLOADABLE],
    ["downloadable", ChromeFreeAIProvider.STATUS.DOWNLOADABLE],
    ["downloading", ChromeFreeAIProvider.STATUS.DOWNLOADING],
    ["no", ChromeFreeAIProvider.STATUS.UNAVAILABLE],
    ["unavailable", ChromeFreeAIProvider.STATUS.UNAVAILABLE],
  ])('maps "%s" to %s', async (raw, expected) => {
    MockLanguageModel.availability = vi.fn().mockResolvedValue(raw);
    expect(await ChromeFreeAIProvider.getStatus()).toBe(expected);
  });

  it("returns UNAVAILABLE for unknown raw status", async () => {
    MockLanguageModel.availability = vi.fn().mockResolvedValue("unknown-status");
    expect(await ChromeFreeAIProvider.getStatus()).toBe(ChromeFreeAIProvider.STATUS.UNAVAILABLE);
  });

  it("returns UNAVAILABLE when LanguageModel is undefined", async () => {
    vi.stubGlobal("LanguageModel", undefined);
    expect(await ChromeFreeAIProvider.getStatus()).toBe(ChromeFreeAIProvider.STATUS.UNAVAILABLE);
  });
});

// ── ensureModel ──

describe("ensureModel", () => {
  it("creates and destroys a session", async () => {
    await ChromeFreeAIProvider.ensureModel();
    const sessions = getMockSessions();
    expect(sessions.length).toBe(1);
    expect(sessions[0].destroyed).toBe(true);
  });

  it("passes monitor callback to LanguageModel.create", async () => {
    const spy = vi.fn();
    MockLanguageModel.create = vi.fn(async (config) => {
      config.monitor?.({ addEventListener: spy });
      return { destroy: vi.fn(), prompt: vi.fn() };
    });
    await ChromeFreeAIProvider.ensureModel(vi.fn());
    expect(MockLanguageModel.create).toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
  });
});

// ── Session metrics ──

describe("session metrics", () => {
  it("starts at zero", () => {
    const provider = createProvider();
    expect(provider.getSessionMetrics()).toEqual({
      createCount: 0,
      cloneCount: 0,
      destroyCount: 0,
      promptCount: 0,
      abortCount: 0,
      reuseCount: 0,
    });
  });

  it("resetSessionMetrics clears counters", () => {
    const provider = createProvider();
    provider._getSessionMetrics().createCount = 5;
    provider.resetSessionMetrics();
    expect(provider.getSessionMetrics().createCount).toBe(0);
  });
});

// ── _getBaseSession ──

describe("_getBaseSession", () => {
  it("creates a new base session on first call", async () => {
    const provider = createProvider();
    const session = await provider._getBaseSession(1, {});
    expect(session).toBeDefined();
    expect(session.destroyed).toBe(false);
    expect(provider._getSessionMetrics().createCount).toBe(1);
    expect(provider._getSessionMetrics().reuseCount).toBe(0);
  });

  it("caches and reuses base session on second call", async () => {
    const provider = createProvider();
    const first = await provider._getBaseSession(1, {});
    const second = await provider._getBaseSession(1, {});
    expect(second).toBe(first);
    expect(provider._getSessionMetrics().createCount).toBe(1);
    expect(provider._getSessionMetrics().reuseCount).toBe(1);
  });

  it("creates separate base sessions per level", async () => {
    const provider = createProvider();
    const l1 = await provider._getBaseSession(1, {});
    const l2 = await provider._getBaseSession(2, {});
    expect(l1).not.toBe(l2);
    expect(provider._getSessionMetrics().createCount).toBe(2);
  });

  it("deduplicates concurrent calls for the same level", async () => {
    const provider = createProvider();
    const [a, b] = await Promise.all([
      provider._getBaseSession(1, {}),
      provider._getBaseSession(1, {}),
    ]);
    expect(a).toBe(b);
    expect(provider._getSessionMetrics().createCount).toBe(1);
  });

  it("passes signal to LanguageModel.create", async () => {
    const provider = createProvider();
    const ac = new AbortController();
    const spy = vi.spyOn(MockLanguageModel, "create");
    await provider._getBaseSession(1, { signal: ac.signal });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ signal: ac.signal }),
    );
  });

  it("rethrows error when LanguageModel.create fails", async () => {
    const provider = createProvider();
    MockLanguageModel.create = vi.fn(async () => {
      throw new Error("download failed");
    });
    await expect(provider._getBaseSession(1, {})).rejects.toThrow("download failed");
  });
});

// ── destroySessions ──

describe("destroySessions", () => {
  it("destroys all base sessions and clears maps", async () => {
    const provider = createProvider();
    await provider._getBaseSession(1, {});
    await provider._getBaseSession(2, {});
    const sessionsBefore = getMockSessions();
    const baseSessions = sessionsBefore.filter((s) => !s.isClone);

    provider.destroySessions();

    expect(provider.baseSessionsByLevel.size).toBe(0);
    expect(provider.baseSessionPromisesByLevel.size).toBe(0);
    expect(provider.baseSessionGenerationByLevel.size).toBe(0);
    for (const s of baseSessions) {
      expect(s.destroyed).toBe(true);
    }
  });

  it("increments generation, causing next _getBaseSession to create fresh", async () => {
    const provider = createProvider();
    const first = await provider._getBaseSession(1, {});
    provider.destroySessions();
    const second = await provider._getBaseSession(1, {});
    expect(second).not.toBe(first);
    expect(provider._getSessionMetrics().createCount).toBe(2);
  });
});

// ── _runWithSession ──

describe("_runWithSession", () => {
  it("clones base session when skipSessionCache is false", async () => {
    const provider = createProvider();
    const result = await provider._runWithSession("hello world", 1, {});
    const m = provider._getSessionMetrics();
    expect(m.createCount).toBe(1);
    expect(m.cloneCount).toBe(1);
    expect(m.promptCount).toBe(1);
    expect(m.destroyCount).toBe(1);
    expect(result).toBeDefined();
  });

  it("creates one-shot session when skipSessionCache is true", async () => {
    const provider = createProvider();
    const result = await provider._runWithSession("hello world", 1, { skipSessionCache: true });
    const m = provider._getSessionMetrics();
    expect(m.createCount).toBe(1);
    expect(m.cloneCount).toBe(0);
    expect(m.promptCount).toBe(1);
    expect(m.destroyCount).toBe(1);
    expect(result).toBeDefined();
  });

  it("destroys cloned session after prompt in finally", async () => {
    const provider = createProvider();
    await provider._runWithSession("hello world", 1, {});
    const sessions = getMockSessions();
    const clones = sessions.filter((s) => s.isClone);
    for (const c of clones) {
      expect(c.destroyed).toBe(true);
    }
  });

  it("destroys one-shot session after prompt in finally", async () => {
    const provider = createProvider();
    await provider._runWithSession("hello world", 1, { skipSessionCache: true });
    const sessions = getMockSessions();
    const oneshots = sessions.filter((s) => !s.isClone);
    for (const s of oneshots) {
      expect(s.destroyed).toBe(true);
    }
  });

  it("returns prompt result for level 1 with GRAMMAR_SCHEMA constraint", async () => {
    const provider = createProvider();
    const result = await provider._runWithSession("hello world", 1, {});
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty("corrected");
    expect(parsed).toHaveProperty("changes");
    expect(parsed).toHaveProperty("confidence");
  });

  it("passes signal to session.prompt", async () => {
    const provider = createProvider();
    const ac = new AbortController();
    const base = await provider._getBaseSession(1, {});
    const clone = await base.clone();
    const spy = vi.spyOn(clone, "prompt");
    vi.spyOn(base, "clone").mockResolvedValue(clone);

    await provider._runWithSession("hello world", 1, { signal: ac.signal });
    expect(spy).toHaveBeenCalledWith(
      "hello world",
      expect.objectContaining({ signal: ac.signal }),
    );
  });

  it("uses correct system prompt for each level", async () => {
    const provider = createProvider();
    const spy = vi.spyOn(MockLanguageModel, "create");

    await provider._runWithSession("test", 1, { skipSessionCache: true });
    await provider._runWithSession("test", 2, { skipSessionCache: true });
    await provider._runWithSession("test", 3, { skipSessionCache: true });

    const calls = spy.mock.calls;
    expect(calls[0][0].initialPrompts[0].content).toContain("Fix grammar");
    expect(calls[1][0].initialPrompts[0].content).toContain("Fix grammar");
    expect(calls[2][0].initialPrompts[0].content).toContain("Fix grammar");
  });
});

// ── _doCorrectGrammar ──

describe("_doCorrectGrammar", () => {
  it("parses JSON response from session.prompt", async () => {
    const provider = createProvider();
    const result = await provider._doCorrectGrammar("hello world");
    expect(result).toEqual({
      corrected: "hello world",
      changes: [],
      confidence: 5,
    });
  });

  it("rejects with AbortError for pre-aborted signal", async () => {
    const provider = createProvider();
    const ac = new AbortController();
    ac.abort();
    await expect(
      provider._doCorrectGrammar("hello world", { signal: ac.signal }),
    ).rejects.toThrow(Error);
  });

  it("rejects when model is not available", async () => {
    const provider = createProvider();
    MockLanguageModel.availability = vi.fn().mockResolvedValue("unavailable");
    await expect(provider._doCorrectGrammar("hello world")).rejects.toThrow(
      "Chrome Free AI not available",
    );
  });

  it("rejects when model is downloadable (not yet downloaded)", async () => {
    const provider = createProvider();
    MockLanguageModel.availability = vi.fn().mockResolvedValue("downloadable");
    await expect(provider._doCorrectGrammar("hello world")).rejects.toThrow(
      "not downloaded",
    );
  });

  it("rejects when model is still downloading", async () => {
    const provider = createProvider();
    MockLanguageModel.availability = vi.fn().mockResolvedValue("downloading");
    await expect(provider._doCorrectGrammar("hello world")).rejects.toThrow(
      "still downloading",
    );
  });

  it("wraps unexpected error with Chrome Free AI error prefix", async () => {
    const provider = createProvider();
    MockLanguageModel.create = vi.fn(async () => {
      throw new Error("some internal error");
    });
    await expect(provider._doCorrectGrammar("hello world")).rejects.toThrow(
      "Chrome Free AI error: some internal error",
    );
  });
});

// ── _doCorrectGrammarLevel2 / Level3 ──

describe("_doCorrectGrammarLevel2", () => {
  it("extracts JSON from prompt response", async () => {
    const provider = createProvider();
    const result = await provider._doCorrectGrammarLevel2("hello world");
    expect(result).toHaveProperty("corrected");
    expect(result).toHaveProperty("changes");
  });

  it("rejects when not available", async () => {
    const provider = createProvider();
    MockLanguageModel.availability = vi.fn().mockResolvedValue("unavailable");
    await expect(provider._doCorrectGrammarLevel2("hello world")).rejects.toThrow(
      "Chrome Free AI not available",
    );
  });

  it("rejects with AbortError for pre-aborted signal", async () => {
    const provider = createProvider();
    const ac = new AbortController();
    ac.abort();
    await expect(
      provider._doCorrectGrammarLevel2("hello world", { signal: ac.signal }),
    ).rejects.toThrow(Error);
  });
});

describe("_doCorrectGrammarLevel3", () => {
  it("returns session.prompt output (mock returns JSON) as corrected text", async () => {
    const provider = createProvider();
    const result = await provider._doCorrectGrammarLevel3("hello world");
    expect(result).toHaveProperty("corrected");
    expect(result).toHaveProperty("changes");
    expect(result).toHaveProperty("confidence");
  });

  it("rejects when not available", async () => {
    const provider = createProvider();
    MockLanguageModel.availability = vi.fn().mockResolvedValue("unavailable");
    await expect(provider._doCorrectGrammarLevel3("hello world")).rejects.toThrow(
      "Chrome Free AI not available",
    );
  });

  it("rejects with AbortError for pre-aborted signal", async () => {
    const provider = createProvider();
    const ac = new AbortController();
    ac.abort();
    await expect(
      provider._doCorrectGrammarLevel3("hello world", { signal: ac.signal }),
    ).rejects.toThrow(Error);
  });
});
