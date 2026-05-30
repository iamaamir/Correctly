# Cascade Quality Design

Improve grammar correction accuracy for small/tiny models by introducing a
three-level cascading fallback strategy with model level caching, confidence
signaling, and visual progress indicators.

## Motivation

The extension's grammar correction relies on a single system prompt asking for
structured JSON output (`{ corrected, changes[] }`). Large models (GPT-4o,
Claude) handle this trivially. Small models (Gemma 2B, Phi-3, TinyLlama)
frequently produce malformed JSON — trailing commas, unquoted keys, truncated
output, markdown code fences around the JSON, or single quotes instead of
double quotes.

The existing `response_format` parameter (OpenAI JSON Schema mode) helps when
the provider supports it, but many local/self-hosted endpoints (Ollama, LM
Studio, generic OpenAI-compatible) do not. When it fails, there is no fallback
— the user gets an error.

## Solution: Three-Level Cascade

Each level uses a progressively simpler prompt. The cascade is orchestrated in
`AbstractProvider.correctGrammar()`, with status updates pushed to the content
script for visual feedback.

### Level Overview

| Level | Prompt | Transport | Output handling | Confidence check |
|-------|--------|-----------|-----------------|------------------|
| **L1** | Current `SYSTEM_PROMPT` + `RESPONSE_SCHEMA` via `response_format` | Structured JSON (API-enforced) | `JSON.parse` → `_validateResponse` → confidence check | If ≥ 6, done. If < 6, cascade to L2. |
| **L2** | `SYSTEM_PROMPT_L2` — current prompt with chain-of-thought preamble, no `response_format` | Unstructured text | Regex-extract JSON block → `JSON.parse` → `_validateResponse` → confidence check | Same as L1. |
| **L3** | `SYSTEM_PROMPT_L3` — "Return only the corrected text, nothing else" | Plain text | Wrap as `{ corrected: text.trim(), changes: [] }` | Always accepted (last resort). |

### Cascade Flow

```
correctGrammar(text, { onProgress } = {}):
  1. Validate API key, empty text short-circuit (unchanged)
  2. Read level cache → determine startLevel (default 1 or cached level)
  3. For level = startLevel; level <= 3; level++:
     a. onProgress(statusForLevel(level))
     b. Try:
        - level 1: this._doCorrectGrammar(text)
        - level 2: this._doCorrectGrammarLevel2(text)
        - level 3: this._doCorrectGrammarLevel3(text)
     c. Catch:
        - If not cascadeable (network error, timeout, API 5xx): throw immediately
        - If cascadeable (JSON parse failure, validation failure): continue to next level
     d. If result has confidence AND confidence < 6 AND level < 3: continue to next level
     e. Return validated result, update cache
  4. If all levels exhausted: throw "Grammar check failed after all cascade levels"
```

#### Cascadeable vs. Non-Cascadeable Errors

| Error type | Cascadeable? | Behavior |
|------------|-------------|----------|
| `JSON.parse` failure | Yes | Try next level with simpler output format |
| `_validateResponse` shape failure (missing fields) | Yes | Try next level |
| Empty content response | Yes | Try next level |
| Network error / `fetch` TypeError | **No** | Retry at current level (existing logic), then throw |
| API 4xx status | **No** | Throw immediately (auth, rate limit, bad request) |
| API 5xx status | **No** | Retry at current level (existing logic), then throw |
| Request timeout | **No** | Throw immediately |

#### Status Mapping for onProgress

| Level | Status string | Indicator color | Hex |
|-------|---------------|-----------------|-----|
| 1 | `"checking"` | Green | `#2D7D46` |
| 2 | `"retrying"` | Yellow | `#FDD835` |
| 3 | `"fallback"` | Orange | `#E65100` |
| on error | `"error"` | Red | `#C62828` |

### Prompt Definitions

All prompts live in `lib/config.js`. Each is a separate exported constant.

#### Level 1 — SYSTEM_PROMPT (unchanged, with confidence field added)

