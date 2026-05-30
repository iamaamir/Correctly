# AGENTS.md

## Entry Points
- **Background**: `background/service-worker.js` (event-driven handler registration)
- **Content**: `content/content.js` (IIFE, injects grammar checking)
- **Popup**: `popup/popup.js` (settings UI)

## Critical Constraints
1. **Content scripts cannot import ES modules** — config duplicated in `content/content.js:35-36`
2. **Storage keys**:
   - `local`: `providerId`, `apiKey`, `model`, `baseUrl`, `enabled`, `disabledSites`, `logLevel`
   - `session`: `sessionTokenUsage`, `fetchedModelsCache`
3. **Ollama CORS fix**: `OLLAMA_ORIGINS=* ollama serve`
4. **Testing before refactors**: follow `docs/testing/2026-05-29-test-setup-plan.md` before extracting `WritingSession` or changing provider setup flow.

## Provider Pattern
All providers extend `AbstractProvider` → `AbstractOpenAICompatibleProvider` (for OpenAI-compatible APIs).
For any OpenAI-compatible service that just needs a base URL + API key, use `GenericOpenAIProvider`
directly — users configure the endpoint in the popup. No new class needed.

## Badge States
`ready`, `checking`, `found`, `ok`, `off`, `nokey`, `error` (see `handlers/badge.js:5-19`)

## Testing Expectations
- Add or update tests with new feature work once the Vitest harness exists.
- Prioritize tests for pure modules first (`lib/url-utils.js`, `lib/score.js`, storage helpers), then workflow modules through fake adapters.
- For content script changes, protect latest-wins behaviour, stale response rejection, correction application, and site disablement.
- For popup/provider setup changes, protect base URL validation, model loading, save/verify order, and API key sentinel handling.
- Do not import ES modules from content scripts to make code easier to test; use a classic script module or a build step first.
- Record manual Chrome extension smoke checks after content, popup, manifest, or provider changes.
