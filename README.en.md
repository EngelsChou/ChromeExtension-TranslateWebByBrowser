# Translate Web by Browser AI

A self-contained Manifest V3 Chrome Extension. It captures visible English text nodes, translates them into Taiwan Traditional Chinese through a signed-in **ChatGPT** or **Microsoft 365 Copilot** webpage selected by the user, and replaces the text in place. Normal use requires no npm, Node.js, command, localhost bridge, Native Messaging, or AI API.

[繁體中文](README.md)

## Installation (regular users do not need npm)

1. Download and extract `translate-web-by-browser-ai-v0.3.2.zip`.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Select **Load unpacked**:
   - For the release ZIP, choose the extracted folder that directly contains `manifest.json`.
   - For GitHub's **Source code ZIP**, choose its `extension/` folder.

The `extension/` folder includes every compiled JavaScript file referenced by the manifest; no build is required. If Chrome reports a missing `chatgpt-content.js`, the source is v0.3.0 or older—download v0.3.1 or later.

After installation, use only the extension icon; no command needs to be run for each use. npm is only for developers modifying and repackaging the source.

## Usage

1. Select the extension icon on the webpage to translate.
2. Choose `ChatGPT` or `Microsoft 365 Copilot`; the selection is retained in local Chrome storage. Merely opening the popup or changing the selection never creates, opens, or activates a provider tab.
3. On first use, confirm the provider and then select its sign-in button. Only this explicit action opens the selected service for sign-in, MFA, or organizational verification.
4. Return to the original page, reopen the popup, and select **Translate current page**.
5. Select **Restore original** to restore text nodes translated during the current page lifetime.

ChatGPT uses `https://chatgpt.com/`; M365 uses `https://m365.cloud.microsoft/chat/`. Status checks only inspect existing tabs. The extension reuses or creates the selected service tab only after sign-in or translation is explicitly selected. If its composer contains a draft, it opens a fresh conversation rather than overwriting user text.

## Architecture

```text
Current-page content script
  ├─ filters visible, primarily English text nodes in the viewport
  ├─ creates stable ID mappings, retains originals, supports restore
  └─ emits only {id, text}
           ↕ Chrome runtime messaging
Manifest V3 service worker
  ├─ popup status checks inspect existing tabs without opening a provider
  ├─ finds or creates the selected provider only after sign-in/translation
  ├─ batches up to 30 segments and about 6,000 characters
  └─ revalidates the complete ID/schema before applying results
           ↕ Chrome runtime messaging
Provider-specific content script
  ├─ operates the signed-in web composer and send control
  ├─ requests strict JSON and retries once after failure
  └─ rejects missing, duplicate, unknown IDs, bad types, and empty text
```

The full HTML document is never sent. Collection skips off-viewport or hidden content, scripts, styles, SVG/canvas, code, form/editable controls, URLs, email addresses, numeric-only text, and text that is not primarily Latin-script. IDs derive from the page path, DOM position, and original text. Originals remain only in the target tab's content-script memory.

## Permissions, security, and privacy

- `activeTab`: accesses the current page after an explicit extension action.
- `scripting`: injects the page translator and reconnects provider-tab scripts.
- `storage`: stores only the selected provider.
- `chatgpt.com` / `chat.openai.com`: operates the user's ChatGPT tab.
- `m365.cloud.microsoft`: operates the user's Microsoft 365 Copilot tab.
- There is no `<all_urls>`, localhost, Native Messaging, local executable, or API-key permission.
- Web text is untrusted data. The prompt says to ignore embedded instructions and translate the text only. This reduces but cannot eliminate prompt-injection risk.
- Text and responses pass through the selected account and may remain in chat history. Provider plans, data controls, organizational policies, and usage limits apply. Follow tenant governance and DLP rules when using a corporate M365 account.
- Do not translate confidential, personal, or third-party material that you are not authorized to send to the selected service.

## Known limitations

- Both modes automate web UIs, not official APIs. Provider DOM, sign-in, controls, and response changes may require an extension update.
- Sign-in, MFA, CAPTCHA, and organizational consent require user interaction. The extension never reads passwords, cookies, or tokens.
- M365 requires Copilot Chat entitlement and an enabled tenant policy. A redirect to `/chat/blocked` stops translation and reports an entitlement/policy error.
- Microsoft 365 rich-text editors can reject synthetic input in some organizational deployments. The extension fails before send in that case and intentionally does not fall back to a local bridge.
- Chrome may throttle background tabs. Invalid JSON, usage limits, and timeouts are retried once; an invalid batch is never applied.
- Shadow DOM, cross-origin iframes, image text, placeholders, `aria-label`, and other attributes are not translated. SPA rerenders can overwrite translations; restore applies only to nodes retained by the same content script.

## Development

Node.js 22 or newer and npm are required only to modify or package the source:

```powershell
npm install
npm run check
npm run package
```

`npm run check` runs build, lint, and test in order. The build updates the directly loadable, version-controlled `extension/` folder and copies release staging files to `dist/extension/`. The release ZIP is `dist/release/translate-web-by-browser-ai-v0.3.2.zip`.