```js
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
  ],
  "confidence": <1-10>
}

Rules for changes:
- Include one entry per edit.
- Keep explanations brief and specific.
- Use standard ASCII punctuation characters in output.
- Return an empty changes array if no correction is needed.

Confidence:
- Set confidence to a number 1-10 indicating how sure you are the corrections are necessary.
- 10 = absolutely certain every change is correct.
- 1 = guessing, very uncertain.
- Return confidence 10 with empty changes array if the text has no issues.
`;
```

#### Level 2 — SYSTEM_PROMPT_L2 (CoT preamble + same JSON output)

```js
export const SYSTEM_PROMPT_L2 = `Fix grammar, spelling, and punctuation.

Think through the text step by step:
1. Read the full text and understand what it's trying to say.
2. Identify each grammar, spelling, or punctuation issue.
3. For each issue, determine the correct replacement and explain why.
4. Review your changes — is each one truly necessary, or is it a stylistic preference?

After reasoning, output ONLY valid JSON with no additional text:

{
  "corrected":"<fixed text>",
  "changes":[
    {
      "original":"...",
      "replacement":"...",
      "explanation":"..."
    }
  ],
  "confidence": <1-10>
}

Rules:
- One entry per edit.
- Brief, specific explanations.
- Return empty changes array + confidence 10 if no correction needed.
- Preserve voice, slang, and style — only fix what's actually wrong.
- The confidence field is a number 1-10 indicating how sure you are.
`;
```

#### Level 3 — SYSTEM_PROMPT_L3 (plain text only)

```js
export const SYSTEM_PROMPT_L3 = `Fix grammar, spelling, and punctuation in the following text. Return ONLY the corrected text — no JSON, no explanations, no formatting, no markdown, no code fences. Preserve the user's voice and style. Only change what needs fixing.

Corrected text:`;
```

### Architecture

#### Provider Method Contract

All three methods are defined on `AbstractProvider` as stubs that throw:

```js
async _doCorrectGrammar(text)           // Level 1 — structured JSON
async _doCorrectGrammarLevel2(text)      // Level 2 — CoT + JSON extraction
async _doCorrectGrammarLevel3(text)      // Level 3 — plain text, no changes
```

`AbstractOpenAICompatibleProvider` implements L2 and L3 by swapping the system
prompt and adjusting the request/response handling:

- **L2:** Sends `SYSTEM_PROMPT_L2` as the system message, omits
  `response_format`. On response, attempts to extract a JSON block from the
  raw text using regex, then parses and validates it. If JSON extraction fails,
  throws a cascadeable error.

- **L3:** Sends `SYSTEM_PROMPT_L3` as the system message. Reads the raw
  response text, wraps it as `{ corrected: text.trim(), changes: [] }`. No
  `changes` array, no confidence score.

`ChromeFreeAIProvider` overrides L2 and L3 similarly:

- **L2:** No `responseConstraint` parameter, uses `SYSTEM_PROMPT_L2`, extracts
  JSON from the raw string response.
- **L3:** No `responseConstraint`, uses `SYSTEM_PROMPT_L3`, wraps plain text.

#### Cascade in the Base Class

`AbstractProvider.correctGrammar()` is modified from a simple delegation:

```js
correctGrammar(text, { onProgress } = {}) {
  this.validateApiKey();
  if (!text || text.trim().length === 0) {
    return { corrected: text, changes: [] };
  }

  const levels = [
    { fn: () => this._doCorrectGrammar(text),           status: "checking" },
    { fn: () => this._doCorrectGrammarLevel2(text),     status: "retrying" },
    { fn: () => this._doCorrectGrammarLevel3(text),     status: "fallback" },
  ];

  const startLevel = this._getStartLevel(); // from cache
  for (let i = startLevel - 1; i < levels.length; i++) {
    const { fn, status } = levels[i];
    onProgress?.(status);
    try {
      const result = await fn();
      const validated = this._validateResponse(result);
      if (this._confidenceAcceptable(validated.confidence, i, levels.length - 1)) {
        this._updateCache(startLevel - 1, i + 1);
        return validated;
      }
      // Low confidence, cascade to next level
    } catch (err) {
      if (!this._isCascadeableError(err)) throw err;
      // Cascade to next level
    }
  }

  throw new Error("Grammar check failed after exhausting all cascade levels");
}
```

Key helper methods:

```js
_isCascadeableError(err) {
  // JSON parse failures, shape validation failures, empty responses
  return (
    err.message?.includes("Failed to parse") ||
    err.message?.includes("invalid response") ||
    err.message?.includes("missing") ||
    err.message?.includes("Empty response") ||
    err.message?.includes("Empty content")
  );
}

