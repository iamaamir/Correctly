/**
 * Curated OpenAI-compatible endpoints for the Base URL autocomplete.
 *
 * Only third-party services are listed here — OpenAI, Ollama, and LM Studio
 * have dedicated providers in the provider dropdown and are intentionally
 * excluded.
 *
 * Base URLs take the `/chat/completions` and `/models` paths appended
 * (see GenericOpenAIProvider / FETCH_MODELS).
 */
export const KNOWN_ENDPOINT_PRESETS = [
  { name: "OpenRouter", url: "https://openrouter.ai/api/v1" },
  { name: "Groq", url: "https://api.groq.com/openai/v1" },
  { name: "Together AI", url: "https://api.together.xyz/v1" },
  { name: "Fireworks AI", url: "https://api.fireworks.ai/inference/v1" },
  { name: "DeepSeek", url: "https://api.deepseek.com/v1" },
  { name: "xAI", url: "https://api.x.ai/v1" },
  { name: "Mistral", url: "https://api.mistral.ai/v1" },
  { name: "Google AI Studio", url: "https://generativelanguage.googleapis.com/v1beta/openai" },
];
