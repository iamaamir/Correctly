import { sanitizeBaseUrl } from "../lib/url-utils.js";

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

/**
 * Merge curated presets with the user's saved URLs for the datalist.
 * Presets come first; duplicates (including trailing-slash variants, which
 * sanitizeBaseUrl normalizes) and blanks are dropped.
 * @param {Array<{name?: string, url: string}>} presets
 * @param {Array<string>} savedUrls
 * @param {number} [limit]
 * @returns {Array<{name?: string, url: string}>}
 */
export function mergeEndpointSuggestions(presets, savedUrls, limit = 30) {
  const seen = new Set();
  const merged = [];
  const entries = [...presets, ...savedUrls.map((url) => ({ url }))];
  for (const entry of entries) {
    // Compare slash-insensitively: URL.toString() keeps non-root paths as-is,
    // while saved URLs may carry a trailing slash.
    const key = (sanitizeBaseUrl(entry.url) || (entry.url || "").trim()).replace(/\/+$/, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
    if (merged.length >= limit) break;
  }
  return merged;
}