_confidenceAcceptable(confidence, currentIndex, lastIndex) {
  // Last level (L3) is always accepted
  if (currentIndex >= lastIndex) return true;
  // If no confidence reported (L3 fallback), accept
  if (confidence === null || confidence === undefined) return true;
  // Accept if confidence >= 6
  return confidence >= 6;
}
```

#### Cache Start Level

`_getStartLevel()` reads from `chrome.storage.local` key `modelLevelCache`:

```js
async _getStartLevel() {
  try {
    const data = await chrome.storage.local.get("modelLevelCache");
    const cache = data.modelLevelCache || {};
    const entry = cache[`${this.providerId}:${this.model}`];
    if (!entry) return 1;

    // Auto-upgrade: after 10 successful checks, try Level 1
    if (entry.level > 1 && entry.checksAtLevel >= 10) {
      return 1;
    }
    return entry.level;
  } catch {
    return 1;
  }
}
```

`_updateCache(previousStartLevel, succeededLevel)`:

```js
async _updateCache(prevStart, succeeded) {
  try {
    const data = await chrome.storage.local.get("modelLevelCache");
    const cache = data.modelLevelCache || {};
    const key = `${this.providerId}:${this.model}`;
    const existing = cache[key];

    if (prevStart > succeeded) {
      // Failed at cached level, found success at lower level — downgrade cache
      cache[key] = { level: succeeded, checksAtLevel: 0 };
    } else if (prevStart < succeeded) {
      // Tried a higher level and it worked — upgrade cache
      cache[key] = { level: succeeded, checksAtLevel: 0 };
    } else {
      // Same level as cache — increment counter
      cache[key] = { level: succeeded, checksAtLevel: (existing?.checksAtLevel || 0) + 1 };
    }

    await chrome.storage.local.set({ modelLevelCache: cache });
  } catch {
    // Cache write failure is non-critical
  }
}
```

#### Confidence in Schema

`RESPONSE_SCHEMA` in `abstract-openai-compatible-provider.js` adds optional
`confidence` at the top level:

```js
export const RESPONSE_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "grammar_correction",
    strict: true,
    schema: {
      type: "object",
      properties: {
        corrected: { type: "string" },
        changes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              original: { type: "string" },
              replacement: { type: "string" },
              explanation: { type: "string" },
            },
            required: ["original", "replacement", "explanation"],
            additionalProperties: false,
          },
        },
        confidence: { type: "number" },
      },
      required: ["corrected", "changes"],
      additionalProperties: false,
    },
  },
};
```

`confidence` is NOT in the `required` array — it's optional. Models that don't
support it (or L3 fallback) omit it. `_validateResponse` does NOT require it.

Likewise for `GRAMMAR_SCHEMA` in `chrome-free-ai-provider.js`.

### Visual Feedback

#### Indicator Colors

The content script injects a small pulsing dot next to the editing element
while checking. Currently solid green. Change to one of four states based on
progress messages from the background.

**CSS classes** in `content/content.css`:

```css
.correctly-indicator-dot {
  display: block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  animation: correctly-pulse 1.2s infinite ease-in-out;
}
.correctly-indicator-dot--checking { background: #2D7D46; }
.correctly-indicator-dot--retrying { background: #FDD835; }
.correctly-indicator-dot--fallback { background: #E65100; }
.correctly-indicator-dot--error    { background: #C62828; }

@keyframes correctly-pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.8); }
  50%      { opacity: 1;   transform: scale(1.2); }
}
```

**Content script listener** in `content/content.js`:

```js
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "CHECK_PROGRESS") {
    if (!indicatorEl) return;
    const dot = indicatorEl.querySelector(".correctly-indicator-dot");
    if (!dot) return;
    dot.className = `correctly-indicator-dot correctly-indicator-dot--${msg.status}`;
  }
});
```

#### Background Pushes Progress

In `background/handlers/grammar.js`, `handleGrammarCheck` passes a progress
callback that sends messages to the content script:

```js
const result = await provider.correctGrammar(text, {
  onProgress: (status) => {
    if (sender.tab?.id) {
      chrome.tabs.sendMessage(sender.tab.id, {
        type: "CHECK_PROGRESS",
        status,
      }).catch(() => {
        // Tab may have closed — ignore
      });
    }
  },
});
```

#### Tooltip Confidence

If the response includes `confidence`, display it above the changes list:

```js
// In showTooltip()
if (correction.confidence) {
  const confidenceHtml = `
    <p class="correctly-confidence">
      Confidence: ${correction.confidence}/10
    </p>
  `;
  body.insertAdjacentHTML("afterbegin", confidenceHtml);
}
```

CSS:

```css
.correctly-confidence {
  font-size: 11px;
  color: #888;
  margin: 0 0 8px;
  padding: 0 8px;
}
```

### Level Caching

**Storage location:** `chrome.storage.local`, key `"modelLevelCache"`.

**Schema:**

```json
{
  "openai:gpt-4o-mini":  { "level": 1, "checksAtLevel": 42 },
  "ollama:gemma:2b":     { "level": 2, "checksAtLevel": 7 },
  "ollama:phi3:mini":    { "level": 3, "checksAtLevel": 3 }
}
```

**Key format:** `${providerId}:${model}` — unique per provider+model combo.

**Value:** `{ level: 1|2|3, checksAtLevel: integer }`

- `level`: The cascade level that last succeeded.
- `checksAtLevel`: Number of consecutive successful checks at this level.

**Cache rules:**

| Event | Action |
|-------|--------|
| Success at cached level | Increment `checksAtLevel` |
| `checksAtLevel >= 10` and `level > 1` | On next check, try Level 1 (auto-upgrade attempt) |
| Auto-upgrade succeeds (Level 1 works) | Update cache `level: 1`, reset `checksAtLevel: 0` |
| Auto-upgrade fails | Reset `checksAtLevel: 0`, keep current level |
| Success at lower level than cache (cascade down) | Update cache to lower level, reset counter |
| User switches model/provider | New key, no cache hit, fresh cascade starts at L1 |

**Cache reset in popup:** A small text button in the model section:

> Reset model cache

on click, calls:

```js
await chrome.storage.local.remove("modelLevelCache");
```

### Edge Cases

| Case | Behavior |
|------|----------|
| Empty text | Short-circuit before cascade, return `{ corrected: "", changes: [] }` |
| All three levels fail | Throw final error, show in tooltip/indicator as red |
| L1 succeeds with confidence 4, L2 fails JSON, L3 succeeds | Use L3 result (no confidence, no changes) |
| User types during cascade | Content script discards stale response via `checkGeneration` counter (existing) |
| Tab closes during cascade | `chrome.tabs.sendMessage` promise rejects, caught silently |
| Provider offline (`fetch` fails) | `fetchWithRetry` retries at same level, then throws — no cascade |
| API key invalid (401) | Throws immediately — no cascade |
| Rate limited (429) | Throws immediately — no cascade |
| Model returns empty string for L3 | Wrapped as `{ corrected: "", changes: [] }` — no confidence, no changes |
| `checksAtLevel` counter overflow | Max practical value during a session is ~hundreds — safe as JS number |

### Files Changed

| File | Change |
|------|--------|
| `lib/config.js` | Add `SYSTEM_PROMPT_L2`, `SYSTEM_PROMPT_L3`, update `SYSTEM_PROMPT` QA section with explicit `confidence` field |
| `providers/abstract-provider.js` | Add cascade loop in `correctGrammar()`, add abstract `_doCorrectGrammarLevel2/3` stubs, add `_isCascadeableError`, `_confidenceAcceptable`, cache read/write helpers |
| `providers/abstract-openai-compatible-provider.js` | Implement `_doCorrectGrammarLevel2/3`, add optional `confidence` to `RESPONSE_SCHEMA`, add JSON block extraction regex helper |
| `providers/chrome-free-ai-provider.js` | Implement `_doCorrectGrammarLevel2/3`, add optional `confidence` to `GRAMMAR_SCHEMA` |
| `background/handlers/grammar.js` | Pass `onProgress` callback to `correctGrammar()` |
| `content/content.js` | Add `CHECK_PROGRESS` message listener, add confidence display to tooltip, update `showIndicator()` to accept status parameter |
| `content/content.css` | Add `--checking`, `--retrying`, `--fallback`, `--error` indicator color classes, add `.correctly-confidence` style |
| `popup/popup.js` | Add "Reset model cache" button |

### Open Questions (Post-Implementation)

- Should the cache auto-upgrade interval (10 checks) be configurable?
- Should we expose a per-level manual override in the popup for power users?
- Should the indicator dot pulse speed change per status (faster pulse = more urgent)?

### Future Possibilities

- **Per-change confidence:** If small models improve, schema could be extended
  with per-item `confidence` fields for granular display.
- **Automatic model switching:** If Level 3 consistently fails for a model,
  suggest a different model in the popup.
- **User feedback loop:** Thumbs up/down on corrections could feed into a
  model quality score visible in the popup.
