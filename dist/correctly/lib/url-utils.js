const XSS_PATTERNS = [
  /^javascript:/i,
  /^data:/i,
  /^vbscript:/i,
  /^file:/i,
  /</,
  /\bon\w+\s*=/i,
  /&#/i,
  /%3C/i,
  /\\x/i,
  /alert\(/i,
  /<script/i,
];

const FUNNY_MSGS = [
  "Nice try, hacker boy. 👨‍💻",
  "🚨 Caught you being sneaky! Real URL only.",
  "Sir, this is a Wendy's. Use http:// or https://",
  "Error 418: I'm a teapot. Also that's not a valid URL.",
  "Is that XSS in your pocket or just happy to see me?",
  "You're not slick. HTTP only, pal.",
  "Plot twist: that URL isn't real. Try again.",
  "Haha, very funny. Now try a real URL.",
  "We've seen this trick before. Pick a real URL.",
  "That URL is more fake than a $3 bill.",
];

export function pickFunnyMsg() {
  return FUNNY_MSGS[Math.floor(Math.random() * FUNNY_MSGS.length)];
}

export function validateBaseUrl(url) {
  if (!url) return { valid: false, xss: false, sanitized: "", error: "" };
  for (const pattern of XSS_PATTERNS) {
    if (pattern.test(url.trim())) {
      return { valid: false, xss: true, sanitized: "", error: pickFunnyMsg() };
    }
  }
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { valid: false, xss: false, sanitized: "", error: "Use http:// or https:// protocol" };
    }
    return { valid: true, xss: false, sanitized: parsed.toString(), error: "" };
  } catch {
    return { valid: false, xss: false, sanitized: "", error: "Invalid URL — did you forget https://?" };
  }
}

export function sanitizeBaseUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}
