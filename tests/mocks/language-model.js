/**
 * Mock `LanguageModel` (Chrome Prompt API) for unit tests and benchmarks.
 *
 * Tracks all created/cloned/destroyed sessions so tests can verify
 * session lifecycle behavior without running in a real browser.
 */

let sessionCounter = 0;
const allSessions = [];

class MockSession {
  constructor(config, baseId) {
    this.config = config;
    this.id = baseId || `session-${++sessionCounter}`;
    this.isClone = !!baseId;
    this.destroyed = false;
    this.promptCalls = 0;
    this.promptDelayMs = 50;
    allSessions.push(this);
  }

  get contextWindow() {
    return 4096;
  }
  get contextUsage() {
    return 0;
  }

  async prompt(text, options = {}) {
    this.promptCalls++;
    if (options.signal?.aborted) {
      throw new DOMException("The operation was aborted", "AbortError");
    }
    await new Promise((r) => setTimeout(r, this.promptDelayMs));
    if (options.signal?.aborted) {
      throw new DOMException("The operation was aborted", "AbortError");
    }
    return JSON.stringify({
      corrected: text,
      changes: [],
      confidence: 5,
    });
  }

  async clone() {
    if (this.destroyed) throw new Error("Cannot clone destroyed session");
    const clone = new MockSession(this.config, `${this.id}.clone`);
    return clone;
  }

  destroy() {
    this.destroyed = true;
  }
}

/** Mock replacing globalThis.LanguageModel */
export const MockLanguageModel = {
  availability() {
    return Promise.resolve("readily");
  },
  create(config) {
    return Promise.resolve(new MockSession(config));
  },
};

/**
 * Install mock as `globalThis.LanguageModel`.
 * Returns an uninstall function to restore the original.
 */
export function installMockLanguageModel() {
  const restore = globalThis.LanguageModel;
  globalThis.LanguageModel = MockLanguageModel;
  return () => {
    globalThis.LanguageModel = restore;
  };
}

/** Reset all tracked state between tests */
export function resetMockState() {
  sessionCounter = 0;
  allSessions.length = 0;
}

/** Read aggregate session lifecycle metrics from mock */
export function getSessionMetrics() {
  const alive = allSessions.filter((s) => !s.destroyed).length;
  const destroyed = allSessions.filter((s) => s.destroyed).length;
  const cloned = allSessions.filter((s) => s.isClone).length;
  const promptCalls = allSessions.reduce((sum, s) => sum + s.promptCalls, 0);

  return {
    totalCreated: allSessions.length,
    alive,
    destroyed,
    cloned,
    promptCalls,
  };
}

/** Set prompt latency for all mock sessions (default 50ms) */
export function setPromptDelay(ms) {
  for (const s of allSessions) s.promptDelayMs = ms;
}

/** Return the raw session list for deep inspection */
export function getMockSessions() {
  return allSessions;
}
