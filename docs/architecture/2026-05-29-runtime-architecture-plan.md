# Runtime Architecture Plan

Date: 2026-05-29

## Context

Correctly is a Manifest V3 Chrome extension with three main runtime surfaces:

- `content/content.js`: page integration, editable element detection, typing lifecycle, tooltip UI, nudges, and correction application.
- `background/service-worker.js`: message routing, badge state, provider orchestration, settings verification, token usage, and Chrome Free AI handlers.
- `popup/popup.js`: provider setup, model selection, base URL handling, verification, site enablement, and session usage display.

The current architecture already uses the correct broad seam: content scripts handle page DOM work, and the background service worker handles provider work. The next improvement should deepen the modules around workflow state rather than add low-level concurrency primitives.

## Decisions

### Use Message Passing, Not Shared Memory

Do not introduce `SharedArrayBuffer`, shared typed arrays, or binary transport for grammar checks.

Reasoning:

- Grammar check payloads are small text and JSON objects.
- The dominant latency is model or network execution, not copying a few KB of text.
- Content scripts run on arbitrary sites where cross-origin isolation cannot be assumed.
- Shared memory would increase the interface surface and make cancellation, stale response handling, and service worker lifetime harder to reason about.

Use ordinary Chrome message passing:

```js
{
  type: "CHECK_GRAMMAR",
  requestId,
  text,
  source: {
    url: location.href,
    elementKind: "textarea"
  }
}
```

Responses should echo `requestId` so content-side code can ignore stale results.

### Use Latest-Wins Scheduling, Not FIFO Queues

Do not introduce SPSC queues for typing-driven grammar checks.

Reasoning:

- For typing, old text becomes stale quickly.
- FIFO processing can produce bad UX by spending work on outdated input.
- The content script already has the right primitive in `checkGeneration`.

The intended behaviour is:

```text
input event
  -> debounce
  -> create request id
  -> send latest text
  -> ignore response if request id is stale
```

### Treat the MV3 Background as Ephemeral

The background service worker should continue to execute provider work, but correctness must not depend on long-lived in-memory state.

Allowed:

- in-memory provider cache as an optimization
- in-memory token usage buffer if flushed defensively
- transient request state for active checks

Avoid:

- durable queues in service worker variables
- correctness-critical timers
- assumptions that the background worker remains alive

Persist or reconstruct anything important through `chrome.storage` or request data.

### Add Provider Serialization Only With Evidence

Do not build a generic request queue now.

If local providers show contention, add a small per-provider/model executor later:

```text
provider/model key
  active request: current check
  pending request: newest check only
```

This keeps latest-wins semantics while preventing local model contention. A FIFO queue should only be added if there is a user-visible need to preserve every request.

## Target Shape

```text
content/content.js
  WritingSession
    owns debounce, request ids, stale response rejection,
    active editable element state, correction lifecycle,
    ignore and dismiss state

  DOM adapters
    own tooltip rendering, indicator rendering, nudges,
    text read/write, positioning, and event binding

background/handlers/grammar.js
  GrammarCheckExecutor
    owns settings lookup, provider creation/cache,
    grammar check execution, scoring/cascade,
    token usage, and badge state

providers/*
  Provider adapters
    own transport and provider-specific availability,
    model metadata, unload hooks, and provider errors

storage module
  owns key names, defaults, sentinels, cache TTLs,
  local/session placement, and site activation storage
```

## Action Plan

### 0. Add Tests Before Refactoring

Before extracting `WritingSession`, follow the test setup handoff:

- `/Users/mak/git/Correctly/docs/testing/2026-05-29-test-setup-plan.md`

The architecture refactor should not begin until the initial Vitest harness and first `lib/url-utils.js` / `lib/score.js` tests are passing.

### 1. Deepen `WritingSession`

Create a content-side module that owns the writing workflow state.

Initial responsibilities:

- editable element activation
- debounce timer
- request id generation
- latest-wins stale response rejection
- active correction state
- ignore/dismiss state
- correction application decisions

Keep this module in-process and simple. The interface should be workflow-oriented, for example:

```js
session.handleInput(eventTarget);
session.handleFocusOut(eventTarget);
session.acceptAll();
session.acceptOne(index);
session.dismiss();
session.deactivate();
```

Do not design broad abstractions before extracting the real behaviour.

### 2. Extract DOM Adapters Around the Session

Move page-specific details behind small adapters:

- editable element adapter: `resolveEditableHost`, `shouldCheckElement`, `getText`, `setText`
- feedback adapter: tooltip, indicator, nudge rendering
- browser adapter: `chrome.runtime.sendMessage`, `chrome.storage`, event listeners

The writing session should coordinate these adapters without knowing tooltip DOM structure or Chrome storage key names.

### 3. Add Focused Tests for Latest-Wins Behaviour

Test the interface, not private helper functions.

High-value cases:

- debounce sends only latest text
- stale grammar response is ignored
- accepted correction updates text and resets ignore state
- dismissed element resumes checks after new input
- disabled site deactivates the session

Use fake adapters rather than a real browser page where possible.

### 4. Deepen Provider Setup Later

After content-side workflow is stable, move popup setup rules into a provider setup module.

Responsibilities:

- base URL validation and sanitization
- model fetch scheduling
- fetched model cache lookup and storage
- save validation
- verification order
- API key sentinel handling
- status and compatibility data returned for rendering

The popup should become mostly a rendering adapter.

### 5. Revisit Storage Vocabulary

Once the first two modules are clearer, deepen storage handling if key semantics still leak.

Candidate ownership:

- `providerId`, `apiKey`, `model`, `baseUrl`, `enabled`, `disabledSites`, `logLevel`
- `sessionTokenUsage`
- `fetchedModelsCache`
- `modelLevelCache`
- `noapikeyrequired` sentinel
- cache TTLs

The goal is locality: key changes and storage placement changes should happen in one module.

### 6. Keep Correction Pipeline Stable Until Needed

The correction cascade and scoring path already provide useful depth. Do not refactor it first.

Revisit only after there are tests around:

- provider success
- structured output fallback
- full-text fallback
- scoring suppression
- model capability cache

## Non-Goals

- no SPSC queues for grammar checks
- no shared buffers for text transport
- no durable in-memory background queue
- no broad worker framework
- no rewrite of provider classes before content workflow is stabilized

## First Implementation Slice

The first slice should be small:

1. Introduce `WritingSession` inside or beside `content/content.js`.
2. Move debounce, request id, and stale response handling into it.
3. Keep existing tooltip and DOM functions as adapters.
4. Verify existing extension behaviour manually.
5. Add focused tests if the repo gets a test harness.

This gives immediate locality without turning Correctly into an infrastructure project.
