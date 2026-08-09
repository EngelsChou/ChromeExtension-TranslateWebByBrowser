# Translate Web by ChatGPT Browser

使用已登入的 ChatGPT 網頁工作階段，把目前網頁畫面中可見的英文 Text Nodes 原地翻成台灣繁體中文。這是 Manifest V3 Chrome Extension；不使用 OpenAI API，也不支援 Claude、Gemini 或其他 provider。

[English](README.en.md)

## 架構

```text
目前網頁
  └─ content script：可見性/英文過濾、穩定 ID、原文保存、DOM 原地替換
       └─ MV3 background：依筆數與字元數分批
            └─ http://127.0.0.1:17373 薄 bridge
                 └─ 官方 chrome-devtools-mcp 1.6.0 experimental CLI
                      └─ 獨立且持久的 Chrome profile → 已登入的 chatgpt.com
```

擴充功能只把 `{id, text}` 送到本機 bridge，不會傳送整頁 HTML。bridge 以嚴格 JSON prompt 要求 `{"translations":[{"id","text"}]}`，並拒絕缺少、重複、未知 ID、空翻譯或錯誤型別。一次只處理一個 ChatGPT 請求，避免不同頁面的回覆互相交錯。

## 需求

- Google Chrome current stable（官方 `chrome-devtools-mcp` 不保證其他 Chromium 瀏覽器）
- Node.js 22 以上與 npm
- 可登入且可正常使用的 ChatGPT 帳號
- 本機連接埠 `127.0.0.1:17373` 可用

本專案固定使用 `chrome-devtools-mcp` 1.6.0。其 [官方 README](https://github.com/ChromeDevTools/chrome-devtools-mcp) 說明支援範圍與瀏覽器資料風險；[CLI 文件](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/cli.md) 明確將 CLI 標為 experimental。

## 安裝與 ChatGPT 連線

1. 安裝與驗證：

   ```powershell
   npm install
   npm run check
   npm run package
   ```

2. 啟動專用 Chrome 工作階段：

   ```powershell
   npm run chatgpt:start
   ```

   指令會由官方 CLI 開啟使用 `.chatgpt-profile/` 的 Chrome 與 `https://chatgpt.com/`。第一次請在這個視窗手動登入並完成可能的驗證；之後保持視窗開啟。登入資訊只保存在被 `.gitignore` 排除的本機 profile。

3. 另一個終端啟動本機 bridge：

   ```powershell
   npm run bridge
   ```

4. 開啟 `chrome://extensions`，啟用「開發人員模式」，選「載入未封裝項目」，指定：

   ```text
   <repository>\dist\extension
   ```

   也可以將 `dist/release/translate-web-by-chatgpt-browser-v0.1.0.zip` 解壓後載入。ZIP 根目錄已是 Chrome Extension 發布結構；本機 bridge 仍需從 repository 執行。

## 使用

1. 確認專用 Chrome 的 ChatGPT 已登入，且 bridge 正在執行。
2. 在要翻譯的網頁開啟 popup。
3. 狀態顯示「已連線」後按「翻譯目前頁面」。
4. 按「恢復原文」可還原此分頁在目前頁面生命週期內已翻譯的 Text Nodes。

掃描會略過隱藏或畫面外文字、表單控制項、可編輯區、程式碼、`script/style/svg` 等內容，以及不是以拉丁字母為主、URL/email 或只有數字的文字。SPA 更新後可再次按翻譯；已斷開 DOM 的舊節點會清理。

## 安全與隱私

- 只有經過過濾的可見英文純文字與本機產生的 ID 會送進 ChatGPT；不傳 HTML、Cookie、網頁儲存空間或表單值。
- 網頁文字視為不可信內容；prompt 明確要求忽略其中的指令，只做翻譯。這能降低但不能完全消除 prompt injection 風險。
- bridge 只綁定 loopback，不接受非 `chrome-extension://` 的瀏覽器 Origin。可設定 `BRIDGE_EXTENSION_ID` 只允許一個 unpacked extension ID：

  ```powershell
  $env:BRIDGE_EXTENSION_ID='你的擴充功能ID'
  npm run bridge
  ```

- 專用 Chrome profile 會保留 ChatGPT 登入狀態。不要分享 `.chatgpt-profile/`，也不要在該視窗瀏覽其他敏感網站。
- 使用者必須自行啟動本機程序；Chrome Extension 不會嘗試啟動 executable。
- 輸入與輸出仍受 ChatGPT 帳號方案、OpenAI 政策、用量限制與資料設定約束。請勿用來繞過限制。

## 已知限制

- ChatGPT 網頁沒有為此專案提供穩定、正式的自動化 API；此模式操作實際 UI，ChatGPT 的 DOM、登入流程、驗證或按鈕文字變更時可能失效。
- 官方 `chrome-devtools-mcp` CLI 仍是 experimental；本專案固定 1.6.0，升級前應重新跑完整實測。
- ChatGPT 可能輸出非 JSON、缺漏項目或逾時。bridge 會驗證、重試一次，仍失敗就停止該批並顯示錯誤，不會套用未驗證的回覆。
- 目前只翻譯 viewport 內可見英文 Text Nodes；捲動後出現的 lazy-loaded 文字需再按一次翻譯。
- 不翻譯 shadow DOM、cross-origin iframe、canvas、圖片內文字、placeholder、`aria-label` 或 attribute。
- 動態 framework 可能在重繪時覆蓋翻譯；恢復只適用於 content script 尚存活且節點仍連線的同一頁面。
- 每批最多 30 段、約 6,000 字元；速度與可用量取決於 ChatGPT 網頁工作階段。

## 開發、測試與打包

```powershell
npm run build
npm run lint
npm test
npm run package
```

`npm run check` 依序執行 build、lint、test。發布 ZIP 位於 `dist/release/`。停止專用 browser daemon 可執行 `npm run chatgpt:stop`；查詢狀態可用 `npm run chatgpt:status`。
