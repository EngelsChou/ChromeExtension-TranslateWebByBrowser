# Translate Web by Browser AI

A directly loadable Manifest V3 Chrome Extension. It identifies primary webpage content, translates English blocks into Taiwan Traditional Chinese through the user's signed-in **ChatGPT** or **Microsoft 365 Copilot** webpage, and renders bilingual or translation-only content in place. Normal use requires no npm, Node.js, command, localhost bridge, Native Messaging, or AI API.

[繁體中文](README.md)

## Installation (regular users do not need npm)

1. Download and extract `translate-web-by-browser-ai-v0.8.13.zip`.
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
   - **Visible whole page (including menus)**: translates recognizable blocks plus visible English text nodes without Han characters in navigation, sidebars, menus, buttons, and links.
4. Choose **Bilingual** or **Translation only**.
5. On first use, explicitly open the selected provider and personally complete sign-in, MFA, or organizational verification.
6. Return to the original page and select **Translate current page**. **Restore original** removes translations and restores the original nodes.

Translation progress remains visible at the bottom-right of the original webpage after the popup closes. The fast first batch contains exactly one nearest viewport block and uses a compact, security-preserving JSON prompt without context overhead. Follow-up viewport batches are capped at 4 blocks / about 1,000 characters, while offscreen batches are capped at 12 blocks / about 2,400 characters, avoiding long periods without visible updates and reducing truncated provider responses. ChatGPT and M365 are explicitly told not to browse, research, or use tools for this text-only task and are polled every 150 ms until the first validated item arrives. Completed, validated paragraph objects are applied while the provider is still streaming the final strict JSON. M365 streaming candidates are read from both the final Copilot message and its temporary live-output paragraphs, while user-authored prompts and the composer are explicitly excluded.

ChatGPT composer submission treats its enabled Send button as the source of truth after paste/input synchronization. It does not reject visibly inserted content merely because ChatGPT exposes an empty custom `value` property.

Before submitting a translation, the ChatGPT worker switches from **Work** to **Chat/Conversation** when that interface selector is available. The extension does not change the selected model, reasoning level, or paid fast-mode setting. This avoids task-planning overhead for a direct text transformation.

ChatGPT uses `https://chatgpt.com/`; M365 uses `https://m365.cloud.microsoft/chat/`. If the provider composer contains a draft, the extension opens a fresh conversation instead of overwriting it.

During translation, the extension opens a clean new conversation at the provider's official home URL using the shared signed-in session, then runs it in a dedicated worker window without taking focus from the original page. It does not duplicate a custom GPT, project, or existing conversation, avoiding inherited instructions and history that can delay translation. The provider remains the active tab in that window, reducing cases where background rendering pauses until the user switches tabs. The worker closes automatically when the job finishes. If Chrome cannot create it, the extension uses another clean provider-home background tab and reports a progress warning; it falls back to the existing provider tab only when that clean fallback also cannot be created.

The extension uses provider-specific background wake timing. ChatGPT is surfaced when its first batch has produced no validated Chinese after 8 seconds; M365 is surfaced about 1 second after submission because its background worker is more prone to delay. The source page is restored as soon as the first translation arrives, and the progress card and popup report the measured “first batch N seconds.” This happens only while the user remains in the original Chrome window; switching to a game or another application prevents the extension from taking system focus.

The M365 Lexical/contenteditable composer waits for asynchronous paste handling to settle before attempting a clean `insertText` fallback, preventing the same prompt from being inserted twice. It clears the previous attempt before every fallback and parses the `INPUT` / `INPUT_JSON` payload before submission to confirm the data is complete and appears exactly once. After clicking Send, it requires the composer to clear or generation to start within a few seconds; otherwise it tries Enter as a fallback and fails quickly for retry instead of waiting for the entire batch timeout.

## Block-level architecture

