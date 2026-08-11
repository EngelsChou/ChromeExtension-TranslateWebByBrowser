# Translate Web by Browser AI

A directly loadable Manifest V3 Chrome Extension. It identifies primary webpage content, translates English blocks into Taiwan Traditional Chinese through the user's signed-in **ChatGPT** or **Microsoft 365 Copilot** webpage, and renders bilingual or translation-only content in place. Normal use requires no npm, Node.js, command, localhost bridge, Native Messaging, or AI API.

[繁體中文](README.md)

## Installation (regular users do not need npm)

1. Download and extract `translate-web-by-browser-ai-v0.7.0.zip`.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Select **Load unpacked**:
   - Release ZIP: choose the extracted folder containing `manifest.json`.
   - GitHub **Source code ZIP**: choose its `extension/` folder.

`extension/` already contains every compiled JavaScript file. No npm or terminal command is needed after installation.

## Usage

1. Select the extension icon on the webpage to translate.
2. Choose `ChatGPT` or `Microsoft 365 Copilot`. Opening the popup or changing this selection never opens a provider automatically.
3. Choose a scope:
   - **Main content (recommended)**: identifies `main`, `article`, or `[role=main]` and excludes navigation, footers, and sidebars.
   - **Whole page**: translates every recognizable rendered block, including navigation areas.
4. Choose **Bilingual** or **Translation only**.
5. On first use, explicitly open the selected provider and personally complete sign-in, MFA, or organizational verification.
6. Return to the original page and select **Translate current page**. **Restore original** removes translations and restores the original nodes.

Translation progress remains visible at the bottom-right of the original webpage after the popup closes. Every paragraph intersecting the current viewport is placed in the first priority batch. Completed, validated paragraph objects are applied while the provider is still streaming the final strict JSON, so the visible page does not wait for the entire response or offscreen content.

ChatGPT composer submission treats its enabled Send button as the source of truth after paste/input synchronization. It does not reject visibly inserted content merely because ChatGPT exposes an empty custom `value` property.

ChatGPT uses `https://chatgpt.com/`; M365 uses `https://m365.cloud.microsoft/chat/`. If the provider composer contains a draft, the extension opens a fresh conversation instead of overwriting it.

During translation, the extension runs ChatGPT or M365 in a dedicated provider worker window without taking focus from the original page. The provider remains the active tab in that window, reducing cases where background rendering pauses until the user switches tabs. The worker closes automatically when the job finishes. If Chrome cannot create it, the extension falls back to the existing provider tab and reports a progress warning.

## Block-level architecture

```text
Current-page content script
  ├─ selects main-content or whole-page scope
  ├─ collects rendered h1-h6 / p / li / td / blockquote blocks
  ├─ includes article content outside the current viewport
  ├─ creates stable block IDs and retains original DOM children
  └─ emits only {id, text, context:{type, heading}}
           ↕ Chrome runtime messaging
Manifest V3 service worker
  ├─ puts every current-viewport paragraph in the first priority batch
  ├─ continues with up to 24 blocks / about 5,000 characters per batch
  ├─ creates an unfocused active provider worker window and closes it afterward
  ├─ requires source-page acknowledgement for each valid streamed result
  ├─ retains progress and the last error across popup closure
  ├─ revalidates complete IDs/schema and applied counts
  └─ stops safely when page rerenders invalidate mappings
           ↕ Chrome runtime messaging
Provider content script
  ├─ operates the signed-in ChatGPT / M365 composer
  ├─ adapts prompt wording for ChatGPT / M365 and requires one strict JSON object
  ├─ validates every JSON candidate, ignoring prompt examples and suggestions
  ├─ marks a paragraph sent only after the source page confirms it was applied
  └─ follows ask-bridge's M365 Stop, Copy-action, new-response, and stability signals
```

Bilingual mode preserves original links, formatting, and event nodes while inserting a separate block-level `lang="zh-Hant-TW"` translation element directly below its English block. Each streamed result is acknowledged only after this DOM update succeeds. Translation-only mode hides the retained original wrapper. Restore moves the original children back into place without reloading the page.

## Transmitted data and privacy

The extension **never sends the full HTML or DOM structure**. Each block sends only:

- a stable opaque ID
- plain text
- minimal semantic hints: element type and nearest heading

It does not send classes, CSS, events, form values, cookies, tokens, or credentials. Collection skips hidden content, scripts, styles, SVG/canvas, code, form/editable areas, `translate=no`, URLs, email addresses, numeric-only content, and text that is not primarily Latin-script.

Permissions:

- `activeTab`: accesses the current page after explicit user action.
- `scripting`: injects the page translator and provider connection scripts.
- `storage`: retains provider, scope, display mode, and session progress.
- `chatgpt.com` / `chat.openai.com`: operates the user's ChatGPT tab.
- `m365.cloud.microsoft`: operates the user's Microsoft 365 Copilot tab.

Web text is untrusted data; the prompt explicitly ignores embedded instructions. Text and responses still pass through the selected service and may remain in chat history. Account, tenant, DLP, and data-governance policies apply.

## Known limitations

- Both modes automate web UIs, not official APIs; provider DOM changes may require an update.
- Sign-in, MFA, CAPTCHA, and organizational consent require user interaction. Passwords, cookies, and tokens are never read.
- M365 requires Copilot Chat entitlement. A `/chat/blocked` redirect stops translation with an entitlement/policy error.
- Shadow DOM, cross-origin iframes, image text, placeholders, `aria-label`, and canvas content are not translated.
- If an SPA replaces blocks during translation, the extension rejects mappings that can no longer be applied; restore and retry.
- Very long individual blocks, provider usage limits, or invalid JSON may time out; invalid batches are never applied. The worker window reduces background throttling but cannot improve provider generation speed.
- Translation speed still depends on the selected provider, account capacity, and network. The on-page timer distinguishes provider waiting from a stalled extension.
- A 5-second result cannot be guaranteed for remote web providers. In the documented Microsoft Learn viewport smoke test, ChatGPT completed eight visible blocks in about 3.5 seconds, while M365 took about 16.5 seconds because its web UI exposed the response only after completion.

## Development

Node.js 22 or newer and npm are required only to modify or package the source:

```powershell
npm install
npm run check
npm run package
```

The build updates the directly loadable, version-controlled `extension/` folder and copies release files to `dist/extension/`. The release ZIP is `dist/release/translate-web-by-browser-ai-v0.7.0.zip`.
