import { test } from "@playwright/test";
import http from "node:http";
import { HOST, assert, cleanupContext, launchExtensionContext, startFixtureServer } from "./helpers.js";

async function startMockProviderServer() {
  let callCount = 0;
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/chat/completions") return res.writeHead(404).end("not found");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    callCount += 1;
    if (callCount === 1 && body.response_format) {
      return res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "invalid response_format json_schema" } }));
    }
    const userText = body.messages?.find((m) => m.role === "user")?.content || "";
    const fixed = userText.replace("teh", "the");
    const changes = userText.includes("teh") ? [{ original: "teh", replacement: "the", explanation: "spelling" }] : [];
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "x", model: "mock", choices: [{ message: { content: JSON.stringify({ corrected: fixed, changes, confidence: 9 }) } }], usage: { total_tokens: 20 } }));
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, HOST, resolve); });
  const addr = server.address();
  return { server, port: typeof addr === "object" && addr ? addr.port : 0, getCallCount: () => callCount };
}

test("E3 response_format fallback retries without schema", async () => {
  const fixture = await startFixtureServer();
  const mock = await startMockProviderServer();
  const { context, sw, userDataDir } = await launchExtensionContext();
  try {
    await sw.evaluate(async ({ baseUrl }) => {
      await chrome.storage.local.set({ providerId: "openai-compatible", apiKey: "test-key", model: "gpt-4o-mini", baseUrl, enabled: true, disabledSites: [] });
    }, { baseUrl: `http://${HOST}:${mock.port}` });

    const page = await context.newPage();
    await page.goto(`http://${HOST}:${fixture.port}/tests/e2e/fixtures/editor.html`, { waitUntil: "load" });
    await page.locator("#editor").fill("this is teh sample sentence for grammar check");
    await page.waitForSelector(".correctly-tooltip.correctly-visible", { timeout: 15000 });
    const tooltipText = await page.locator(".correctly-tooltip").innerText();
    assert(tooltipText.toLowerCase().includes("the"), "tooltip missing corrected token");
    assert(mock.getCallCount() >= 2, `expected fallback retry, calls=${mock.getCallCount()}`);
  } finally {
    await cleanupContext(context, userDataDir);
    await new Promise((r) => fixture.server.close(r));
    await new Promise((r) => mock.server.close(r));
  }
});
