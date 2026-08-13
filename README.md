# Translate Web by Browser AI

可直接載入 Chrome 的 Manifest V3 Extension。它辨識網頁主要內容，將英文段落透過使用者已登入的 **ChatGPT** 或 **Microsoft 365 Copilot** 網頁翻成台灣繁體中文，並以雙語對照或只顯示翻譯的方式原地呈現。一般使用不需要 npm、Node.js、指令、localhost bridge、Native Messaging 或 AI API。

[English ↓](#english)

## 安裝（一般使用者不需要 npm）

1. 下載並解壓縮 `translate-web-by-browser-ai-v0.8.0.zip`。
2. 開啟 `chrome://extensions`，啟用「開發人員模式」。
3. 選擇「載入未封裝項目」：
   - 發布 ZIP：選擇解壓縮後直接含有 `manifest.json` 的資料夾。
   - GitHub **Source code ZIP**：選擇其中的 `extension/` 資料夾。

`extension/` 已包含所有編譯後 JavaScript。完成後只需按 Extension 圖示，不必執行 npm 或終端指令。

## 使用方式

1. 在要翻譯的網頁按 Extension 圖示。
2. 選擇 `ChatGPT` 或 `Microsoft 365 Copilot`。開啟 popup 或切換選項不會自動開啟任何 provider。
3. 選擇翻譯範圍：
   - **主要內容（建議）**：辨識 `main`、`article`、`[role=main]`，排除導覽列、頁尾與側欄。
   - **整頁可見文字（含選單）**：翻譯所有可辨識段落，並加入當下視窗可見、且不含漢字的英文 Text Nodes，例如導覽列、側欄、功能選單、按鈕與連結。
4. 選擇 **雙語對照** 或 **只顯示翻譯**。
5. 第一次使用時，確認 provider 後按登入按鈕，親自完成登入、MFA 或組織驗證。
6. 回到原網頁，按「翻譯目前頁面」。按「恢復原文」可完整移除翻譯並還原原始節點。

ChatGPT 使用 `https://chatgpt.com/`；M365 使用 `https://m365.cloud.microsoft/chat/`。若 provider 輸入框已有草稿，Extension 會建立新對話，避免覆寫使用者內容。

開始翻譯後，Extension 會在不搶走原網頁焦點的獨立 provider 工作視窗中執行 ChatGPT 或 M365。這讓 provider 頁面保持為該視窗的作用中分頁，減少背景分頁停止重繪而必須手動切換分頁的情況；工作完成後視窗會自動關閉。若 Chrome 無法建立工作視窗，會回退使用既有 provider 分頁並在進度中顯示警告。

## 段落級架構

```text
目前網頁 content script
  ├─ 尋找主要內容或整頁範圍
  ├─ 擷取 h1-h6 / p / li / td / blockquote 等已渲染段落
  ├─ 整頁模式另外擷取 viewport 內可見的英文選單／控制項 Text Nodes
  ├─ 排除已由段落涵蓋的 Text Nodes，避免同一文字重複送出
  ├─ 包含 viewport 外的文章內容，不只翻譯目前畫面
  ├─ 產生穩定 block ID，保存原始 DOM children
  └─ 只輸出 {id, text, context:{type, heading}}
           ↕ Chrome runtime messaging
Manifest V3 service worker
  ├─ 當下可視區的所有段落都放入第一個優先批次
  ├─ 後續每批最多 24 段、約 5,000 字元
  ├─ 建立不搶焦點的作用中 provider 工作視窗，完成後自動關閉
  ├─ 每收到一組合法翻譯，就要求原網頁確認已套用
  ├─ 保存進度與最後錯誤，popup 關閉後仍可查詢
  ├─ 再次驗證完整 ID/schema 與實際套用數量
  └─ 網頁重繪造成 mapping 失效時安全停止
           ↕ Chrome runtime messaging
Provider content script
  ├─ 操作已登入的 ChatGPT / M365 composer
  ├─ 依 ChatGPT／M365 調整提示語氣，並嚴格要求單一 JSON object
  ├─ 逐一驗證 JSON 候選，不會誤用 prompt 範例或建議按鈕
  ├─ M365 的巢狀／重複 DOM 回覆候選會先依 ID 去重再串流
  ├─ 收到原網頁套用確認後，才把該段落標記為已傳送
  └─ M365 參考 ask-bridge：使用 Stop、Copy action、新回覆與穩定度判斷完成
```

雙語模式會保留段落原有連結、格式與事件節點，再插入獨立的 `lang="zh-Hant-TW"` 翻譯元素；只顯示翻譯模式則隱藏原始 wrapper。恢復時會把原始 children 移回原位，不使用重新載入頁面。

## 傳送內容與隱私

Extension **不傳送整頁 HTML 或 DOM 結構**。每個段落或可見介面文字只傳送：

- 穩定隨機式 ID
- 純文字
- 最小語意提示：元素類型與最近標題

它不傳送 class、CSS、事件、表單值、Cookie、token 或登入資料。掃描會略過隱藏內容、`script`、`style`、`svg`、`canvas`、程式碼、表單/可編輯區域、`translate=no`、URL、email、純數字與非拉丁字母為主的文字。

權限用途：

- `activeTab`：使用者操作後存取目前頁面。
- `scripting`：注入頁面 translator 與 provider 連線程式。
- `storage`：保存 provider、翻譯範圍、顯示方式及工作階段進度。
- `chatgpt.com` / `chat.openai.com`：操作使用者自己的 ChatGPT 分頁。
- `m365.cloud.microsoft`：操作使用者自己的 Microsoft 365 Copilot 分頁。

網頁文字一律視為不可信資料；prompt 明確要求忽略文字中的指令。文字與回覆仍會經過所選服務並可能保留在對話紀錄中，請遵守帳戶、租用戶、DLP 與資料治理政策。

## 已知限制

- 兩種模式都是網頁 UI 自動化，不是官方 API；provider DOM 改版時可能需要更新。
- 登入、MFA、CAPTCHA 與組織同意必須由使用者處理；Extension 不讀取密碼、Cookie 或 token。
- M365 必須具有 Copilot Chat 權限；導向 `/chat/blocked` 時會停止並顯示授權/政策錯誤。
- 不翻譯 shadow DOM、cross-origin iframe、圖片文字、placeholder、`aria-label` 或 canvas 內容。
- SPA 若在翻譯期間替換段落，Extension 會拒絕套用失去 mapping 的批次；可恢復後重試。
- 超長單一段落、provider 用量限制或無效 JSON 可能造成逾時；失敗批次不會套用。獨立工作視窗可降低背景分頁節流，但無法改變 provider 本身的回覆速度。

## 開發

只有修改或重新打包時才需要 Node.js 22 以上與 npm：

```powershell
npm install
npm run check
npm run package
```

build 會更新可直接載入且納入版本控制的 `extension/`，並複製發布內容至 `dist/extension/`。發布 ZIP 位於 `dist/release/translate-web-by-browser-ai-v0.8.0.zip`。

## YouTube 字幕與文字記錄

- 在有字幕的 YouTube 影片開啟「顯示文字記錄」，再選擇「整頁可見文字（含選單）」；Extension 可翻譯當下視窗中可見的文字記錄行、按鈕與功能選單。捲動文字記錄後可再次翻譯新出現的行。
- 目前不提供播放器上的即時逐句 AI 字幕。ChatGPT／M365 網頁 UI 通常需要數秒至數十秒才回覆，字幕可能已切換，無法可靠同步。
- YouTube 官方字幕下載 API 需要 OAuth；下載字幕還要求帳戶具備影片編輯權限，因此本專案不會加入 API key、讀取登入 token 或繞過權限。
- 參考：[YouTube 顯示影片文字記錄說明](https://support.google.com/youtube/answer/15930243?hl=zh-Hant)、[YouTube Captions API](https://developers.google.com/youtube/v3/docs/captions/download)。

## 翻譯速度與進度

- popup 關閉後，原網頁右下角仍會顯示目前階段、已經過秒數、批次與已套用段落數。
- 目前視窗內相交的每個標題、段落與清單項目都會進入第一個優先批次；畫面外內容稍後才處理。
- 最終回覆仍須是嚴格 JSON；但串流中每產生一個完整且通過 ID/schema/繁中驗證的段落物件，就會立即插入原網頁。雙語模式固定把中文放在該段英文下方，而且 provider 必須收到原網頁套用確認後才能繼續。
- ChatGPT 最新 composer 已加入 paste/input 狀態同步；內容寫入後以實際啟用的傳送按鈕為準，不再因空的 `value` 屬性誤判失敗。若按鈕沒有啟用，會快速失敗，不再空等 180 秒。
- 實際等待時間仍取決於 provider、帳號負載與網路。獨立 provider 工作視窗會保持為作用中分頁且不搶走原網頁焦點，以降低必須手動切換分頁才顯示回覆的情況。
- 遠端網頁 provider 無法保證每次都在 5 秒內完成。本機 Microsoft Learn 可視區 8 段實測：ChatGPT 約 3.5 秒全部完成；M365 約 16.5 秒，因其網頁 UI 直到回覆完成才提供可讀內容。

---

<a id="english"></a>

# English

A directly loadable Manifest V3 Chrome Extension. It identifies primary webpage content, translates English blocks into Taiwan Traditional Chinese through the user's signed-in **ChatGPT** or **Microsoft 365 Copilot** webpage, and renders bilingual or translation-only content in place. Normal use requires no npm, Node.js, command, localhost bridge, Native Messaging, or AI API.

[繁體中文 ↑](#translate-web-by-browser-ai) · [Standalone English README](README.en.md)

## Installation (regular users do not need npm)

1. Download and extract `translate-web-by-browser-ai-v0.8.0.zip`.
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

Translation progress remains visible at the bottom-right of the original webpage after the popup closes. Every paragraph intersecting the current viewport is placed in the first priority batch. Completed, validated paragraph objects are applied while the provider is still streaming the final strict JSON, so the visible page does not wait for the entire response or offscreen content.

ChatGPT composer submission treats its enabled Send button as the source of truth after paste/input synchronization. It does not reject visibly inserted content merely because ChatGPT exposes an empty custom `value` property.

ChatGPT uses `https://chatgpt.com/`; M365 uses `https://m365.cloud.microsoft/chat/`. If the provider composer contains a draft, the extension opens a fresh conversation instead of overwriting it.

During translation, the extension runs ChatGPT or M365 in a dedicated provider worker window without taking focus from the original page. The provider remains the active tab in that window, reducing cases where background rendering pauses until the user switches tabs. The worker closes automatically when the job finishes. If Chrome cannot create it, the extension falls back to the existing provider tab and reports a progress warning.

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

The build updates the directly loadable, version-controlled `extension/` folder and copies release files to `dist/extension/`. The release ZIP is `dist/release/translate-web-by-browser-ai-v0.8.0.zip`.

## YouTube captions and transcripts

- For a captioned YouTube video, open **Show transcript**, then select **Visible whole page (including menus)**. The extension translates transcript rows, buttons, and menus currently visible in the viewport. Scroll the transcript and translate again for newly visible rows.
- Live per-line AI captions over the player are not currently supported. ChatGPT/M365 web UIs can take several to tens of seconds to respond, by which time the player caption may have changed.
- YouTube's official caption download API requires OAuth, and downloading requires permission to edit the video. This project will not add API keys, read login tokens, or bypass those permissions.
- References: [YouTube: View video transcripts](https://support.google.com/youtube/answer/15930243?hl=en), [YouTube Captions API](https://developers.google.com/youtube/v3/docs/captions/download).
