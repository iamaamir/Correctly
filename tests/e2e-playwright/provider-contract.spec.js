import { test } from "@playwright/test";
import { createMockOpenAI } from "../mocks/providers/mock-openai.js";
import { seedOpenAICompatibleViaServiceWorker } from "../mocks/providers/setup.js";
import { assert, assertCallCountAtLeast } from "../mocks/server/assertions.js";
import { cleanupContext, HOST, launchExtensionContext, startFixtureServer } from "./helpers.js";

test("E3 response_format fallback retries without schema and applies corrected text", async () => {
  const fixture = await startFixtureServer();
  const corrected = "this is the sample sentence for grammar check.";
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
                  content: `Here is the correction:

\`\`\`json
${JSON.stringify({
  corrected,
  changes: [
    { original: "teh", replacement: "the", explanation: "spelling" },
    { original: "", replacement: ".", explanation: "terminal punctuation" },
  ],
  confidence: 9,
})}
\`\`\``,
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
    assert(!tooltipText.includes("terminal punctuation"), "hidden punctuation change should not render");

    await page.click(".correctly-accept");
    await page.waitForFunction((expected) => document.querySelector("#editor")?.value === expected, corrected, {
      timeout: 10000,
    });

    assertCallCountAtLeast(mock.calls, 2, "chat/completions calls");
    assert(Boolean(mock.calls[0].body?.response_format), "first request should use response_format");
    assert(!mock.calls[1].body?.response_format, "fallback request should omit response_format");
  } finally {
    await cleanupContext(context, userDataDir).catch(() => {});
    await new Promise((r) => fixture.server.close(r));
    await mock.close();
  }
});

test("E2E-SCORING-003 schema unsupported then level 2 fenced JSON, cached on next check", async () => {
  const fixture = await startFixtureServer();
  const firstCorrected = "He went to school yesterday.";
  const secondCorrected = "She went home yesterday.";
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
            id: "l1-no-schema-prose",
            model: "mock",
            choices: [{ message: { content: "The corrected sentence is: He went to school yesterday." } }],
            usage: { total_tokens: 12 },
          },
        },
        {
          type: "success",
          body: {
            id: "l2-json",
            model: "mock",
            choices: [
              {
                message: {
                  content: `Reasoning complete.

\`\`\`json
${JSON.stringify({
  corrected: firstCorrected,
  changes: [{ original: "go", replacement: "went", explanation: "Use past tense for yesterday." }],
  confidence: 9,
})}
\`\`\``,
                },
              },
            ],
            usage: { total_tokens: 20 },
          },
        },
        {
          type: "success",
          body: {
            id: "cached-l2-json",
            model: "mock",
            choices: [
              {
                message: {
                  content: `\`\`\`json
${JSON.stringify({
  corrected: secondCorrected,
  changes: [{ original: "go", replacement: "went", explanation: "Use past tense for yesterday." }],
  confidence: 9,
})}
\`\`\``,
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
    const editor = page.locator("#editor");
    await editor.fill("He go to school yesterday.");
    await page.waitForSelector(".correctly-tooltip.correctly-visible", { timeout: 15000 });
    await page.click(".correctly-accept");
    await page.waitForFunction((expected) => document.querySelector("#editor")?.value === expected, firstCorrected, {
      timeout: 10000,
    });

    await editor.fill("She go home yesterday.");
    await page.waitForSelector(".correctly-tooltip.correctly-visible", { timeout: 15000 });
    await page.click(".correctly-accept");
    await page.waitForFunction((expected) => document.querySelector("#editor")?.value === expected, secondCorrected, {
      timeout: 10000,
    });

    assertCallCountAtLeast(mock.calls, 4, "chat/completions calls");
    assert(Boolean(mock.calls[0].body?.response_format), "first request should use response_format");
    for (const index of [1, 2, 3]) {
      assert(!mock.calls[index].body?.response_format, `request ${index + 1} should omit response_format`);
    }
    assert(
      mock.calls[2].body.messages?.[0]?.content.includes("Think through the text step by step"),
      "third request should use Level 2 prompt",
    );
    assert(
      mock.calls[3].body.messages?.[0]?.content.includes("Think through the text step by step"),
      "second check should start at cached Level 2",
    );
  } finally {
    await cleanupContext(context, userDataDir).catch(() => {});
    await new Promise((r) => fixture.server.close(r));
    await mock.close();
  }
});

test("E2E-SCORING-004 level 3 plain-text fallback applies full correction", async () => {
  const fixture = await startFixtureServer();
  const corrected = "He went to school yesterday.";
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
            id: "l1-no-schema-prose",
            model: "mock",
            choices: [{ message: { content: "I can correct this, but not as JSON." } }],
            usage: { total_tokens: 8 },
          },
        },
        {
          type: "success",
          body: {
            id: "l2-prose",
            model: "mock",
            choices: [{ message: { content: "Corrected sentence: He went to school yesterday." } }],
            usage: { total_tokens: 10 },
          },
        },
        {
          type: "success",
          body: {
            id: "l3-text",
            model: "mock",
            choices: [{ message: { content: corrected } }],
            usage: { total_tokens: 10 },
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
    await page.locator("#editor").fill("He go to school yesterday.");
    await page.waitForSelector(".correctly-tooltip.correctly-visible", { timeout: 15000 });
    const oneClickVisible = await page
      .locator(".correctly-accept-one")
      .isVisible()
      .catch(() => false);
    assert(!oneClickVisible, "Level 3 full-text fallback should not show individual change buttons");

    await page.click(".correctly-accept");
    await page.waitForFunction((expected) => document.querySelector("#editor")?.value === expected, corrected, {
      timeout: 10000,
    });

    assertCallCountAtLeast(mock.calls, 4, "chat/completions calls");
    assert(Boolean(mock.calls[0].body?.response_format), "first request should use response_format");
    for (const index of [1, 2, 3]) {
      assert(!mock.calls[index].body?.response_format, `request ${index + 1} should omit response_format`);
    }
    assert(
      mock.calls[3].body.messages?.[0]?.content.includes("Return ONLY the corrected text"),
      "final request should use Level 3 plain-text prompt",
    );
  } finally {
    await cleanupContext(context, userDataDir).catch(() => {});
    await new Promise((r) => fixture.server.close(r));
    await mock.close();
  }
});
