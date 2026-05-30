# Test Setup Plan

Date: 2026-05-29

## Purpose

Correctly is close to a refactor-heavy phase. Before extracting `WritingSession` or moving popup provider setup logic, add a small automated test harness that protects the current behaviour.

This document is written as an agent handoff. Follow the order. Do not start the architecture refactor before the first tests are running.

## Current State

- There is no `package.json`.
- There is no test runner config.
- There are no existing unit, integration, or browser tests.
- The repo already contains ESM files for extension pages and background code.
- `content/content.js` is an IIFE content script.
- Critical constraint from `AGENTS.md`: content scripts cannot import ES modules.

## Recommended Tooling

Use Vitest for the first test harness.

Reasons:

- It handles ESM project files cleanly.
- It supports fake timers through `vi`.
- It supports mocking and stubbing globals.
- It defaults to a Node environment, with per-file browser-like environments available later.
- It is lighter than starting with full browser automation.

Use explicit imports from `vitest`; do not enable global test APIs.

```js
import { describe, expect, it, vi } from "vitest";
```

Use the Node environment by default. Add `happy-dom` only for files that need DOM behaviour.

```js
// @vitest-environment happy-dom
```

## Required Files To Add

Add these files in the first testing slice:

```text
package.json
vitest.config.js
tests/
  unit/
    score.test.js
    url-utils.test.js
  helpers/
    chrome-stub.js
    deferred.js
```

Do not add a bundler in this slice.

Do not add Playwright in this slice.

Do not refactor `content/content.js` in this slice.

## `package.json`

If `package.json` does not exist, create it:

```json
{
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui"
  },
  "devDependencies": {
    "@vitest/ui": "latest",
    "happy-dom": "latest",
    "vitest": "latest"
  }
}
```

Notes:

- `"type": "module"` lets Node-side tooling treat `.js` files as ESM.
- Chrome extension loading is not affected by this field.
- `happy-dom` is included for future DOM adapter tests, but most first tests should run in Node.

Then install dependencies:

```bash
npm install
```

If network access is blocked, request approval to run the install with network access. Do not fake `node_modules`.

## `vitest.config.js`

Create:

```js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    restoreMocks: true,
    clearMocks: true,
    mockReset: true,
  },
});
```

Keep `globals` disabled. Explicit imports make agent-written tests easier to audit.

## Helper: Deferred Promise

Create `tests/helpers/deferred.js`:

```js
export function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
```

Use this later for stale response and latest-wins tests.

## Helper: Chrome Stub

Create `tests/helpers/chrome-stub.js`:

```js
import { vi } from "vitest";

export function createChromeStub() {
  const localStore = new Map();
  const sessionStore = new Map();

  function makeStorageArea(store) {
    return {
      get: vi.fn(async (keys) => {
        if (Array.isArray(keys)) {
          return Object.fromEntries(keys.map((key) => [key, store.get(key)]));
        }
        if (typeof keys === "string") {
          return { [keys]: store.get(keys) };
        }
        if (keys && typeof keys === "object") {
          return Object.fromEntries(
            Object.entries(keys).map(([key, fallback]) => [key, store.has(key) ? store.get(key) : fallback]),
          );
        }
        return Object.fromEntries(store.entries());
      }),
      set: vi.fn(async (values) => {
        for (const [key, value] of Object.entries(values)) store.set(key, value);
      }),
      remove: vi.fn(async (keys) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
      }),
      _store: store,
    };
  }

  return {
    runtime: {
      sendMessage: vi.fn(),
      onMessage: { addListener: vi.fn() },
    },
    storage: {
      local: makeStorageArea(localStore),
      session: makeStorageArea(sessionStore),
      onChanged: { addListener: vi.fn() },
    },
    tabs: {
      sendMessage: vi.fn(async () => undefined),
      query: vi.fn(async () => []),
    },
    action: {
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(),
    },
  };
}
```

Use `vi.stubGlobal("chrome", createChromeStub())` in tests that import modules touching `chrome`.

Always restore globals after the test:

```js
afterEach(() => {
  vi.unstubAllGlobals();
});
```

## Ongoing Feature Testing Policy

After the initial harness exists, every feature or refactor should include one of:

- unit tests for changed pure logic
- workflow tests through fake adapters
- a documented reason tests are not practical, plus manual smoke results

Use this mapping:

```text
content workflow change
  -> WritingSession tests
  -> manual input/textarea/contentEditable smoke check

popup provider setup change
  -> provider setup workflow tests
  -> manual save/verify smoke check

provider transport change
  -> provider adapter tests with mocked fetch or mocked LanguageModel
  -> manual provider check if reachable

storage key or cache change
  -> storage helper tests
  -> migration/default-value checks

scoring or cascade change
  -> scoreResponse/mergeConfidence tests
  -> provider verification smoke check
```

Do not merge a broad refactor that only has manual testing unless the changed code cannot be isolated yet. In that case, make the next slice an isolation/testability slice.

## First Tests To Write

### 1. `lib/url-utils.js`

Write tests for:

- accepts `https://api.example.com/v1`
- accepts `http://localhost:11434`
- rejects `javascript:` URLs
- rejects `data:` URLs
- rejects non-HTTP protocols
- sanitizes trailing and whitespace-padded URLs through `new URL`

