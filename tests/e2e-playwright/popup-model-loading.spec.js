import { test } from "@playwright/test";
import { createMockOpenAI } from "../mocks/providers/mock-openai.js";
import { configureOpenAICompatibleViaPopup } from "../mocks/providers/setup.js";
import { assert } from "../mocks/server/assertions.js";
import { cleanupContext, launchExtensionContext } from "./helpers.js";

test("popup async model loading + save", async () => {
  const mock = await createMockOpenAI({ preset: "happyPath" });
  const { context, sw, extensionId, userDataDir } = await launchExtensionContext();
  try {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: "load" });
    await configureOpenAICompatibleViaPopup({
      popup,
      baseUrl: mock.baseUrl,
      apiKey: "test-key",
      model: "mock-model-a",
    });
    const modelValues = await popup.$$eval("#model-select option", (opts) => opts.map((o) => o.value));
    assert(modelValues.includes("mock-model-a"), "mock-model-a not loaded");
    await popup.waitForFunction(() => {
      const el = document.getElementById("status-msg");
      return el && !el.hidden && el.textContent === "Settings saved";
    }, { timeout: 5000 });
    const saved = await sw.evaluate(async () => chrome.storage.local.get(["providerId", "model", "baseUrl"]));
    assert(saved.providerId === "openai-compatible", `unexpected providerId ${saved.providerId}`);
    assert(saved.model === "mock-model-a", `unexpected model ${saved.model}`);
  } finally {
    await cleanupContext(context, userDataDir);
    await mock.close();
  }
});
