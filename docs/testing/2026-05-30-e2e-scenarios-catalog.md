# E2E Scenario Catalog (Extension Runtime + Providers)

Date: 2026-05-30
Branch baseline: feat/playwright-extension-e2e
Audience: AI agents + humans extending Playwright E2E

## Purpose

Define full scenario matrix for high-value end-to-end coverage.
Keep deterministic tests first. Add flaky/network-heavy tests last.

## Test Layers

1. **Deterministic E2E (required in CI)**
   - No external provider dependency.
   - Assert extension load, popup/provider UI, storage wiring, content runtime state transitions.

2. **Provider Contract E2E (gated/nightly)**
   - Uses mock OpenAI-compatible server.
   - Validates request payloads, schema fallback, error handling.

3. **Live Provider Smoke (manual/nightly opt-in)**
   - Real API keys/models optional.
   - Non-blocking for main CI.

---

## Scenario Matrix

## A) Boot / Extension Loading

A1. Extension loads in browser context
- Assert service worker registered.
- Assert extension ID derived from service worker URL.

A2. Content script injects on HTTP page
- Assert marker present (`data-correctly-content-script=1`).
- Assert no uncaught script error in console.

A3. Popup opens successfully
- Navigate `chrome-extension://<id>/popup/popup.html`.
- Assert core controls exist.

A4. Provider list loads from registry
- Assert expected ids present:
  - `openai`
  - `chrome-free-ai`
  - `ollama`
  - `lmstudio`
  - `openai-compatible`

## B) Popup Settings + Storage

B1. Save OpenAI config happy path
- Fill provider/api key/model.
- Save.
- Assert `chrome.storage.local` keys persisted (`providerId`, `apiKey`, `model`, `enabled`).

B2. API key sentinel handling
- Save with no-key-required provider.
- Assert sentinel semantics preserved.

B3. Base URL validation (openai-compatible)
- Invalid URL rejected with status message.
- Valid URL normalized + persisted.

B4. Enabled toggle
- Disable extension in popup.
- Assert content-side checks do not run.
- Re-enable -> checks resume.

B5. Site toggle
- Disable current hostname.
- Assert host added to `disabledSites`.
- Content runtime deactivates on page.
- Re-enable host -> activates.

B6. Log level persistence
- Change log level.
- Assert persisted and reflected after popup reopen.

## C) Content WritingSession Workflow

C1. Debounce latest-wins
- Type burst input.
- Assert one check request for last text.

C2. Stale response rejection
- Delay first response, send second response early.
- Assert stale first response ignored.

C3. Min text threshold
- Input below threshold -> no check.

C4. Unchanged text skip
- Repeat same text -> no duplicate check.

C5. Focusout triggers check
- Valid text + blur -> immediate check path.

C6. Ignore flow
- Show suggestions -> click Ignore.
- Assert dismissed element suppresses checks until new input.

C7. Ignore streak nudge
- Ignore repeatedly to threshold.
- Assert disable-site nudge shown.

C8. Apply one correction
- Accept single correction.
- Assert text updated, state updates, tooltip re-renders remaining changes.

C9. Apply all corrections
- Assert final text applied once.
- Assert no self-trigger correction loop.

C10. Tooltip dismissal
- Click outside/Escape -> tooltip hides.

## D) Badge + Status Flow (Background)

D1. Ready/checking/found/ok state transitions
- Trigger check with issues and without issues.
- Assert badge pipeline transitions valid set.

D2. Off/nokey state
- No key or disabled extension -> expected badge state.

D3. Error state
- Provider error/network failure -> badge `error`.

## E) Provider Request / Response Contracts (Mock Server)

E1. Structured output request includes response_format schema
- For compatible provider path.

E2. Strict schema requires confidence
- Assert payload schema `required` includes `confidence`.

E3. response_format rejected fallback
- Mock error containing `response_format`/`json_schema`.
- Assert retry without schema.
- Assert provider marks no-structured-output cache flag.

E4. L2 fallback path
- Force parse failure L1.
- Assert L2 extraction path.

E5. L3 full-text fallback path
- Force L2 fail.
- Assert L3 corrected text path.

E6. Token usage accounting
- Assert `sessionTokenUsage` updated from usage payload.

## F) Disabled Site + Reactivation

F1. Disabled host on initial load
- Host in `disabledSites` -> no listeners attached.

F2. Toggle host state while page open
- storage change event deactivates/activates session.

## G) Resilience / Lifecycle

G1. Background restart tolerance
- Simulate service worker restart between requests.
- Assert no content crash, next check recovers.

G2. Multiple tabs
- Per-tab checks independent; no crossed tooltip state.

G3. Navigation
- SPA or full nav clears old element state.

## H) Security / Validation

H1. Reject javascript/data base URLs.
H2. Ensure no API key leak to DOM/UI logs.
H3. Verify popup sanitization for model/baseUrl rendering.

---

## Priority Order (Implementation)

P0 (build now)
1. A1-A4
2. C1-C4
3. B4-B5
4. E3

P1
1. C5-C10
2. D1-D3
3. B1-B3

P2
1. E1/E2/E4/E5/E6
2. G1-G3
3. H1-H3

---

## Determinism Rules

- Prefer local fixture HTTP server.
- Prefer mock provider server over internet.
- Freeze debounce timers where possible.
- Avoid asserting animation timing.
- Assert state/DOM/storage outcomes.

---

## Agent Handoff Notes

When adding E2E test:
1. Tag scenario ID in test name (e.g., `C2 stale response rejection`).
2. State if deterministic or nightly-only.
3. Record dependencies (mock server, storage seed, provider mode).
4. Keep one behavior per test.
5. If flaky, mark with issue + quarantine label, not silent retries.

---

## Pair-Review Checklist (for another agent)

Reviewer agent should verify:
- Scenario maps to architecture decision (latest-wins, ephemeral SW, adapter boundaries).
- No ES module import added to content script path.
- Storage keys align with AGENTS.md contract.
- Badge state assertions use allowed states only.
- Tests avoid real network unless explicitly nightly/live.
- Failure output includes actionable diagnostics.