```text
Current-page content script
  ├─ selects main-content or whole-page scope
  ├─ collects rendered h1-h6 / p / li / td / blockquote blocks
  ├─ in whole-page mode, also collects visible viewport English menu/control text nodes
  ├─ excludes text nodes already covered by a block to prevent duplicate requests
  ├─ includes article content outside the current viewport
  ├─ creates stable block IDs and retains original DOM children
  └─ emits only {id, text, context:{type, heading}}
           ↕ Chrome runtime messaging
Manifest V3 service worker
  ├─ limits the fast first batch to 1 nearest viewport block
  ├─ keeps viewport follow-up batches at up to 4 blocks / about 1,000 characters
  ├─ continues offscreen content at up to 12 blocks / about 2,400 characters
  ├─ creates an unfocused active provider worker window and closes it afterward
  ├─ requires source-page acknowledgement for each valid streamed result
  ├─ bounds every batch and the whole translation job with hard timeouts
  ├─ splits and retries only IDs that have not already been applied
  ├─ retains progress and the last error across popup closure
  ├─ revalidates complete IDs/schema and applied counts
  └─ stops safely when page rerenders invalidate mappings
           ↕ Chrome runtime messaging
Provider content script
  ├─ operates the signed-in ChatGPT / M365 composer
  ├─ adapts prompt wording for ChatGPT / M365 and requires one strict JSON object
  ├─ validates every JSON candidate, ignoring prompt examples and suggestions
  ├─ deduplicates nested/repeated M365 DOM candidates by ID before streaming
  ├─ marks a paragraph sent only after the source page confirms it was applied
  └─ follows ask-bridge's M365 Stop, Copy-action, new-response, and stability signals
```

Bilingual mode preserves original links, formatting, and event nodes while inserting a separate block-level `lang="zh-Hant-TW"` translation element directly below its English block. Each streamed result is acknowledged only after this DOM update succeeds. Translation-only mode hides the retained original wrapper. Restore moves the original children back into place without reloading the page.

## Transmitted data and privacy

The extension **never sends the full HTML or DOM structure**. Each block or visible UI text sends only:

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
- Very long blocks, provider limits, or invalid JSON may time out. A provider response is limited to 55 seconds, a background batch to 120 seconds, and the whole job to 8 minutes. Stored work with no progress for 150 seconds is marked failed instead of displaying an hours- or days-long timer.
- On a batch failure, already applied Chinese remains visible. Only unfinished IDs are split into smaller retry batches, up to two levels; a final error reports the remaining count and still allows retry or restore.
- Translation speed still depends on the selected provider, account capacity, and network. The on-page timer distinguishes provider waiting from a stalled extension.
- Remote web providers cannot guarantee a fixed latency. In the v0.8.12 66-block Microsoft Learn run, ChatGPT showed its first batch in about 8–9 seconds and finished in about 86 seconds; M365 finished in about 177 seconds. v0.8.13 wakes M365 after about 1 second to reduce first-result latency, but the measured time still depends on the company account, network, and current Copilot load and is shown directly in the progress card.

## Development

Node.js 22 or newer and npm are required only to modify or package the source:

```powershell
npm install
npm run check
npm run package
```

The build updates the directly loadable, version-controlled `extension/` folder and copies release files to `dist/extension/`. The release ZIP is `dist/release/translate-web-by-browser-ai-v0.8.13.zip`.

## YouTube captions and transcripts

- For a captioned YouTube video, open **Show transcript**, then select **Visible whole page (including menus)**. The extension translates transcript rows, buttons, and menus currently visible in the viewport. Scroll the transcript and translate again for newly visible rows.
- Live per-line AI captions over the player are not currently supported. ChatGPT/M365 web UIs can take several to tens of seconds to respond, by which time the player caption may have changed.
- YouTube's official caption download API requires OAuth, and downloading requires permission to edit the video. This project will not add API keys, read login tokens, or bypass those permissions.
- References: [YouTube: View video transcripts](https://support.google.com/youtube/answer/15930243?hl=en), [YouTube Captions API](https://developers.google.com/youtube/v3/docs/captions/download).
