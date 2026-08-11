# Translate Web by Browser AI

可直接載入 Chrome 的 Manifest V3 Extension。它擷取目前畫面中可見的英文 Text Nodes，讓使用者選擇透過已登入的 **ChatGPT** 或 **Microsoft 365 Copilot** 網頁翻成台灣繁體中文，再原地替換文字。一般使用不需要 npm、Node.js、指令、localhost bridge、Native Messaging 或 AI API。

[English](README.en.md)

## 安裝（一般使用者不需要 npm）

1. 下載並解壓縮 `translate-web-by-browser-ai-v0.3.2.zip`。
2. 開啟 `chrome://extensions` 並啟用「開發人員模式」。
3. 選擇「載入未封裝項目」：
   - 使用發布 ZIP：選擇解壓縮後直接含有 `manifest.json` 的資料夾。
   - 使用 GitHub 的 **Source code ZIP**：選擇其中的 `extension/` 資料夾。

`extension/` 已包含 manifest 引用的所有編譯後 JavaScript；不需要先執行 build。若 Chrome 顯示缺少 `chatgpt-content.js`，代表下載的是 v0.3.0 或更舊的原始碼，請改用 v0.3.1 以上。

完成後只需按 Extension 圖示，不必每次執行指令。npm 僅供修改原始碼與重新打包的開發者使用。

## 使用方式

1. 在要翻譯的網頁按 Extension 圖示。
2. 在「翻譯服務」選擇 `ChatGPT` 或 `Microsoft 365 Copilot`；選擇會保存在 Chrome 本機。單純開啟 popup 或切換選項不會建立、開啟或切換到任何服務分頁。
3. 第一次使用時，確認 provider 後再按登入按鈕；只有此時才會開啟所選服務，讓使用者親自完成登入、MFA 或組織驗證。
4. 回到原網頁，再次開啟 popup 並按「翻譯目前頁面」。
5. 按「恢復原文」可還原目前頁面生命週期內已翻譯的 Text Nodes。

ChatGPT 使用 `https://chatgpt.com/`；M365 使用 `https://m365.cloud.microsoft/chat/`。狀態檢查只讀取既有分頁；按登入或開始翻譯後，Extension 才會重用或建立所選服務分頁。若輸入框已有草稿，會另外建立空白對話，避免覆寫使用者文字。

## 架構

```text
目前網頁 content script
  ├─ 篩選 viewport 內可見、以英文為主的 Text Nodes
  ├─ 建立穩定 ID mapping，保存原文並支援恢復
  └─ 只輸出 {id, text}
           ↕ Chrome runtime messaging
Manifest V3 service worker
  ├─ popup 狀態檢查只查詢既有分頁，不自動開啟 provider
  ├─ 使用者按登入/翻譯後才尋找或建立所選服務分頁
  ├─ 每批最多 30 段、約 6,000 字元
  └─ 套用前再次驗證完整 ID/schema
           ↕ Chrome runtime messaging
服務專用 content script
  ├─ 操作已登入的網頁輸入框與傳送控制項
  ├─ 要求只回傳嚴格 JSON，失敗重試一次
  └─ 拒絕缺少、重複、未知 ID、錯誤型別與空翻譯
```

Extension 不傳送整頁 HTML。掃描會略過 viewport 外或隱藏內容、`script`、`style`、`svg`、`canvas`、程式碼、表單控制項、可編輯區域、URL、email、純數字及非拉丁字母為主的文字。Text Node ID 由頁面路徑、DOM 位置與原文產生；原文只保存在該分頁 content script 記憶體中。

## 權限、安全與隱私

- `activeTab`：只在使用者操作 Extension 後存取目前頁面。
- `scripting`：注入目前頁面的翻譯程式，並在服務分頁補注入連線程式。
- `storage`：只保存所選 provider。
- `chatgpt.com` / `chat.openai.com`：操作使用者自己的 ChatGPT 分頁。
- `m365.cloud.microsoft`：操作使用者自己的 Microsoft 365 Copilot 分頁。
- 不包含 `<all_urls>`、localhost、Native Messaging、本機 executable 或 API key。
- 網頁文字一律視為不可信資料；prompt 要求忽略文字內指令，只做翻譯。這可降低但無法完全消除 prompt injection 風險。
- 文字與回覆會經過所選服務帳戶，可能保留在對話紀錄中。其方案、資料控制、組織政策與用量限制均適用。使用公司 M365 帳戶時，請遵守租用戶資料治理與 DLP 政策。
- 請勿翻譯沒有權限傳送到所選服務的機密、個資或第三方內容。

## 已知限制

- 兩種模式都是網頁 UI 自動化，不是官方 API。服務 DOM、登入流程、按鈕或訊息結構改版時可能需要更新 Extension。
- 首次登入、MFA、CAPTCHA 與組織同意必須由使用者處理；Extension 不讀取密碼、Cookie 或 token。
- M365 需要帳戶/租用戶可使用 Copilot Chat；若導向 `/chat/blocked`，Extension 會停止並顯示授權/政策錯誤。
- Microsoft 365 的 rich-text editor 對合成輸入事件較敏感；若組織部署的 UI 不接受 Extension 寫入，會在送出前失敗，不會刻意改用本機 bridge。
- 背景分頁可能被 Chrome 節流。服務也可能回傳錯誤 JSON、達到用量限制或逾時；重試一次仍失敗就停止該批，不套用未驗證結果。
- 不翻譯 shadow DOM、cross-origin iframe、圖片文字、placeholder、`aria-label` 或其他 attribute。SPA 重繪可能覆蓋翻譯；恢復只適用於仍由同一 content script 保存的節點。

## 開發

只有修改或重新打包時才需要 Node.js 22 以上與 npm：

```powershell
npm install
npm run check
npm run package
```

`npm run check` 依序執行 build、lint、test。build 會更新可直接載入且納入版本控制的 `extension/`，並複製發布暫存內容至 `dist/extension/`；發布 ZIP 在 `dist/release/translate-web-by-browser-ai-v0.3.2.zip`。
