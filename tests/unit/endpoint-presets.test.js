import { describe, expect, it } from "vitest";
import { KNOWN_ENDPOINT_PRESETS, mergeEndpointSuggestions } from "../../popup/endpoint-presets.js";

describe("endpoint presets", () => {
  it("lists only third-party services (no in-house providers)", () => {
    const urls = KNOWN_ENDPOINT_PRESETS.map((p) => p.url);
    expect(urls).not.toContain("https://api.openai.com/v1");
    expect(urls).not.toContain("http://localhost:11434/v1");
    expect(urls).not.toContain("http://localhost:1234/v1");
    for (const p of KNOWN_ENDPOINT_PRESETS) {
      expect(p.name, `preset missing name: ${p.url}`).toBeTruthy();
      expect(p.url.startsWith("https://"), `preset not https: ${p.url}`).toBe(true);
    }
  });

  it("puts presets first, then saved URLs", () => {
    const merged = mergeEndpointSuggestions(KNOWN_ENDPOINT_PRESETS, ["https://example.com/v1"]);
    expect(merged[0]).toEqual(KNOWN_ENDPOINT_PRESETS[0]);
    expect(merged.at(-1)).toEqual({ url: "https://example.com/v1" });
  });

  it("dedupes exact and trailing-slash variants of saved URLs", () => {
    const preset = KNOWN_ENDPOINT_PRESETS[0].url;
    const merged = mergeEndpointSuggestions(KNOWN_ENDPOINT_PRESETS, [preset, `${preset}/`, "  "]);
    const matches = merged.filter((m) => m.url === preset || m.url === `${preset}/`);
    expect(matches).toHaveLength(1);
    expect(merged.every((m) => m.url.trim() !== "")).toBe(true);
  });

  it("respects the limit", () => {
    const saved = Array.from({ length: 50 }, (_, i) => `https://example-${i}.com/v1`);
    const merged = mergeEndpointSuggestions(KNOWN_ENDPOINT_PRESETS, saved, 10);
    expect(merged).toHaveLength(10);
  });
});
