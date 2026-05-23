# Correctly

A minimalist Chrome extension that checks grammar, spelling, and punctuation using AI — either your own API key or Chrome's built-in Gemini Nano.

<!-- <img width="334" height="523" alt="image" src="https://github.com/user-attachments/assets/fd299824-941c-4c09-a1cb-351914602b92" /> -->
<img width="334" height="583" alt="image" src="https://github.com/user-attachments/assets/6a8387ac-5a5f-4ff0-96ae-796d70b1a292" />

<img width="358" height="556" alt="image" src="https://github.com/user-attachments/assets/4ff66285-56b7-4c94-bdf2-58f3bd0b7a00" />



## Features

- Works on any text input, textarea, or contentEditable element
- Inline correction tooltip with accept/dismiss per suggestion
- Supports OpenAI and Chrome's built-in Gemini Nano ("Chrome Free AI")
- Currently supports English — more languages coming
- Custom model selection - use any model your provider supports
- Chrome Free AI runs entirely on-device — no API key needed, no data leaves your machine
- Configurable log verbosity for debugging
- Respects `spellcheck`, `disabled`, `readonly`, ARIA attributes, and `data-correctly` opt-out

## Install

1. Clone the repo:
   ```
   git clone https://github.com/iamaamir/Correctly.git
   ```
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the `correctly` folder
5. Click the extension icon, select your provider, enter an API key if required, and save
   - **OpenAI**: enter your OpenAI API key
   - **Chrome Free AI**: no API key needed — enable `chrome://flags/#optimization-guide-on-device-model` and `chrome://flags/#prompt-api-for-gemini-nano`, then select "Chrome Free AI" and click Download
   - you can visit `chrome://on-device-internals/` to check the status or tune your model

## Project Structure

```
correctly/
├── manifest.json
├── background/
│   ├── service-worker.js      # Message routing, badge, provider orchestration
│   └── handlers/
│       ├── badge.js           # Extension badge state management
│       ├── grammar.js         # Grammar check pipeline, token usage tracking
│       ├── settings.js        # Settings verification and status
│       └── chrome-free-ai.js  # Chrome Free AI status and download
├── content/
│   ├── content.js             # Input detection, tooltip, correction logic
│   └── content.css            # Tooltip and indicator styles
├── popup/
│   ├── popup.html             # Settings UI
│   ├── popup.js               # Settings logic
│   └── popup.css              # Popup styles
├── providers/
│   ├── base-provider.js       # Abstract provider contract
│   ├── openai-provider.js     # OpenAI implementation
│   ├── chrome-free-ai-provider.js  # Chrome's built-in Gemini Nano
│   └── provider-registry.js   # Provider lookup and creation
└── lib/
    ├── config.js              # Shared configuration
    └── logger.js              # Tagged, leveled console logger
```

## Privacy and Security

- **Your API key is stored locally** in `chrome.storage.local` on your device. It is never sent to any server other than your chosen AI provider.
- **Chrome Free AI runs entirely on-device** — text is processed by Chrome's built-in Gemini Nano model. No data is ever sent over the network.
- **For other providers** (e.g., OpenAI), text you type is sent to the chosen AI provider for grammar checking. Avoid typing sensitive information in fields where the extension is active, or use `data-correctly="false"` to opt out specific elements.
- Password fields, credit card inputs, and other sensitive field types are automatically excluded.

## Want to add a new Provider?

1. Create a new file in `providers/` extending `BaseProvider`
2. Implement all required static metadata and `_doCorrectGrammar(text)`
3. Add the class to `PROVIDER_CLASSES` in `provider-registry.js`

## License

MIT
