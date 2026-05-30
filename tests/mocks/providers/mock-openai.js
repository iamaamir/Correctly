import { startMockProviderServer } from "../server/mock-provider-server.js";

const presets = {
  happyPath: {
    models: [{ id: "mock-model-a" }, { id: "mock-model-b" }],
    chatCompletions: [{ type: "success" }],
  },
  schemaRejectThenFallback: {
    models: [{ id: "mock-model-a" }],
    chatCompletions: [
      {
        type: "error",
        status: 400,
        body: { error: { message: "invalid response_format json_schema", type: "invalid_request_error" } },
      },
      { type: "success" },
    ],
  },
  malformedJsonThenRecover: {
    models: [{ id: "mock-model-a" }],
    chatCompletions: [
      { type: "success", body: { id: "x", model: "mock-model-a", choices: [{ message: { content: "not json" } }], usage: { total_tokens: 2 } } },
      { type: "success" },
    ],
  },
  rateLimitThenSuccess: {
    models: [{ id: "mock-model-a" }],
    chatCompletions: [
      { type: "error", status: 429, body: { error: { message: "rate limit" } } },
      { type: "success" },
    ],
  },
  timeoutThenSuccess: {
    models: [{ id: "mock-model-a" }],
    chatCompletions: [{ type: "error", status: 504, body: { error: { message: "timeout" } } }, { type: "success" }],
  },
};

export async function createMockOpenAI({ preset = "happyPath", overrides = {} } = {}) {
  const base = presets[preset];
  if (!base) throw new Error(`unknown mockOpenAI preset: ${preset}`);
  const scenario = {
    ...base,
    ...overrides,
    models: overrides.models || base.models,
    chatCompletions: overrides.chatCompletions || base.chatCompletions,
  };
  const server = await startMockProviderServer({ scenario });
  return {
    ...server,
    preset,
    scenario,
  };
}

export function getMockOpenAIPresets() {
  return Object.keys(presets);
}
