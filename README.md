# Translate Web by Browser AI

可直接載入 Chrome 的 Manifest V3 Extension。它辨識網頁主要內容，將英文段落透過使用者已登入的 **ChatGPT** 或 **Microsoft 365 Copilot** 網頁翻成台灣繁體中文，並以雙語對照或只顯示翻譯的方式原地呈現。一般使用不需要 npm、Node.js、指令、localhost bridge、Native Messaging 或 AI API。

[English ↓](#english)

## 安裝（一般使用者不需要 npm）

1. 下載並解壓縮 `translate-web-by-browser-ai-v0.8.12.zip`。
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

開始翻譯後，Extension 會以共享的登入狀態開啟 provider 官方首頁的乾淨新對話，再放入不搶走原網頁焦點的獨立工作視窗中執行 ChatGPT 或 M365。工作頁不會複製自訂 GPT、專案或既有對話，避免繼承額外指示與歷史造成延遲。這讓 provider 頁面保持為該視窗的作用中分頁，減少背景分頁停止重繪而必須手動切換分頁的情況；工作完成後視窗會自動關閉。若 Chrome 無法建立工作視窗，會改用同樣乾淨的 provider 首頁背景分頁並在進度中顯示警告；只有連乾淨備援頁也無法建立時，才最後回退既有分頁。

若第一批超過 8 秒仍沒有任何有效中文，而且使用者仍停留在原本的 Chrome 視窗，Extension 會自動短暫喚醒 provider 工作視窗；收到第一筆翻譯後立即切回原網頁。這用來處理 ChatGPT／M365 在被遮住的背景視窗暫停更新 DOM 的情況。若使用者已切到遊戲或其他應用程式，Extension 不會搶走系統焦點。

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
  ├─ 第一個快速批次只送 1 個最接近當下視窗的段落
  ├─ 其餘可視區段落仍排在畫面外內容之前
  ├─ 畫面內每批最多 4 段／約 1,000 字元，畫面外最多 12 段／約 2,400 字元
  ├─ 建立不搶焦點的作用中 provider 工作視窗，完成後自動關閉
  ├─ 每收到一組合法翻譯，就要求原網頁確認已套用
  ├─ 每批都有最長等待時間，整體工作最長 8 分鐘
  ├─ 失敗時只把尚未完成的 ID 拆成更小批次重試
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
- 超長單一段落、provider 用量限制或無效 JSON 可能造成逾時。每次 provider 回覆最多等待 55 秒、每批背景工作最多 120 秒，整體工作最多 8 分鐘；超過 150 秒沒有任何進度的舊工作會自動標示為失敗，不會再顯示數小時或數天的計時。
- 批次失敗時，已成功顯示的中文會保留；Extension 只把尚未完成的 ID 拆小重試，最多兩層。仍失敗時會清楚回報剩餘數量，可直接再試或恢復原文。

## 開發

只有修改或重新打包時才需要 Node.js 22 以上與 npm：

```powershell
npm install
npm run check
npm run package
```

build 會更新可直接載入且納入版本控制的 `extension/`，並複製發布內容至 `dist/extension/`。發布 ZIP 位於 `dist/release/translate-web-by-browser-ai-v0.8.12.zip`。

## YouTube 字幕與文字記錄

- 在有字幕的 YouTube 影片開啟「顯示文字記錄」，再選擇「整頁可見文字（含選單）」；Extension 可翻譯當下視窗中可見的文字記錄行、按鈕與功能選單。捲動文字記錄後可再次翻譯新出現的行。
- 目前不提供播放器上的即時逐句 AI 字幕。ChatGPT／M365 網頁 UI 通常需要數秒至數十秒才回覆，字幕可能已切換，無法可靠同步。
- YouTube 官方字幕下載 API 需要 OAuth；下載字幕還要求帳戶具備影片編輯權限，因此本專案不會加入 API key、讀取登入 token 或繞過權限。
- 參考：[YouTube 顯示影片文字記錄說明](https://support.google.com/youtube/answer/15930243?hl=zh-Hant)、[YouTube Captions API](https://developers.google.com/youtube/v3/docs/captions/download)。

## 翻譯速度與進度

- popup 關閉後，原網頁右下角仍會顯示目前階段、已經過秒數、批次與已套用段落數。
- 第一個快速批次只送出最接近目前視窗的 1 個段落，並使用省略 context 負擔但仍保留不可信資料、安全限制與嚴格 JSON 的精簡提示。後續畫面內批次最多 4 段／約 1,000 字元，畫面外批次最多 12 段／約 2,400 字元，避免大批次長時間沒有畫面更新或回覆被截斷。提示會明確要求 ChatGPT 與 M365 不搜尋、不調查、不使用工具，直接完成文字翻譯；在第一筆通過驗證的翻譯出現前每 150 毫秒檢查一次。M365 同時讀取正式 Copilot 訊息與暫時的即時輸出段落，並明確排除使用者提示與輸入框；只要收到有效 ID 的中文，就立即插入原頁英文下方。
- 最終回覆仍須是嚴格 JSON；但串流中每產生一個完整且通過 ID/schema/繁中驗證的段落物件，就會立即插入原網頁。雙語模式固定把中文放在該段英文下方，而且 provider 必須收到原網頁套用確認後才能繼續。
- ChatGPT 最新 composer 已加入 paste/input 狀態同步；內容寫入後以實際啟用的傳送按鈕為準，不再因空的 `value` 屬性誤判失敗。若按鈕沒有啟用，會快速失敗，不再空等 180 秒。
- ChatGPT 工作分頁在介面提供切換選項時，會先從「工作」切換成「對話」再送出翻譯，避免直接文字轉換進入耗時的任務規劃流程。擴充功能不會更改模型、推理強度，也不會啟用額外耗用額度的快速模式。
- M365 的 Lexical/contenteditable composer 會等待非同步 paste 完成，再決定是否使用乾淨的 `insertText` 備援，避免同一提示被插入兩次。每種寫入方式之間都會先清空舊內容；送出前會解析並比對 `INPUT`／`INPUT_JSON` payload，確認資料完整且只出現一次。按下傳送後必須在短時間內確認輸入框清空或開始產生回覆，否則會使用 Enter 備援並快速失敗重試，不再空等整個批次。
- ChatGPT 或 M365 若只完成部分段落，已驗證的中文會立即保留；逾時或格式錯誤後只重送剩餘段落，並以新工作視窗避免沿用故障中的對話狀態。
- 實際等待時間仍取決於 provider、帳號負載與網路。獨立 provider 工作視窗會保持為作用中分頁且不搶走原網頁焦點，以降低必須手動切換分頁才顯示回覆的情況。
- 遠端網頁 provider 無法保證每次都在 5 秒內完成。本機 Microsoft Learn 可視區 8 段實測：ChatGPT 約 3.5 秒全部完成；M365 約 16.5 秒，因其網頁 UI 直到回覆完成才提供可讀內容。

---

<a id="english"></a>

# English

A directly loadable Manifest V3 Chrome Extension. It identifies primary webpage content, translates English blocks into Taiwan Traditional Chinese through the user's signed-in **ChatGPT** or **Microsoft 365 Copilot** webpage, and renders bilingual or translation-only content in place. Normal use requires no npm, Node.js, command, localhost bridge, Native Messaging, or AI API.

[繁體中文 ↑](#translate-web-by-browser-ai) · [Standalone English README](README.en.md)

## Installation (regular users do not need npm)

1. Download and extract `translate-web-by-browser-ai-v0.8.12.zip`.
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

The M365 Lexical/contenteditable composer waits for asynchronous paste handling to settle before attempting a clean `insertText` fallback, preventing the same prompt from being inserted twice. It clears the previous attempt before every fallback and parses the `INPUT` / `INPUT_JSON` payload before submission to confirm the data is complete and appears exactly once. After clicking Send, it requires the composer to clear or generation to start within a few seconds; otherwise it tries Enter as a fallback and fails quickly for retry instead of waiting for the entire batch timeout.

ChatGPT uses `https://chatgpt.com/`; M365 uses `https://m365.cloud.microsoft/chat/`. If the provider composer contains a draft, the extension opens a fresh conversation instead of overwriting it.

During translation, the extension opens a clean new conversation at the provider's official home URL using the shared signed-in session, then runs it in a dedicated worker window without taking focus from the original page. It does not duplicate a custom GPT, project, or existing conversation, avoiding inherited instructions and history that can delay translation. The provider remains the active tab in that window, reducing cases where background rendering pauses until the user switches tabs. The worker closes automatically when the job finishes. If Chrome cannot create it, the extension uses another clean provider-home background tab and reports a progress warning; it falls back to the existing provider tab only when that clean fallback also cannot be created.

If the first batch produces no validated Chinese after 8 seconds and the user is still in the original Chrome window, the extension briefly surfaces the provider worker and automatically returns to the source page as soon as the first translation arrives. This wakes ChatGPT or M365 when an occluded background window has paused DOM updates. If the user has switched to a game or another application, the extension does not take system focus.

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
- A 5-second result cannot be guaranteed for remote web providers. In the documented Microsoft Learn viewport smoke test, ChatGPT completed eight visible blocks in about 3.5 seconds, while M365 took about 16.5 seconds because its web UI exposed the response only after completion.

## Development

Node.js 22 or newer and npm are required only to modify or package the source:

```powershell
npm install
npm run check
npm run package
```

The build updates the directly loadable, version-controlled `extension/` folder and copies release files to `dist/extension/`. The release ZIP is `dist/release/translate-web-by-browser-ai-v0.8.12.zip`.

## YouTube captions and transcripts

- For a captioned YouTube video, open **Show transcript**, then select **Visible whole page (including menus)**. The extension translates transcript rows, buttons, and menus currently visible in the viewport. Scroll the transcript and translate again for newly visible rows.
- Live per-line AI captions over the player are not currently supported. ChatGPT/M365 web UIs can take several to tens of seconds to respond, by which time the player caption may have changed.
- YouTube's official caption download API requires OAuth, and downloading requires permission to edit the video. This project will not add API keys, read login tokens, or bypass those permissions.
- References: [YouTube: View video transcripts](https://support.google.com/youtube/answer/15930243?hl=en), [YouTube Captions API](https://developers.google.com/youtube/v3/docs/captions/download).
