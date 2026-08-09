import { createBatches } from './batching.js';

const BRIDGE_URL = 'http://127.0.0.1:17373';

async function bridgeRequest(path, options = {}) {
  const response = await fetch(`${BRIDGE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    signal: AbortSignal.timeout(options.timeout ?? 240_000),
  });
  const payload = await response.json().catch(() => ({ error: 'Bridge 回傳了無法解析的內容。' }));
  if (!response.ok) throw new Error(payload.error || `Bridge 錯誤 (${response.status})`);
  return payload;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('找不到目前的分頁。');
  if (/^(chrome|edge|about|devtools):/u.test(tab.url ?? '')) throw new Error('瀏覽器內建頁面不允許擴充功能存取。');
  return tab;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING_TRANSLATOR' });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  }
}

function announce(detail) {
  chrome.runtime.sendMessage({ type: 'TRANSLATION_PROGRESS', ...detail }).catch(() => {});
}

async function translatePage() {
  const tab = await activeTab();
  await ensureContentScript(tab.id);
  const { items } = await chrome.tabs.sendMessage(tab.id, { type: 'COLLECT_TEXT_NODES' });
  if (!items?.length) return { translated: 0, total: 0, message: '目前畫面沒有可翻譯的可見英文文字。' };

  const batches = createBatches(items);
  let translated = 0;
  announce({ completed: 0, total: batches.length, translated, nodes: items.length });

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const result = await bridgeRequest('/translate', {
      method: 'POST',
      body: JSON.stringify({ items: batch, sourceLanguage: 'English', targetLocale: 'zh-TW' }),
    });
    const applyResult = await chrome.tabs.sendMessage(tab.id, {
      type: 'APPLY_TRANSLATIONS',
      translations: result.translations,
    });
    translated += applyResult.applied;
    announce({ completed: index + 1, total: batches.length, translated, nodes: items.length });
  }

  return { translated, total: items.length };
}

async function restorePage() {
  const tab = await activeTab();
  await ensureContentScript(tab.id);
  return chrome.tabs.sendMessage(tab.id, { type: 'RESTORE_TEXT_NODES' });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const task = message?.type === 'GET_BRIDGE_STATUS'
    ? bridgeRequest('/health', { timeout: 6_000 })
    : message?.type === 'TRANSLATE_PAGE'
      ? translatePage()
      : message?.type === 'RESTORE_PAGE'
        ? restorePage()
        : null;
  if (!task) return false;
  task.then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
