# Agent Instructions

## Project Scope

Correctly is a cross-browser WebExtension. It supports both Chrome and Firefox.

Do not assume this is Chrome-only. Any shared extension code must preserve Firefox compatibility unless the user explicitly asks for Chrome-only work.

## Browser Targets

- Chrome release build: `npm run build:release:chrome`
- Firefox release build: `npm run build:release:firefox`
- Combined release build: `npm run build:release`

Manifest files:

- `manifest.base.json` is shared.
- `manifest.chrome.patch.json` is Chrome-specific.
- `manifest.firefox.patch.json` is Firefox-specific.
- `scripts/manifest-utils.mjs` merges target manifests and removes Firefox-incompatible fields such as `background.service_worker` and `declarative_net_request`.

## Cross-Browser Rules

- Keep cancellation, provider cascade logic, scoring, settings, popup, and content-script behavior browser-neutral.
- Keep Chrome Prompt API / `LanguageModel` access isolated in `providers/chrome-free-ai-provider.js`.
- Never add unguarded `LanguageModel`, Prompt API, or Chrome-only session-cache code to shared background, content, settings, or abstract provider modules.
- Firefox must never instantiate Chrome Prompt API sessions. It should report Chrome Free AI unavailable through existing provider availability/UI paths.
- `chrome.*` is the WebExtensions namespace used in this codebase and can be valid in Firefox extension contexts. Do not replace it with Chrome-only assumptions.
- Before adding a browser API, check whether it is supported by both target browsers or isolate it behind target-specific manifest/code paths.
- Be careful with `AbortSignal.timeout()` and other newer APIs; browser support can differ. Prefer helpers when adding provider-wide cancellation.

## Chrome Free AI Work

Chrome Free AI is Chrome-specific because it uses the Prompt API / `LanguageModel`.

For session lifecycle or cancellation work, read:

- `docs/chrome-free-ai-session-lifecycle-design.md`
- `docs/chrome-free-ai-session-lifecycle-implementation-todo.md`

Core constraints:

- Per-tab cancellation and request identity guards are browser-neutral.
- Base-session-per-level and clone-per-check optimization belongs only inside `ChromeFreeAIProvider`.
- Prompt API errors with `AbortError` must be rethrown unchanged.
- Settings verification must not pin Chrome Prompt API base sessions.
- Do not break Firefox while optimizing Chrome Free AI.

## Keyless Providers

Providers expose `requiresApiKey`.

For keyless providers, the popup stores the sentinel:

```js
const NO_API_KEY_SENTINEL = "noapikeyrequired";
```

Do not treat the raw background `apiKey` precheck as a bug without tracing the popup/settings flow. If changing configured-state logic, preserve keyless provider behavior for both Chrome and Firefox.

## Testing

Common commands:

- `npm test`
- `npm run lint`
- `npm run test:e2e`
- `npm run test:e2e:provider`
- `npm run bench:session`

When changing release/build behavior, test both browser targets if feasible:

- `npm run build:release:chrome`
- `npm run build:release:firefox`

## Commits

Use Conventional Commits, including the project’s emoji convention when committing.

Examples:

- `✨ feat: add per-tab grammar cancellation`
- `🐛 fix: preserve Firefox manifest background scripts`
- `📝 docs: clarify Chrome Prompt API lifecycle`
