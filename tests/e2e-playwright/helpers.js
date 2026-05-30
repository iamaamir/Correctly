import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

export const HOST = "127.0.0.1";
const extensionPath = path.resolve(".");

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function startFixtureServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const reqPath = decodeURIComponent(url.pathname === "/" ? "/tests/e2e/fixtures/editor.html" : url.pathname);
    const abs = path.resolve(`.${reqPath}`);
    try {
      const html = await fs.readFile(abs, "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, resolve);
  });
  const addr = server.address();
  return { server, port: typeof addr === "object" && addr ? addr.port : 0 };
}

export async function launchExtensionContext() {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "correctly-pw-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: process.env.PW_HEADLESS !== "0",
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  const timeoutMs = Number(process.env.PW_EXTENSION_SW_TIMEOUT_MS || "60000");
  const deadline = Date.now() + timeoutMs;
  let sw = context.serviceWorkers()[0];

  while (!sw && Date.now() < deadline) {
    try {
      sw = await context.waitForEvent("serviceworker", { timeout: 2000 });
    } catch {
      sw = context.serviceWorkers()[0];
    }
  }

  if (!sw) {
    throw new Error(`Extension service worker did not load within ${timeoutMs}ms`);
  }

  const extensionId = new URL(sw.url()).host;
  return { context, sw, extensionId, userDataDir };
}

export async function cleanupContext(context, userDataDir) {
  await context.close();
  await fs.rm(userDataDir, { recursive: true, force: true });
}
