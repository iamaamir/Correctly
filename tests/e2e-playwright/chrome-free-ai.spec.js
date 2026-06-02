import { test } from "@playwright/test";
import { assert } from "../mocks/server/assertions.js";
import { cleanupContext, HOST, launchExtensionContext, startFixtureServer } from "./helpers.js";

/**
 * Inject a mock `LanguageModel` into the extension's service worker so that
 * ChromeFreeAIProvider thinks the Prompt API is available. The mock tracks
 * all created/cloned/destroyed sessions so we can verify lifecycle metrics.
 *
 * @param {import("playwright").Worker} sw
 * @param {object} [opts] — configuration
 * @param {number} [opts.slowPromptDelay=3000] — delay for the first N prompt calls (ms)
 * @param {number} [opts.fastPromptDelay=100] — delay for subsequent prompt calls (ms)
 * @param {number} [opts.slowPromptCount=1] — number of prompt calls to give the slow delay
 */
async function injectMockLanguageModel(sw, opts = {}) {
  const slowPromptDelay = opts.slowPromptDelay ?? 3000;
  const fastPromptDelay = opts.fastPromptDelay ?? 100;
  const slowPromptCount = opts.slowPromptCount ?? 1;
  await sw.evaluate(
    ({ slowPromptDelay, fastPromptDelay, slowPromptCount }) => {
      let sessionCounter = 0;
      let promptCallCount = 0;
      const allSessions = [];

      const metrics = {
        createCount: 0,
        cloneCount: 0,
        destroyCount: 0,
        promptCount: 0,
        reuseCount: 0,
        abortCount: 0,
      };

      class MockSession {
        constructor(config, baseId) {
          this.config = config;
          this.id = baseId || `session-${++sessionCounter}`;
          this.isClone = !!baseId;
          this.destroyed = false;
          this.promptCalls = 0;
          allSessions.push(this);
        }
        get contextWindow() {
          return 4096;
        }
        get contextUsage() {
          return 0;
        }
        async prompt(_text, options = {}) {
          this.promptCalls++;
          metrics.promptCount++;
          if (options.signal?.aborted) {
            metrics.abortCount++;
            throw new DOMException("The operation was aborted", "AbortError");
          }
          // First N prompt calls are slow so subsequent typing can cancel them
          promptCallCount++;
          const delay = promptCallCount <= slowPromptCount ? slowPromptDelay : fastPromptDelay;
          // Use AbortSignal's abort event for immediate cancellation
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, delay);
            if (options.signal) {
              const onAbort = () => {
                clearTimeout(timer);
                metrics.abortCount++;
                reject(new DOMException("The operation was aborted", "AbortError"));
              };
              options.signal.addEventListener("abort", onAbort, { once: true });
            }
          });
          if (options.signal?.aborted) {
            metrics.abortCount++;
            throw new DOMException("The operation was aborted", "AbortError");
          }
          return JSON.stringify({
            corrected: "this is the correct text",
            changes: [
              { original: "teh", replacement: "the", explanation: "spelling fix" },
            ],
            confidence: 9,
          });
        }
        async clone() {
          if (this.destroyed) throw new Error("clone on destroyed session");
          const c = new MockSession(this.config, `${this.id}.clone`);
          metrics.cloneCount++;
          return c;
        }
        destroy() {
          if (!this.destroyed) {
            this.destroyed = true;
            metrics.destroyCount++;
          }
        }
      }

      globalThis.LanguageModel = {
        availability: () => Promise.resolve("readily"),
        create: (_config) => {
          metrics.createCount++;
          return Promise.resolve(new MockSession());
        },
      };

      globalThis.__chromeFreeAiMetrics = metrics;
      globalThis.__chromeFreeAiSessions = allSessions;
    },
    { slowPromptDelay, fastPromptDelay, slowPromptCount },
  );
}

