# Robust E2E Test Plan (Real Extension Flow)

Date: 2026-05-30
Status: Proposed execution plan
Audience: AI agents + maintainers implementing/expanding Playwright E2E

## Goal

Ensure E2E tests exercise the **actual extension runtime flow**:

- Popup UI -> storage
- Background service worker -> provider path
- Content script -> user-visible behavior
- Mock only provider network surface

No fragile workarounds as primary coverage.

---

## Principles

1. **Real surfaces first**
   - Drive popup via UI where feature under test is popup behavior.
   - Drive content via typing/focus/DOM interactions.
   - Let background process real messages.

2. **Mock only external dependency**
   - Mock provider HTTP API (`/models`, `/chat/completions`).
   - Keep extension internals real.

3. **Deterministic assertions**
   - Wait for state/DOM/storage changes, not arbitrary sleeps.
   - Capture mock-server request logs for causal assertions.

4. **No test-only shortcuts for primary E2E lanes**
   - No DOM backdoor as primary assertion path for core E2E.
   - If hooks exist, confine to narrowly-scoped workflow tests and mark clearly.

5. **One behavior per test**
   - Each case has single intent + strict pass/fail diagnostics.

---

## Harness Architecture

## 1) Fixture App Server

Serve deterministic pages over HTTP:
- `tests/e2e/fixtures/editor.html`
- additional fixtures for contentEditable/multi-field/disabled-site cases

## 2) Mock Provider Server (OpenAI-compatible)

Reusable scenario-driven mock:
- GET `/models`
- POST `/chat/completions`
- Response scripts: success, schema reject, malformed, timeout, 429/500
- Request capture log for payload assertions

## 3) Extension Runner

Playwright persistent Chromium context with extension loaded:
- `--disable-extensions-except`
- `--load-extension`

## 4) Shared Fixtures/Helpers

- launch/cleanup extension context
- open popup by extensionId
- open fixture page
- common assertions (call count, payload contains response_format, storage keys)

---

## Scenario Inventory (Blocking CI)

### E2E-BOOT-001: Extension boot + popup/provider visibility

**Purpose:** Verify extension loads and provider registry renders.

**Steps:**
1. Launch extension context.
2. Resolve extensionId from service worker URL.
3. Open popup.
4. Assert provider select options include expected ids.

**Assertions:**
- service worker exists
- popup loads
- provider IDs:
  - openai
  - chrome-free-ai
  - ollama
  - lmstudio
  - openai-compatible

---

### E2E-POPUP-001: Async model loading from mock provider

**Purpose:** Verify popup async model loading/save path end-to-end.

**Precondition:** mock provider `/models` returns model list; `/chat/completions` verify call succeeds.

**Steps:**
1. Open popup.
2. Select openai-compatible.
3. Enter base URL + api key.
4. Wait for model options to populate.
5. Select model.
6. Save.
7. Re-open popup.

**Assertions:**
- model options include mock model ids
- save succeeds
- persisted storage keys reflect selection
- popup state restored after reopen

---

### E2E-CONTENT-001: Typing triggers grammar check and tooltip

**Purpose:** Verify content script uses configured provider path and renders correction UI.

**Precondition:** popup config saved (from E2E-POPUP-001 path or setup fixture).

**Steps:**
1. Open fixture page with textarea.
2. Type text containing known mock-correctable token.
3. Wait for debounce/check.

**Assertions:**
- mock server receives `/chat/completions` request
- tooltip visible
- tooltip includes expected replacement text

---

### E2E-CONTENT-002: Apply correction updates text

**Purpose:** Validate correction application path.

**Steps:**
1. Use same flow to show tooltip with at least one change.
2. Click single-accept or apply-all.

**Assertions:**
- textarea value updated to corrected text
- tooltip state updates/hides appropriately

---

### E2E-PROVIDER-001: response_format reject -> fallback retry

**Purpose:** Validate E3 contract path in real runtime.

**Precondition:** mock server script:
- first completion -> 400 response_format/json_schema error
- second completion -> success payload

**Steps:**
1. Configure openai-compatible in popup.
2. Type text triggering check.

**Assertions:**
- call count >= 2
- at least one request includes `response_format`
- final UI shows corrected result

---

### E2E-SITE-001: Disable site suppresses checks

**Purpose:** Validate site-level disablement through popup + content.

**Steps:**
1. Open popup on fixture host.
2. Toggle site off.
3. Type valid text.

**Assertions:**
- no provider calls for typing on disabled host
- no tooltip appears

---

### E2E-TOGGLE-001: Global enabled toggle controls runtime

**Purpose:** Verify extension enabled/disabled behavior end-to-end.

**Steps:**
1. Toggle extension off in popup.
2. Type valid text on fixture.
3. Toggle on and retry.

**Assertions:**
- off: no calls/no tooltip
- on: calls + tooltip resume

---

## Scenario Inventory (Near-term CI)

### E2E-CONTENT-003: Latest-wins stale response rejection

Mock responses:
- request A delayed with correction OLD
- request B fast with correction NEW

Assert NEW shown, OLD never rendered.

### E2E-CONTENT-004: Min-length + unchanged suppression

Assert no network call for short text and unchanged repeat.

### E2E-BADGE-001: Badge state progression

Assert ready/checking/found/ok/error transitions via background-observable surface.

### E2E-USAGE-001: Session token usage increments

Assert `sessionTokenUsage` updates after completion usage payload.

---

## Nightly / Non-blocking

- service worker restart recovery
- multi-tab isolation
- navigation edge cases
- provider 429/500 retry pacing
- malformed JSON deep fallback chains (L1/L2/L3)

---

## Forbidden Shortcuts (for core E2E lanes)

- Do not bypass popup with direct storage mutation when testing popup behavior.
- Do not use DOM test hooks as primary assertion path for provider/content integration tests.
- Do not assert by fixed sleeps if an observable state exists.
- Do not use real internet providers in blocking CI.

---

## Allowed Setup Accelerators

- Direct storage seeding is allowed only for tests whose explicit focus is **not popup** (e.g., provider fallback internals), and must be documented in test header.
- Test-mode hooks allowed for isolated workflow tests (e.g., WritingSession micro-behavior), but not as sole proof for integrated flow.

---

## Required Test Metadata Template

Each E2E test should include:

- Test ID (e.g., `E2E-PROVIDER-001`)
- Intent (single behavior)
- Mock scenario name
- Setup method (`popup-ui` or `seeded-storage`)
- Determinism class (`blocking-ci` / `nightly`)

---

## Pair Review Checklist

Reviewer must verify:

1. Test uses real popup/content/background surfaces as intended.
2. Mocking limited to provider HTTP layer (unless explicitly documented).
3. Assertions validate outcomes and causality (UI + network call logs + storage where relevant).
4. No dependence on brittle text copy unless unavoidable.
5. Cleanup is strict (browser context, temp dirs, servers).
6. AGENTS.md storage key contract preserved.
7. Content script MV3 constraint preserved (no ES module import path added).

---

## Execution Order

1. E2E-BOOT-001
2. E2E-POPUP-001
3. E2E-CONTENT-001
4. E2E-CONTENT-002
5. E2E-PROVIDER-001
6. E2E-SITE-001
7. E2E-TOGGLE-001
8. E2E-CONTENT-003
9. E2E-CONTENT-004

This order builds confidence from load -> setup -> user workflow -> resilience.
