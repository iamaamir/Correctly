export function extractJsonObject(text) {
  if (typeof text !== "string") throw new Error("Expected text to parse JSON object");

  const fence = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
  if (fence) return JSON.parse(fence[1].trim());

  const firstBrace = text.indexOf("{");
  if (firstBrace === -1) throw new Error("No JSON object found");

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = firstBrace; i < text.length; i++) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(firstBrace, i + 1));
    }
  }

  throw new Error("Unclosed JSON object");
}

export function safeJsonParseObject(text, fallback = null) {
  try {
    return extractJsonObject(text);
  } catch {
    return fallback;
  }
}
