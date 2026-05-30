import { test } from "@playwright/test";
import { createMockOpenAI } from "../mocks/providers/mock-openai.js";
import { configureOpenAICompatibleViaPopup } from "../mocks/providers/setup.js";
import { assert } from "../mocks/server/assertions.js";
import { cleanupContext, HOST, launchExtensionContext, startFixtureServer } from "./helpers.js";

test("E2E-BOOT-001 extension boot + popup providers", async () => {
  const fixture = await startFixtureServer();
  const { context, extensionId, userDataDir } = await launchExtensionContext();
  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(`http://${HOST}:${fixture.port}/tests/e2e/fixtures/editor.html`, { waitUntil: "load" });
    await page.waitForSelector("#editor", { timeout: 10000 });
    await page.waitForSelector("html[data-correctly-content-script='1']", { timeout: 10000 });

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: "load" });
    await popup.waitForFunction(() => document.querySelectorAll("#provider-select option").length > 0, undefined, {
      timeout: 10000,
    });
    const providerIds = await popup.$$eval("#provider-select option", (opts) => opts.map((o) => o.value));
    for (const id of ["openai", "chrome-free-ai", "ollama", "lmstudio", "openai-compatible"]) {
      assert(providerIds.includes(id), `missing provider option: ${id}`);
    }
  } finally {
    await cleanupContext(context, userDataDir).catch(() => {});
    await new Promise((r) => fixture.server.close(r));
  }
});

test("E2E-CONTENT-001/002 popup config -> tooltip -> apply correction", async () => {
  const fixture = await startFixtureServer();
  const mock = await createMockOpenAI({
    preset: "happyPath",
    overrides: {
      models: [{ id: "mock-model-a" }],
      chatCompletions: [
        {
          type: "success",
          body: {
            id: "x",
            model: "mock-model-a",
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    corrected: "this is the sample text",
                    changes: [{ original: "teh", replacement: "the", explanation: "spelling" }],
                    confidence: 9,
                  }),
                },
              },
            ],
            usage: { total_tokens: 12 },
          },
        },
      ],
    },
  });
  const { context, extensionId, userDataDir } = await launchExtensionContext();
  try {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: "load" });
    await configureOpenAICompatibleViaPopup({
      popup,
      baseUrl: mock.baseUrl,
      apiKey: "test-key",
      model: "mock-model-a",
    });

    const page = await context.newPage();
    await page.goto(`http://${HOST}:${fixture.port}/tests/e2e/fixtures/editor.html`, { waitUntil: "load" });
    const editor = page.locator("#editor");
    await editor.fill("this is teh sample text");
    await page.waitForSelector(".correctly-tooltip.correctly-visible", { timeout: 15000 });
    const tooltipText = await page.locator(".correctly-tooltip").innerText();
    assert(tooltipText.includes("the"), "missing replacement in tooltip");

    const applyAllVisible = await page
      .locator(".correctly-accept")
      .isVisible()
      .catch(() => false);
    if (applyAllVisible) {
      await page.click(".correctly-accept");
    } else {
      await page.click(".correctly-accept-one");
    }
    await page.waitForFunction(
      () => (document.querySelector("#editor")?.value || "").includes("the sample text"),
      undefined,
      { timeout: 10000 },
    );
  } finally {
    await cleanupContext(context, userDataDir).catch(() => {});
    await new Promise((r) => fixture.server.close(r));
    await mock.close();
  }
});
