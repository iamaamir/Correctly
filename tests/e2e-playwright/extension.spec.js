import { chromium } from "playwright";
import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";

const HOST = "127.0.0.1";
const extensionPath = path.resolve(".");

async function startFixtureServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const reqPath = decodeURIComponent(url.pathname === "/" ? "/tests/e2e/fixtures/editor.html" : url.pathname);
    const abs = path.resolve(`.${reqPath}`);
    try {
      const html = await fs.readFile(abs, "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end(`not found: ${reqPath}`);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, () => resolve());
  });

  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { server, port };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const { server, port } = await startFixtureServer();
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "correctly-pw-"));

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    const bg = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker", { timeout: 15000 }));
    const swUrl = bg.url();
    const extensionId = new URL(swUrl).host;
    assert(extensionId, "extension id not found from service worker");

    const page = context.pages()[0] || (await context.newPage());
    await page.goto(`http://${HOST}:${port}/tests/e2e/fixtures/editor.html`, { waitUntil: "load" });
    await page.waitForSelector("#editor", { timeout: 10000 });
    await page.waitForSelector("html[data-correctly-content-script='1']", { timeout: 10000 });

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: "load" });
    await popup.waitForFunction(
      () => document.querySelectorAll("#provider-select option").length > 0,
      undefined,
      { timeout: 10000 },
    );

    const providerOptions = await popup.$$eval("#provider-select option", (opts) =>
      opts.map((o) => ({ value: o.value, label: o.textContent?.trim() || "" })),
    );

    const providerIds = providerOptions.map((o) => o.value);
    const expected = ["openai", "chrome-free-ai", "ollama", "lmstudio", "openai-compatible"];
    for (const id of expected) {
      assert(providerIds.includes(id), `missing provider option: ${id}`);
    }

    console.log("PASS: extension loaded, content injected, providers listed", {
      extensionId,
      providers: providerIds,
    });
  } finally {
    await context.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
