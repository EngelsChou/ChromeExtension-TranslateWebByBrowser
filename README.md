# Translate Web by Browser AI

可直接載入 Chrome 的 Manifest V3 Extension。它辨識網頁主要內容，將英文段落透過使用者已登入的 **ChatGPT** 或 **Microsoft 365 Copilot** 網頁翻成台灣繁體中文，並以雙語對照或只顯示翻譯的方式原地呈現。一般使用不需要 npm、Node.js、指令、localhost bridge、Native Messaging 或 AI API。

[English](README.en.md)

## 安裝（一般使用者不需要 npm）

1. 下載並解壓縮 `translate-web-by-browser-ai-v0.6.0.zip`。
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
   - **整個頁面**：翻譯所有可辨識的已渲染段落，包括導覽區域。
4. 選擇 **雙語對照** 或 **只顯示翻譯**。
5. 第一次使用時，確認 provider 後按登入按鈕，親自完成登入、MFA 或組織驗證。
6. 回到原網頁，按「翻譯目前頁面」。按「恢復原文」可完整移除翻譯並還原原始節點。

ChatGPT 使用 `https://chatgpt.com/`；M365 使用 `https://m365.cloud.microsoft/chat/`。若 provider 輸入框已有草稿，Extension 會建立新對話，避免覆寫使用者內容。

## 段落級架構

```text
目前網頁 content script
  ├─ 尋找主要內容或整頁範圍
  ├─ 擷取 h1-h6 / p / li / td / blockquote 等已渲染段落
  ├─ 包含 viewport 外的文章內容，不只翻譯目前畫面
  ├─ 產生穩定 block ID，保存原始 DOM children
  └─ 只輸出 {id, text, context:{type, heading}}
           ↕ Chrome runtime messaging
Manifest V3 service worker
  ├─ 當下可視區的所有段落都放入第一個優先批次
  ├─ 後續每批最多 24 段、約 5,000 字元
  ├─ 在原網頁顯示經過時間，完成一批就立即套用
  ├─ 保存進度與最後錯誤，popup 關閉後仍可查詢
  ├─ 再次驗證完整 ID/schema 與實際套用數量
  └─ 網頁重繪造成 mapping 失效時安全停止
           ↕ Chrome runtime messaging
Provider content script
  ├─ 操作已登入的 ChatGPT / M365 composer
  ├─ 依 ChatGPT／M365 調整提示語氣，並嚴格要求單一 JSON object
  ├─ 逐一驗證 JSON 候選，不會誤用 prompt 範例或建議按鈕
  └─ M365 參考 ask-bridge：使用 Stop、Copy action、新回覆與穩定度判斷完成
```

雙語模式會保留段落原有連結、格式與事件節點，再插入獨立的 `lang="zh-Hant-TW"` 翻譯元素；只顯示翻譯模式則隱藏原始 wrapper。恢復時會把原始 children 移回原位，不使用重新載入頁面。

## 傳送內容與隱私

Extension **不傳送整頁 HTML 或 DOM 結構**。每個段落只傳送：

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
- 超長單一段落、provider 用量限制、背景分頁節流或無效 JSON 可能造成逾時；失敗批次不會套用。

## 開發

只有修改或重新打包時才需要 Node.js 22 以上與 npm：

```powershell
npm install
npm run check
npm run package
```

build 會更新可直接載入且納入版本控制的 `extension/`，並複製發布內容至 `dist/extension/`。發布 ZIP 位於 `dist/release/translate-web-by-browser-ai-v0.6.0.zip`。

## 翻譯速度與進度

- popup 關閉後，原網頁右下角仍會顯示目前階段、已經過秒數、批次與已套用段落數。
- 目前視窗內相交的每個標題、段落與清單項目都會進入第一個優先批次；畫面外內容稍後才處理。
- 最終回覆仍須是嚴格 JSON；但串流中每產生一個完整且通過 ID/schema/繁中驗證的段落物件，就會立即套用，不等整批或整頁完成。
- ChatGPT 最新 composer 已加入 paste/input 狀態同步與送出前驗證；若傳送按鈕沒有啟用，會快速失敗並明確顯示「尚未送出」，不再空等 180 秒。
- 實際等待時間仍取決於 provider、帳號負載、網路與 Chrome 背景分頁節流；網頁上的計時可用來區分「provider 尚在回覆」與 Extension 沒有運作。
- 遠端網頁 provider 無法保證每次都在 5 秒內完成。本機 Microsoft Learn 可視區 8 段實測：ChatGPT 約 3.5 秒全部完成；M365 約 16.5 秒，因其網頁 UI 直到回覆完成才提供可讀內容。
