/**
 * Centralized configuration for the Correctly extension.
 *
 * Content scripts cannot import ES modules, so content/content.js
 * maintains its own copy of the values it needs at the top of its IIFE.
 * If you change a value here, update content/content.js to match.
 */

// ── Grammar check ──

export const SYSTEM_PROMPT = `You are a precise grammar correction assistant.
Given text, return a JSON object with:
- "corrected": the full corrected text
- "changes": an array of objects, each with "original", "replacement", and "explanation"

If the text has no errors, return {"corrected": "<original text>", "changes": []}.
Only fix grammar, spelling, and punctuation. Do not change meaning, tone, or style.
Return ONLY valid JSON, no markdown fencing.`;

export const AI_TEMPERATURE = 0.1;
export const AI_MAX_TOKENS = 2048;

// ── Badge timing (ms) ──

export const BADGE_DURATION_ISSUES = 5000;
export const BADGE_DURATION_OK = 2000;
export const BADGE_DURATION_ERROR = 3000;
