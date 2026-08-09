# Translate Web by ChatGPT Browser

一個可直接載入 Chrome 使用的 Manifest V3 Extension。它會擷取目前畫面中可見的英文 Text Nodes，透過同一個 Chrome 中已登入的 ChatGPT 分頁翻成台灣繁體中文，再原地替換文字；不使用 OpenAI API、localhost bridge、Native Messaging、Node.js 執行環境或其他 AI provider。

[English](README.en.md)

## 一般使用者不需要 npm

一般使用只需要安裝 Extension：

1. 下載 `translate-web-by-chatgpt-browser-v0.2.0.zip` 並解壓縮。
2. 開啟 `chrome://extensions`。
3. 啟用「開發人員模式」。
4. 選擇「載入未封裝項目」，指定剛才解壓縮的資料夾。

完成後不需要開啟終端、不需要執行任何指令，也不需要在電腦安裝 Node.js。npm 指令只供修改原始碼的開發者使用。

## 使用方式

1. 在要翻譯的網頁按 Extension 圖示。
2. Extension 會在背景尋找或建立 `chatgpt.com` 分頁。
3. 第一次若尚未登入，按「開啟 ChatGPT 登入」，在該分頁完成登入後回到原網頁。
4. 再次開啟 popup，按「翻譯目前頁面」。
5. 按「恢復原文」可還原目前頁面生命週期內已翻譯的 Text Nodes。

ChatGPT 登入狀態由正常的 Chrome profile 保存。往後使用只需按 Extension，不必重複啟動任何服務。

## 架構

```text
目前網頁
  └─ target content script
       ├─ 篩選 viewport 內可見、以英文為主的 Text Nodes
       ├─ 產生並保留穩定 ID mapping
       └─ 保存原文、套用翻譯、恢復原文
             ↕ Chrome runtime messaging
       Manifest V3 service worker
       ├─ 尋找或背景開啟 ChatGPT 分頁
       ├─ 分批送出文字
       └─ 套用前再次驗證 ID/schema
             ↕ Chrome runtime messaging
       ChatGPT content script
       ├─ 操作已登入的 ChatGPT 輸入框
       ├─ 要求嚴格 JSON 回覆
       ├─ 等待完整回覆並重試一次
       └─ 驗證缺少、重複、未知 ID、型別與空翻譯
```

每批最多 30 段、約 6,000 字元。送進 ChatGPT 的資料只有 `{id, text}`，不包含整頁 HTML。

## 擷取與恢復行為

掃描會略過：

- viewport 外或 CSS 隱藏的內容
- `script`、`style`、`svg`、`canvas`、程式碼區塊
- 表單控制項與可編輯區域
- URL、email、只有數字的內容
- 不是以拉丁字母為主的文字

Text Node ID 由頁面路徑、DOM 位置與原文產生；同一節點再次掃描時會重用既有 mapping。原文保存在該分頁的 content script 記憶體內，不會寫入頁面 HTML 或上傳。SPA 重繪可能覆蓋翻譯；捲動後出現的新文字可再次按翻譯。

## 權限、安全與隱私

- `activeTab`：只在使用者按 Extension 時存取目前頁面。
- `scripting`：注入目前頁面的翻譯程式，以及在既有 ChatGPT 分頁補注入連線程式。
- `https://chatgpt.com/*` 與 `https://chat.openai.com/*`：尋找、開啟並操作使用者自己的 ChatGPT 分頁。
- 不包含 `<all_urls>`、localhost、Native Messaging 或本機 executable 權限。
- 網頁文字視為不可信資料；prompt 明確要求忽略文字內的指令，只做翻譯。這能降低但不能完全消除 prompt injection 風險。
- 翻譯文字與 ChatGPT 回覆會經過使用者的 ChatGPT 帳號，並可能留在該對話紀錄中；適用使用者自己的 ChatGPT 方案、資料控制、政策與用量限制。
- 請勿翻譯沒有權限傳送給 ChatGPT 的機密、個資或第三方內容。

## 已知限制

- 這是 ChatGPT 網頁 UI 自動化，不是正式 OpenAI API。ChatGPT 的 DOM、登入流程、驗證、按鈕或訊息結構改版時可能需要更新 Extension。
- 首次使用仍需由使用者親自在 ChatGPT 分頁登入；Extension 不讀取或保存密碼、Cookie 或 token。
- ChatGPT 分頁必須保持開啟。Extension 會重用它並避免自動丟棄，但使用者關閉後，下次會自動建立新分頁。
- 背景分頁可能受到 Chrome 節流，因此速度取決於瀏覽器與 ChatGPT 狀態。
- ChatGPT 可能輸出錯誤 JSON、缺漏、達到用量限制或逾時。Extension 會重試一次，仍失敗就停止該批，不套用未驗證結果。
- 不翻譯 shadow DOM、cross-origin iframe、圖片文字、placeholder、`aria-label` 或其他 attribute。
- 動態網站重繪後，恢復功能只適用於仍連線且由同一 content script 保存的節點。

## 開發

只有修改或重新打包原始碼時才需要 Node.js 22 以上與 npm：

```powershell
npm install
npm run build
npm run lint
npm test
npm run package
```

`npm run check` 依序執行 build、lint、test。未封裝產物在 `dist/extension/`，可發布 ZIP 在 `dist/release/translate-web-by-chatgpt-browser-v0.2.0.zip`。