Important: `validateBaseUrl()` returns randomized XSS messages. Do not assert the exact funny message. Assert `valid`, `xss`, and `sanitized`.

### 2. `lib/score.js`

Write tests for:

- empty response with unchanged text scores high
- corrected text changed with empty `changes` scores low before level 3
- phrase not found in source is suppressed
- duplicate changes penalize score
- overlapping changes penalize score
- usable changes reconstruct corrected text
- `mergeConfidence()` gives more weight to internal score than model confidence

Do not test private helper functions directly. Use `scoreResponse()` and `mergeConfidence()`.

### 3. Storage-Backed Modules Only After Chrome Stub Exists

After the stub is in place, add tests for:

- `lib/settings.js` defaults
- `setSettings()` clears cache
- `background/handlers/grammar.js` session usage only if the module can be imported without real Chrome

Do not start with background handler tests if they require large mocking.

## WritingSession Test Strategy

Do not extract `WritingSession` as an ES module imported by `content/content.js`; that violates the project constraint that content scripts cannot import ES modules.

There are two safe options:

### Option A: Keep `WritingSession` Inline First

Keep the first extraction inside `content/content.js` until behaviour is clear. This has less test leverage but less extension loading risk.

Use this if the refactor is small and does not create a new file.

### Option B: Classic Content Script Module

If creating a new content-side runtime file, make it a classic script, not ESM:

```js
(function initCorrectlyWritingSession(global) {
  class WritingSession {
    // ...
  }

  global.CorrectlyWritingSession = WritingSession;
})(globalThis);
```

Then update `manifest.json` to load it before `content/content.js`:

```json
"js": ["content/writing-session.js", "content/content.js"]
```

Tests can load this file by evaluating it in a controlled context and reading `globalThis.CorrectlyWritingSession`.

Do not use `import` or `export` in content-side runtime files unless the project first adds a build step that bundles content scripts into classic JS.

## WritingSession Behaviour To Protect

When the `WritingSession` extraction begins, write tests for these behaviours before moving more code:

- debounce sends only the latest text
- each check has a monotonically increasing request id
- older responses are ignored after a newer request starts
- empty or too-short text does not send a request
- unchanged text does not send a second request
- dismiss suppresses repeat checks until new input arrives
- accepting all corrections writes the expected text
- accepting one correction removes only that correction
- deactivation clears timers and active state

Use fake adapters:

```text
grammar client
  check(text, requestId) -> Promise<result>

editable adapter
  getText(element)
  setText(element, text)
  describe(element)
  shouldCheck(element)

feedback adapter
  showChecking(element)
  showResult(element, correction)
  showError(element, error)
  hide()
```

The tests should verify calls to fake adapters, not DOM details.

## Manual Smoke Checklist

Automated tests are not enough for extension behaviour. After any content or popup refactor, manually load the extension and check:

- text input grammar check works
- textarea grammar check works
- contentEditable grammar check works
- stale response does not show old suggestions
- accept all works
- accept one works
- ignore works
- repeated ignore nudge appears
- disable on current site works
- popup save and verify still works
- OpenAI-compatible base URL validation still works
- Chrome Free AI status still renders
- session usage still displays after a check

Record manual results in the PR or final agent response.

## Safe Implementation Order

1. Add `package.json`, `vitest.config.js`, and helpers.
2. Add tests for `lib/url-utils.js`.
3. Add tests for `lib/score.js`.
4. Run `npm test`.
5. Only then start the smallest `WritingSession` extraction.
6. Add latest-wins tests before moving tooltip or nudge code.
7. Refactor content in slices and run tests after each slice.
8. Manually smoke test the extension after any content script manifest change.

## Commands

Run all tests:

```bash
npm test
```

Run a single test file:

```bash
npm test -- tests/unit/score.test.js
```

Watch tests while refactoring:

```bash
npm run test:watch
```

Run formatter/linter if available:

```bash
npx biome check .
```

Do not add a new lint tool while setting up tests. The repo already has `biome.json`.

## CI

Keep automated tests in a separate GitHub Actions workflow from linting:

- `.github/workflows/test.yml` runs `npm ci` and `npm test`.
- `.github/workflows/test.yml` exposes `workflow_call` so release can reuse the same test workflow.
- `.github/workflows/lint.yml` runs Biome only.

When adding a new test command or changing the package manager, update the test workflow in the same change. Do not duplicate test setup in release workflows; call the reusable test workflow instead.

## Agent Guardrails

- Do not modify unrelated untracked files.
- Do not rewrite `content/content.js` while adding the test harness.
- Do not add SPSC queues, shared buffers, or a worker framework.
- Do not import ESM from content scripts.
- Do not assert randomized message text from `pickFunnyMsg()`.
- Do not test private helper functions by exporting them solely for tests.
- Do not mock everything if a pure module can be tested directly.
- Do not add Playwright until unit tests exist and a browser smoke gap remains.

## References

- Vitest writing tests: https://vitest.dev/guide/learn/writing-tests
- Vitest test environment config: https://vitest.dev/config/environment
- Vitest mocking and fake timers: https://v3.vitest.dev/guide/mocking.html
