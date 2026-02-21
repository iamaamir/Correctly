/**
 * Centralized configuration for the Correctly extension.
 *
 * Content scripts cannot import ES modules, so content/content.js
 * maintains its own copy of the values it needs at the top of its IIFE.
 * If you change a value here, update content/content.js to match.
 */

// ── Grammar check ──

export const SYSTEM_PROMPT = `Fix grammar, spelling, and punctuation only. Preserve meaning, tone, and style.
Return JSON: {"corrected":"<fixed text>","changes":[{"original":"...","replacement":"...","explanation":"..."}]}
Empty changes array if text is correct.`;

export const AI_TEMPERATURE = 0;

export const AI_MAX_TOKENS_MIN = 1024;

// ── Badge timing (ms) ──

export const BADGE_DURATION_ISSUES = 5000;
export const BADGE_DURATION_OK = 2000;
export const BADGE_DURATION_ERROR = 3000;
