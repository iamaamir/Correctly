import { test } from "@playwright/test";
import { HOST, assert, cleanupContext, launchExtensionContext, startFixtureServer } from "./helpers.js";

test("A1-A4 and C1-C4", async () => {
  const fixture = await startFixtureServer();
  const { context, extensionId, userDataDir } = await launchExtensionContext();

  try {
    const page = context.pages()[0] || (await context.newPage());

    // A2
    await page.goto(`http://${HOST}:${fixture.port}/tests/e2e/fixtures/editor.html?correctly_test=1`, { waitUntil: "load" });
    await page.waitForSelector("#editor", { timeout: 10000 });
    await page.waitForSelector("html[data-correctly-content-script='1']", { timeout: 10000 });

    // A3/A4
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: "load" });
    await popup.waitForFunction(() => document.querySelectorAll("#provider-select option").length > 0, undefined, {
      timeout: 10000,
    });
    const providerIds = await popup.$$eval("#provider-select option", (opts) => opts.map((o) => o.value));
    for (const id of ["openai", "chrome-free-ai", "ollama", "lmstudio", "openai-compatible"]) {
      assert(providerIds.includes(id), `missing provider option: ${id}`);
    }

    // C1
    await page.evaluate(() => {
      const root = document.documentElement;
      root.setAttribute("data-correctly-test-mode", "1");
      root.setAttribute("data-correctly-test-check-count", "0");
    });
    const editor = page.locator("#editor");
    await editor.click();
    await editor.fill("hello world one");
    await page.waitForTimeout(300);
    await editor.fill("hello world two");
    await page.waitForTimeout(300);
    await editor.fill("hello world three final");
    await page.waitForTimeout(1800);
    const c1 = await page.evaluate(() => ({
      count: Number(document.documentElement.getAttribute("data-correctly-test-check-count") || "0"),
      last: document.documentElement.getAttribute("data-correctly-test-last-text") || "",
    }));
    assert(c1.count === 1, `expected 1 check, got ${c1.count}`);
    assert(c1.last === "hello world three final", `expected latest text, got ${c1.last}`);

    // C3
    await page.evaluate(() => {
      const root = document.documentElement;
      root.setAttribute("data-correctly-test-check-count", "0");
      root.removeAttribute("data-correctly-test-responses");
    });
    await editor.fill("short");
    await page.waitForTimeout(1800);
    const c3 = await page.evaluate(() => Number(document.documentElement.getAttribute("data-correctly-test-check-count") || "0"));
    assert(c3 === 0, `expected 0 checks for short text, got ${c3}`);
  } finally {
    await cleanupContext(context, userDataDir);
    await new Promise((r) => fixture.server.close(r));
  }
});
