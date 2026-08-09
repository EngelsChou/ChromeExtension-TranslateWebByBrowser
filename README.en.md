# Translate Web by ChatGPT Browser

A Manifest V3 Chrome Extension that translates visible English text nodes on the current page in place into Taiwan Traditional Chinese through an authenticated ChatGPT web session. It does not use the OpenAI API and does not support Claude, Gemini, or any other provider.

[繁體中文](README.md)

## Architecture

```text
Current webpage
  └─ content script: visibility/English filters, stable IDs, originals, in-place DOM updates
       └─ MV3 background: batches by item and character limits
            └─ thin bridge at http://127.0.0.1:17373
                 └─ official chrome-devtools-mcp 1.6.0 experimental CLI
                      └─ dedicated persistent Chrome profile → signed-in chatgpt.com
```

The extension sends only `{id, text}` to the local bridge, never the whole HTML document. The bridge requests the strict schema `{"translations":[{"id","text"}]}` and rejects missing, duplicate, unknown IDs, empty translations, and invalid types. Requests are serialized so replies from multiple pages cannot overlap.

## Requirements

- Current stable Google Chrome (other Chromium browsers are not guaranteed by `chrome-devtools-mcp`)
- Node.js 22 or newer and npm
- A ChatGPT account that can sign in and send messages
- Local port `127.0.0.1:17373`

The project pins `chrome-devtools-mcp` 1.6.0. See its [official README](https://github.com/ChromeDevTools/chrome-devtools-mcp) for supported browsers and browser-data risks. Its [CLI documentation](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/cli.md) explicitly labels the CLI experimental.

## Installation and ChatGPT connection

1. Install and verify:

   ```powershell
   npm install
   npm run check
   npm run package
   ```

2. Start the dedicated Chrome session:

   ```powershell
   npm run chatgpt:start
   ```

   The official CLI opens Chrome with `.chatgpt-profile/` and navigates to `https://chatgpt.com/`. On first use, sign in and complete any verification manually in that window, then keep it open. The local profile is ignored by Git.

3. Start the local bridge in a second terminal:

   ```powershell
   npm run bridge
   ```

4. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select:

   ```text
   <repository>\dist\extension
   ```

   You can also extract `dist/release/translate-web-by-chatgpt-browser-v0.1.0.zip` and load it. The ZIP root is Chrome Extension release-ready; the local bridge must still be run from the repository.

## Usage

1. Keep the dedicated signed-in ChatGPT Chrome window and the bridge running.
2. Open the popup on the page to translate.
3. When it reports **Connected**, select **Translate current page**.
4. Select **Restore original** to restore text nodes translated during the current page lifetime.

The scanner skips hidden and off-viewport content, form controls, editable areas, code, `script/style/svg`, URL/email/numeric-only text, and content that is not primarily Latin-script. Run translation again after scrolling or an SPA update; detached old nodes are cleaned up.

## Security and privacy

- Only filtered visible English plain text and locally generated IDs are sent to ChatGPT. HTML, cookies, browser storage, and form values are not sent.
- Webpage text is treated as untrusted. The prompt says to ignore instructions inside text and translate it as data. This reduces but cannot eliminate prompt-injection risk.
- The bridge binds only to loopback and rejects browser origins other than `chrome-extension://`. Optionally lock it to one unpacked extension ID:

  ```powershell
  $env:BRIDGE_EXTENSION_ID='your-extension-id'
  npm run bridge
  ```

- The dedicated profile retains ChatGPT sign-in state. Never share `.chatgpt-profile/`, and do not browse other sensitive sites in that window.
- The user explicitly starts local processes; the Chrome Extension never attempts to launch an executable.
- Inputs and outputs remain subject to the ChatGPT plan, OpenAI policies, usage limits, and data controls. Do not use this project to bypass restrictions.

## Known limitations

- ChatGPT does not expose a stable, official web-automation API for this project. This mode operates the live UI and may break when ChatGPT changes its DOM, sign-in flow, verification, or control labels.
- The official `chrome-devtools-mcp` CLI remains experimental. Version 1.6.0 is pinned and upgrades should be fully retested.
- ChatGPT can return invalid JSON, omit items, or time out. The bridge validates and retries once, then stops the batch with an error rather than applying unverified output.
- Only English text nodes visible in the viewport are translated. Lazy-loaded content requires another translation run after scrolling.
- Shadow DOM, cross-origin iframes, canvas, image text, placeholders, `aria-label`, and attributes are not translated.
- Dynamic frameworks may overwrite translated DOM during rerenders. Restore works only while the same content script and connected nodes remain alive.
- A batch contains at most 30 segments and about 6,000 characters. Speed and capacity depend on the ChatGPT web session.

## Development, tests, and packaging

```powershell
npm run build
npm run lint
npm test
npm run package
```

`npm run check` runs build, lint, and test in order. The release ZIP is written to `dist/release/`. Use `npm run chatgpt:stop` to stop the dedicated browser daemon and `npm run chatgpt:status` to inspect it.
