import { test } from "@playwright/test";
import { HOST, cleanupContext, launchExtensionContext, startFixtureServer } from "./helpers.js";
import { assert, assertCallCountAtLeast, assertAnyCall } from "../mocks/server/assertions.js";
import { createMockOpenAI } from "../mocks/providers/mock-openai.js";
import { seedOpenAICompatibleViaServiceWorker } from "../mocks/providers/setup.js";

test("E3 response_format fallback retries without schema", async () => {
  const fixture = await startFixtureServer();
  const mock = await createMockOpenAI({
    preset: "schemaRejectThenFallback",
    overrides: {
      chatCompletions: [
        {
          type: "error",
          status: 400,
          body: { error: { message: "invalid response_format json_schema", type: "invalid_request_error" } },
        },
        {
          type: "success",
          body: {
            id: "x",
            model: "mock",
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    corrected: "this is the sample sentence for grammar check",
                    changes: [{ original: "teh", replacement: "the", explanation: "spelling" }],
                    confidence: 9,
                  }),
                },
              },
            ],
            usage: { total_tokens: 20 },
          },
        },
      ],
    },
  });
  const { context, sw, userDataDir } = await launchExtensionContext();
  try {
    await seedOpenAICompatibleViaServiceWorker({
      sw,
      baseUrl: mock.baseUrl,
      apiKey: "test-key",
      model: "gpt-4o-mini",
    });

    const page = await context.newPage();
    await page.goto(`http://${HOST}:${fixture.port}/tests/e2e/fixtures/editor.html`, { waitUntil: "load" });
    await page.locator("#editor").fill("this is teh sample sentence for grammar check");
    await page.waitForSelector(".correctly-tooltip.correctly-visible", { timeout: 15000 });
    const tooltipText = await page.locator(".correctly-tooltip").innerText();
    assert(tooltipText.toLowerCase().includes("the"), "tooltip missing corrected token");
    assertCallCountAtLeast(mock.calls, 2, "chat/completions calls");
    assertAnyCall(
      mock.calls,
      (c) => Boolean(c.body?.response_format),
      "expected at least one structured output request with response_format",
    );
  } finally {
    await cleanupContext(context, userDataDir);
    await new Promise((r) => fixture.server.close(r));
    await mock.close();
  }
});