test.describe("Chrome Free AI provider", () => {
  test("E2E-CFAI-001 provider listed in popup dropdown", async () => {
    const { context, extensionId, userDataDir } = await launchExtensionContext();
    try {
      await injectMockLanguageModel(context.serviceWorkers()[0]);

      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: "load" });
      await popup.waitForFunction(() => document.querySelectorAll("#provider-select option").length > 0, undefined, {
        timeout: 10000,
      });
      const providerIds = await popup.$$eval("#provider-select option", (opts) => opts.map((o) => o.value));
      assert(providerIds.includes("chrome-free-ai"), "chrome-free-ai not in provider list");
    } finally {
      await cleanupContext(context, userDataDir).catch(() => {});
    }
  });

  test("E2E-CFAI-002 selects Chrome Free AI and shows AI status section", async () => {
    const { context, extensionId, userDataDir } = await launchExtensionContext();
    try {
      await injectMockLanguageModel(context.serviceWorkers()[0]);

      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: "load" });
      await popup.waitForSelector("#provider-select", { timeout: 10000 });

      await popup.selectOption("#provider-select", "chrome-free-ai");
      await popup.waitForTimeout(500);

      const aiStatusVisible = await popup.locator("#ai-status-section").isVisible();
      assert(aiStatusVisible, "AI status section should be visible for Chrome Free AI");

      const statusContent = await popup.locator("#ai-status-content").innerText();
      assert(statusContent.length > 0, "AI status content should not be empty");
    } finally {
      await cleanupContext(context, userDataDir).catch(() => {});
    }
  });

  test("E2E-CFAI-003 saves Chrome Free AI without API key", async () => {
    const { context, extensionId, userDataDir } = await launchExtensionContext();
    try {
      await injectMockLanguageModel(context.serviceWorkers()[0]);

      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: "load" });
      await popup.waitForSelector("#provider-select", { timeout: 10000 });

      await popup.selectOption("#provider-select", "chrome-free-ai");
      await popup.waitForTimeout(500);

      await popup.click("#save-btn");
      await popup.waitForSelector("#status-msg:not([hidden])", { timeout: 10000 });
      const statusText = await popup.locator("#status-msg").innerText();
      assert(statusText.length > 0, "expected a status message after save");
    } finally {
      await cleanupContext(context, userDataDir).catch(() => {});
    }
  });

  test("E2E-CFAI-004 runs grammar check using mocked LanguageModel", async () => {
    const fixture = await startFixtureServer();
    const { context, extensionId, userDataDir } = await launchExtensionContext();
    try {
      const sw = context.serviceWorkers()[0];
      await injectMockLanguageModel(sw);

      await sw.evaluate(async () => {
        await chrome.storage.local.set({
          providerId: "chrome-free-ai",
          apiKey: "noapikeyrequired",
          model: "chrome-free-ai",
          baseUrl: "",
          enabled: true,
          disabledSites: [],
        });
      });

      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: "load" });
      await popup.waitForSelector("#provider-select", { timeout: 10000 });
      await popup.selectOption("#provider-select", "chrome-free-ai");
      await popup.waitForTimeout(300);

      const page = await context.newPage();
      await page.goto(`http://${HOST}:${fixture.port}/tests/e2e/fixtures/editor.html`, { waitUntil: "load" });
      const editor = page.locator("#editor");
      await editor.fill("this is teh sample text");

      await page.waitForSelector(".correctly-tooltip.correctly-visible", { timeout: 15000 });
      const tooltipText = await page.locator(".correctly-tooltip").innerText();
      assert(tooltipText.includes("the"), "tooltip should show replacement suggestion");

      await page.click(".correctly-accept");

      await page.waitForFunction(
        () => (document.querySelector("#editor")?.value || "").includes("this is the correct text"),
        undefined,
        { timeout: 10000 },
      );

      const metrics = await sw.evaluate(() => globalThis.__chromeFreeAiMetrics);
      assert(metrics, "session metrics should exist");
      assert(metrics.createCount >= 1, `expected at least 1 session create, got ${metrics.createCount}`);
    } finally {
      await cleanupContext(context, userDataDir).catch(() => {});
      await new Promise((r) => fixture.server.close(r));
    }
  });

  test("E2E-CFAI-005 interleaved typing cancels in-flight check and uses new clone", async () => {
    const fixture = await startFixtureServer();
    const { context, extensionId, userDataDir } = await launchExtensionContext();
    try {
      const sw = context.serviceWorkers()[0];
      // First prompt is slow (2s) so it's still in-flight when we type again
      await injectMockLanguageModel(sw, {
        slowPromptDelay: 2000,
        fastPromptDelay: 100,
        slowPromptCount: 1,
      });

      // Store Chrome Free AI settings
      await sw.evaluate(async () => {
        await chrome.storage.local.set({
          providerId: "chrome-free-ai",
          apiKey: "noapikeyrequired",
          model: "chrome-free-ai",
          baseUrl: "",
          enabled: true,
          disabledSites: [],
        });
      });

      // Open popup once to verify it works
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: "load" });
      await popup.waitForSelector("#provider-select", { timeout: 10000 });
      await popup.selectOption("#provider-select", "chrome-free-ai");
      await popup.waitForTimeout(300);

      const page = await context.newPage();
      await page.goto(`http://${HOST}:${fixture.port}/tests/e2e/fixtures/editor.html`, { waitUntil: "load" });
      const editor = page.locator("#editor");

      // First fill: triggers debounce → grammar check → slow mock prompt (5s)
      await editor.fill("this is text with a first mistake");
      // Wait for the debounce to fire and the first grammar check to start
      // Content script debounce is 1500ms, wait 1800ms for safety
      await page.waitForTimeout(1800);

      // Second fill: new text → debounce → sends CHECK_GRAMMAR
      // Grammar handler aborts the first in-flight check and starts a new one
      await editor.fill("this is text with a second issue");
      // Second check's mock prompt is fast (100ms), tooltip should appear within seconds
      await page.waitForSelector(".correctly-tooltip.correctly-visible", { timeout: 15000 });

      const tooltipText = await page.locator(".correctly-tooltip").innerText();
      assert(tooltipText.includes("the"), "tooltip should show replacement suggestion");

      // Verify session lifecycle metrics from the mock
      const metrics = await sw.evaluate(() => globalThis.__chromeFreeAiMetrics);
      assert(metrics, "session metrics should exist");
      assert(metrics.createCount >= 1, `expected at least 1 base session create, got ${metrics.createCount}`);
      assert(metrics.abortCount >= 1, `expected at least 1 abort, got ${metrics.abortCount}`);
      // Second check should have run a prompt that completed
      assert(metrics.promptCount >= 2, `expected at least 2 prompt calls, got ${metrics.promptCount}`);
      // Base session should have been reused (clone-per-check)
      assert(metrics.cloneCount >= 2, `expected at least 2 clones, got ${metrics.cloneCount}`);

      // Clean up — apply the correction so the tooltip goes away
      await page.click(".correctly-accept").catch(() => {});
    } finally {
      await cleanupContext(context, userDataDir).catch(() => {});
      await new Promise((r) => fixture.server.close(r));
    }
  });

  test("E2E-CFAI-006 rapid-fire typing cancels multiple in-flight checks", async () => {
    const fixture = await startFixtureServer();
    const { context, extensionId, userDataDir } = await launchExtensionContext();
    try {
      const sw = context.serviceWorkers()[0];
      // First 4 prompts are slow so each round cancels the prior in-flight check
      await injectMockLanguageModel(sw, {
        slowPromptDelay: 5000,
        fastPromptDelay: 100,
        slowPromptCount: 4,
      });

      await sw.evaluate(async () => {
        await chrome.storage.local.set({
          providerId: "chrome-free-ai",
          apiKey: "noapikeyrequired",
          model: "chrome-free-ai",
          baseUrl: "",
          enabled: true,
          disabledSites: [],
        });
      });

      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: "load" });
      await popup.waitForSelector("#provider-select", { timeout: 10000 });
      await popup.selectOption("#provider-select", "chrome-free-ai");
      await popup.waitForTimeout(300);

      const page = await context.newPage();
      await page.goto(`http://${HOST}:${fixture.port}/tests/e2e/fixtures/editor.html`, { waitUntil: "load" });
      const editor = page.locator("#editor");

      // Five rapid-fire fill rounds. Each fill triggers the 1500ms debounce.
      // Round 1: fill → debounce → CHECK_GRAMMAR starts (slow prompt)
      // Round 2-4: fill → debounce → cancels prior → starts new slow prompt
      // Round 5: fill → debounce → cancels prior → starts fast prompt → tooltip
      const texts = [
        "first draft with mistakes",
        "second draft with errors",
        "third draft with typos",
        "fourth draft with bugs",
        "final draft with glitch",
      ];

      for (let i = 0; i < texts.length; i++) {
        await editor.fill(texts[i]);
        // Wait for the 1500ms debounce + small margin so the CHECK_GRAMMAR fires
        // before we send the next input
        await page.waitForTimeout(1700);
      }

      // The last round's prompt is fast (100ms), tooltip appears shortly after
      await page.waitForSelector(".correctly-tooltip.correctly-visible", { timeout: 15000 });
      const tooltipText = await page.locator(".correctly-tooltip").innerText();
      assert(tooltipText.includes("the"), "tooltip should show replacement suggestion");

      // Verify session lifecycle metrics from the mock
      const metrics = await sw.evaluate(() => globalThis.__chromeFreeAiMetrics);
      assert(metrics, "session metrics should exist");
      assert(metrics.createCount >= 1, `expected at least 1 base session create, got ${metrics.createCount}`);
      // First 4 checks were cancelled by the next round
      assert(metrics.abortCount >= 4, `expected at least 4 aborts, got ${metrics.abortCount}`);
      // 5 total prompt calls (one per round)
      assert(metrics.promptCount >= 5, `expected at least 5 prompt calls, got ${metrics.promptCount}`);
      // 5 clones (one per round, clone-per-check)
      assert(metrics.cloneCount >= 5, `expected at least 5 clones, got ${metrics.cloneCount}`);

      await page.click(".correctly-accept").catch(() => {});
    } finally {
      await cleanupContext(context, userDataDir).catch(() => {});
      await new Promise((r) => fixture.server.close(r));
    }
  });
});
