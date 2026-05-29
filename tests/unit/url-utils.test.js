import { describe, expect, it } from "vitest";
import { sanitizeBaseUrl, validateBaseUrl } from "../../lib/url-utils.js";

describe("validateBaseUrl", () => {
  it("accepts https://api.example.com/v1", () => {
    const result = validateBaseUrl("https://api.example.com/v1");
    expect(result.valid).toBe(true);
    expect(result.xss).toBe(false);
    expect(result.sanitized).toBe("https://api.example.com/v1");
  });

  it("accepts http://localhost:11434", () => {
    const result = validateBaseUrl("http://localhost:11434");
    expect(result.valid).toBe(true);
    expect(result.xss).toBe(false);
    expect(result.sanitized).toBe("http://localhost:11434/");
  });

  it("rejects javascript: URLs", () => {
    const result = validateBaseUrl("javascript:alert(1)");
    expect(result.valid).toBe(false);
    expect(result.xss).toBe(true);
  });

  it("rejects data: URLs", () => {
    const result = validateBaseUrl("data:text/html,<script>alert(1)</script>");
    expect(result.valid).toBe(false);
    expect(result.xss).toBe(true);
  });

  it("rejects non-HTTP protocols", () => {
    const result = validateBaseUrl("ftp://files.example.com");
    expect(result.valid).toBe(false);
    expect(result.xss).toBe(false);
  });

  it("sanitizes trailing and whitespace-padded URLs", () => {
    const result = validateBaseUrl("  https://api.example.com/v1  ");
    expect(result.valid).toBe(true);
    expect(result.xss).toBe(false);
    expect(result.sanitized).toBe("https://api.example.com/v1");
  });
});

describe("sanitizeBaseUrl", () => {
  it("returns empty string for null/undefined", () => {
    expect(sanitizeBaseUrl(null)).toBe("");
    expect(sanitizeBaseUrl(undefined)).toBe("");
  });

  it("strips whitespace and returns normalized URL", () => {
    expect(sanitizeBaseUrl("  https://api.example.com/v1  ")).toBe("https://api.example.com/v1");
  });

  it("returns empty string for non-HTTP protocols", () => {
    expect(sanitizeBaseUrl("ftp://files.example.com")).toBe("");
  });
});
