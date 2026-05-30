---
name: maintain-readme
description: >
  Keep README.md accurate when the project changes — file structure, provider
  lists, setup instructions, and version. Trigger when adding/removing files in
  any tracked directory, changing provider-registry.js, updating manifest.json
  version, or modifying the provider hierarchy. Do NOT use this skill for
  README changes unrelated to project structure, providers, or setup.
---

# Maintain README

Sync README.md with the actual project state after every change that affects
file structure, providers, or configuration.

## 1. File Structure Tree

After adding or removing files from these directories, compare the tree block
(located under `## Project Structure`) to the actual files on disk:

| Directory | What to check |
|---|---|
| `background/handlers/` | List JS files, skip `dnr-rules.json` |
| `content/` | `content.js`, `content.css` |
| `popup/` | `popup.html`, `popup.js`, `popup.css` |
| `providers/` | All JS files — this changes most often |
| `lib/` | `config.js`, `logger.js` |

For each new file, infer a one-line description from its class name, JSDoc, or
role in the project. Match the existing indentation style (2-space indents for
each directory level).

If a file was removed, delete its line from the tree.

## 2. Provider List

After modifying `providers/provider-registry.js`, check for added or removed
providers in the `PROVIDER_CLASSES` array. Update three places:

1. **Features section** — the "Supports ..." bullet should list every provider
   by display name, comma-separated.
2. **Install step 5 bullets** — each provider should have a bullet with a link
   to its section (e.g. `see [Using Ollama](#using-ollama) below`). Core
   providers (OpenAI, Chrome Free AI) keep inline instructions.
3. **Dedicated sections** — each local-provider section (currently "Using
   Ollama", "Using LM Studio") follows this template:

   ```
   ## Using {Provider Name}

   Correctly supports [{name}]({url}) for local grammar checking. No API key is needed.

   1. {Setup step 1}
   2. {Setup step 2}
   3. In the extension popup, select **{Provider Name}**, choose a model, and save.
   ```

   Provider-specific troubleshooting or prerequisites (CORS, flags) go in
   numbered steps before the save instruction.

## 3. "Want to add a new Provider?" Section

Update this section if the provider abstract class hierarchy changes:

- **OpenAI-compatible path**: extend `AbstractOpenAICompatibleProvider` — list
  representative examples (Ollama, LM Studio).
- **Other providers path**: extend `AbstractProvider` directly.

## 4. Version

After `manifest.json` version changes, scan the README for any version
references and update them to match. Currently the version is only in
`manifest.json` and git tags — README has no version string, but check.

## Trigger Conditions

This skill applies when any of the following change in the working tree or a
commit being reviewed:

- Files added or removed from: `background/handlers/`, `content/`, `popup/`,
  `providers/`, `lib/`
- `providers/provider-registry.js` modified (new provider, removed provider)
- `manifest.json` version field changed
- New abstract class or base class added/removed in `providers/`
