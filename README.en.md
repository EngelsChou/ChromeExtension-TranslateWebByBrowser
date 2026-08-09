# Translate Web by ChatGPT Browser

A self-contained Manifest V3 Chrome Extension. It captures visible English text nodes on the current page, translates them into Taiwan Traditional Chinese through a signed-in ChatGPT tab in the same Chrome profile, and replaces them in place. It does not use the OpenAI API, a localhost bridge, Native Messaging, a Node.js runtime, or another AI provider.

[繁體中文](README.md)

## Regular users do not need npm

Normal use only requires loading the extension:

1. Download and extract `translate-web-by-chatgpt-browser-v0.2.0.zip`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the extracted folder.

No terminal, command, or Node.js installation is required afterward. npm commands are only for developers changing the source code.

## Usage

1. Select the extension icon on the webpage to translate.
2. The extension finds or creates a `chatgpt.com` tab in the background.
3. On first use, select **Open ChatGPT to sign in**, complete sign-in in that tab, and return to the original page.
4. Open the popup again and select **Translate current page**.
5. Select **Restore original** to restore text nodes translated during the current page lifetime.

The normal Chrome profile retains the ChatGPT sign-in. Future use only requires selecting the extension; no service needs to be started.

## Architecture

```text
Current webpage
  └─ target content script
       ├─ filters visible, primarily English text nodes in the viewport
       ├─ creates and retains stable ID mappings
       └─ stores originals, applies translations, and restores originals
             ↕ Chrome runtime messaging
       Manifest V3 service worker
       ├─ finds or opens a background ChatGPT tab
       ├─ sends text in batches
       └─ revalidates IDs and schema before applying results
             ↕ Chrome runtime messaging
       ChatGPT content script
       ├─ operates the signed-in ChatGPT composer
       ├─ requests strict JSON
       ├─ waits for the complete response and retries once
       └─ rejects missing, duplicate, unknown IDs, invalid types, and empty text
```

A batch contains at most 30 segments and about 6,000 characters. Only `{id, text}` is sent to ChatGPT, never the full HTML document.

## Collection and restore behavior

The scanner skips:

- off-viewport or CSS-hidden content
- `script`, `style`, `svg`, `canvas`, and code blocks
- form controls and editable regions
- URLs, email addresses, and numeric-only content
- text that is not primarily Latin-script

Text node IDs derive from the page path, DOM position, and original text. Repeated scans reuse the existing mapping for the same node. Originals remain in content-script memory and are not written into the page HTML or uploaded. SPA rerenders may overwrite translations; run translation again after scrolling to newly visible content.

## Permissions, security, and privacy

- `activeTab`: accesses the current page only after the user selects the extension.
- `scripting`: injects the current-page translator and reconnects to an already-open ChatGPT tab when needed.
- `https://chatgpt.com/*` and `https://chat.openai.com/*`: finds, opens, and operates the user's own ChatGPT tab.
- The extension has no `<all_urls>`, localhost, Native Messaging, or local executable permission.
- Webpage text is treated as untrusted data. The prompt says to ignore instructions inside the text and translate it as data. This reduces but cannot eliminate prompt-injection risk.
- Translation text and ChatGPT responses pass through the user's ChatGPT account and may remain in that conversation history. The user's ChatGPT plan, data controls, policies, and usage limits apply.
- Do not translate confidential, personal, or third-party material that you are not authorized to send to ChatGPT.

## Known limitations

- This automates the ChatGPT web UI; it is not an official OpenAI API. Changes to ChatGPT's DOM, sign-in flow, verification, controls, or message structure may require an extension update.
- First use still requires the user to sign in personally. The extension does not read or store passwords, cookies, or tokens.
- The ChatGPT tab must remain open. The extension reuses it and prevents automatic discarding; if closed, a new tab is created next time.
- Chrome may throttle a background tab, so speed depends on browser and ChatGPT state.
- ChatGPT can return invalid JSON, omit items, reach a usage limit, or time out. The extension retries once and then stops the batch rather than applying unvalidated output.
- Shadow DOM, cross-origin iframes, image text, placeholders, `aria-label`, and other attributes are not translated.
- After dynamic rerenders, restore only applies to connected nodes retained by the same content script.

## Development

Node.js 22 or newer and npm are only needed to modify or package the source:

```powershell
npm install
npm run build
npm run lint
npm test
npm run package
```

`npm run check` runs build, lint, and test in order. The unpacked build is written to `dist/extension/`, and the release ZIP to `dist/release/translate-web-by-chatgpt-browser-v0.2.0.zip`.
