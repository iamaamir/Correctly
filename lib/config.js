/**
 * Centralized configuration for the Correctly extension.
 *
 * Content scripts cannot import ES modules, so content/content.js
 * maintains its own copy of the values it needs at the top of its IIFE.
 * If you change a value here, update content/content.js to match.
 */

// ── Grammar check ──

export const SYSTEM_PROMPT = `Fix grammar, spelling, and punctuation.

Requirements:
- Produce grammatically correct and internally consistent text.
- Preserve meaning and tone.
- Preserve informal wording, slang, colloquialisms, abbreviations, and style whenever possible.
- Standardize capitalization, punctuation, and contractions when appropriate.
- Make the smallest edits necessary for correctness.
- Preserve the user's voice and wording where grammatically valid.
- Do not paraphrase, rewrite, formalize, or normalize wording unnecessarily.
- Ensure agreement, tense, reference, and sentence structure are correct.
- Do not expand or normalize informal/slang wording (e.g., wanna, gonna, kinda, tho, lol) unless required for grammatical correctness.

Return JSON only:

{
  "corrected":"<fixed text>",
  "changes":[
    {
      "original":"...",
      "replacement":"...",
      "explanation":"..."
    }
  ]
}

Rules for changes:
- Include one entry per edit.
- Keep explanations brief and specific.
- Use standard ASCII punctuation characters in output.
- Return an empty changes array if no correction is needed.`;

export const AI_TEMPERATURE = 0.0;

export const AI_MAX_TOKENS_MIN = 1024;

// ── Badge timing (ms) ──

export const BADGE_DURATION_ISSUES = 5000;
export const BADGE_DURATION_OK = 2000;
export const BADGE_DURATION_ERROR = 3000;
