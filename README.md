# Correctly

A minimalist Chrome extension that checks grammar, spelling, and punctuation using AI. Bring your own API key.

<img width="334" height="523" alt="image" src="https://github.com/user-attachments/assets/fd299824-941c-4c09-a1cb-351914602b92" />
<img width="358" height="556" alt="image" src="https://github.com/user-attachments/assets/4ff66285-56b7-4c94-bdf2-58f3bd0b7a00" />



## Features

- Works on any text input, textarea, or contentEditable element
- Inline correction tooltip with accept/dismiss per suggestion
- Supports OpenAI (extensible to other providers)
- Custom model selection - use any model your provider supports
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
5. Click the extension icon, enter your OpenAI API key, and save

## Project Structure

```
correctly/
├── manifest.json
├── background/
│   └── service-worker.js      # Message routing, badge, provider orchestration
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
│   └── provider-registry.js   # Provider lookup and creation
└── lib/
    ├── config.js              # Shared configuration
    └── logger.js              # Tagged, leveled console logger
```

## Privacy and Security

- **Your API key is stored locally** in `chrome.storage.local` on your device. It is never sent to any server other than your chosen AI provider.
- **Text you type is sent to the AI provider** (e.g., OpenAI) for grammar checking. Avoid typing sensitive information in fields where the extension is active, or use `data-correctly="false"` to opt out specific elements.
- Password fields, credit card inputs, and other sensitive field types are automatically excluded.

## Adding a Provider

1. Create a new file in `providers/` extending `BaseProvider`
2. Implement all required static metadata and `_doCorrectGrammar(text)`
3. Add the class to `PROVIDER_CLASSES` in `provider-registry.js`

## License

MIT
