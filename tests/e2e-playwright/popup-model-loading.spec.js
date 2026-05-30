import { test } from "@playwright/test";
import http from "node:http";
import { HOST, assert, cleanupContext, launchExtensionContext } from "./helpers.js";

async function startMockProviderServer() {
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/models") {
      return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "mock-model-a" }, { id: "mock-model-b" }] }));
    }
    if (req.method === "POST" && req.url === "/chat/completions") {
      return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "x", model: "mock-model-a", choices: [{ message: { content: JSON.stringify({ corrected: "ok", changes: [], confidence: 10 }) } }], usage: { total_tokens: 4 } }));
    }
    res.writeHead(404).end("not found");
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, HOST, resolve); });
  const addr = server.address();
  return { server, port: typeof addr === "object" && addr ? addr.port : 0 };
}

test("popup async model loading + save", async () => {
  const mock = await startMockProviderServer();
  const { context, sw, extensionId, userDataDir } = await launchExtensionContext();
  try {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`, { waitUntil: "load" });
    await popup.waitForSelector("#provider-select", { timeout: 10000 });
    await popup.selectOption("#provider-select", "openai-compatible");
    await popup.fill("#base-url", `http://${HOST}:${mock.port}`);
    await popup.fill("#api-key", "test-key");
    await popup.waitForFunction(() => Array.from(document.querySelectorAll("#model-select option")).some((o) => o.value === "mock-model-a"), undefined, { timeout: 15000 });
    const modelValues = await popup.$$eval("#model-select option", (opts) => opts.map((o) => o.value));
    assert(modelValues.includes("mock-model-a"), "mock-model-a not loaded");
    await popup.selectOption("#model-select", "mock-model-a");
    await popup.click("#save-btn");
    await popup.waitForTimeout(1200);
    const saved = await sw.evaluate(async () => chrome.storage.local.get(["providerId", "model", "baseUrl"]));
    assert(saved.providerId === "openai-compatible", `unexpected providerId ${saved.providerId}`);
    assert(saved.model === "mock-model-a", `unexpected model ${saved.model}`);
  } finally {
    await cleanupContext(context, userDataDir);
    await new Promise((r) => mock.server.close(r));
  }
});
