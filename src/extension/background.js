import { createBatches } from './batching.js';
import { validateTranslations } from './chatgpt-core.js';

const CHATGPT_URLS = ['https://chatgpt.com/*', 'https://chat.openai.com/*'];
const CHATGPT_HOME = 'https://chatgpt.com/';
let translationQueue = Promise.resolve();

async function activeTargetTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('找不到目前的分頁。');
  if (/^(chrome|edge|about|devtools):/u.test(tab.url ?? '')) throw new Error('瀏覽器內建頁面不允許擴充功能存取。');
  if (/^https:\/\/(?:chatgpt\.com|chat\.openai\.com)(?:\/|$)/u.test(tab.url ?? '')) {
    throw new Error('ChatGPT 工作分頁不能當作待翻譯頁面。請切回原網頁再開啟 popup。');
  }
  return tab;
}

async function ensureTargetContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING_TRANSLATOR' });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  }
}

async function waitForChatGptContent(tabId, timeout = 25_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  let injected = false;
  while (Date.now() < deadline) {
    try {
      return await chrome.tabs.sendMessage(tabId, { type: 'CHATGPT_STATUS' });
    } catch (error) {
      lastError = error;
      if (!injected) {
        try {
          await chrome.scripting.executeScript({ target: { tabId }, files: ['chatgpt-content.js'] });
          injected = true;
        } catch { /* the tab may still be navigating; retry after it settles */ }
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  throw new Error(`ChatGPT 分頁載入逾時：${lastError?.message ?? 'content script 尚未就緒'}`);
}

async function findOrCreateChatGptTab() {
  const tabs = await chrome.tabs.query({ url: CHATGPT_URLS });
  let tab = tabs.find((candidate) => candidate.status === 'complete' && !candidate.discarded) ?? tabs[0];
  if (!tab) tab = await chrome.tabs.create({ url: CHATGPT_HOME, active: false });
  if (tab.discarded) {
    await chrome.tabs.reload(tab.id);
    tab = await chrome.tabs.get(tab.id);
  }
  if (!tab?.id) throw new Error('無法建立 ChatGPT 分頁。');
  await chrome.tabs.update(tab.id, { autoDiscardable: false });
  let status = await waitForChatGptContent(tab.id);
  if (status.hasDraft) {
    tab = await chrome.tabs.create({ url: CHATGPT_HOME, active: false });
    if (!tab?.id) throw new Error('無法建立不覆蓋既有草稿的 ChatGPT 分頁。');
    await chrome.tabs.update(tab.id, { autoDiscardable: false });
    status = await waitForChatGptContent(tab.id);
  }
  return { tab, status };
}

async function chatGptStatus({ activate = false } = {}) {
  const { tab, status } = await findOrCreateChatGptTab();
  if (activate || !status.ready) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  return {
    chatgptReady: status.ready,
    signedOut: status.signedOut,
    tabId: tab.id,
    message: status.ready
      ? 'ChatGPT 分頁已登入並可接收翻譯。'
      : '請在剛開啟的 ChatGPT 分頁完成登入，再回到原網頁。',
  };
}

function announce(detail) {
  chrome.runtime.sendMessage({ type: 'TRANSLATION_PROGRESS', ...detail }).catch(() => {});
}

async function translatePage() {
  const targetTab = await activeTargetTab();
  await ensureTargetContentScript(targetTab.id);
  const { items } = await chrome.tabs.sendMessage(targetTab.id, { type: 'COLLECT_TEXT_NODES' });
  if (!items?.length) return { translated: 0, total: 0, message: '目前畫面沒有可翻譯的可見英文文字。' };

  const { tab: chatGptTab, status } = await findOrCreateChatGptTab();
  if (!status.ready) {
    await chrome.tabs.update(chatGptTab.id, { active: true });
    await chrome.windows.update(chatGptTab.windowId, { focused: true });
    throw new Error('請先在 ChatGPT 分頁完成登入，然後回到原網頁重新翻譯。');
  }

  const batches = createBatches(items);
  let translated = 0;
  announce({ completed: 0, total: batches.length, translated, nodes: items.length });

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const result = await chrome.tabs.sendMessage(chatGptTab.id, {
      type: 'CHATGPT_TRANSLATE_BATCH',
      items: batch,
    });
    if (!result?.ok) throw new Error(result?.error || 'ChatGPT 分頁沒有回傳翻譯。');
    const translations = validateTranslations(result.translations, batch);
    const applyResult = await chrome.tabs.sendMessage(targetTab.id, {
      type: 'APPLY_TRANSLATIONS',
      translations,
    });
    translated += applyResult.applied;
    announce({ completed: index + 1, total: batches.length, translated, nodes: items.length });
  }

  return { translated, total: items.length };
}

async function restorePage() {
  const tab = await activeTargetTab();
  await ensureTargetContentScript(tab.id);
  return chrome.tabs.sendMessage(tab.id, { type: 'RESTORE_TEXT_NODES' });
}

function enqueueTranslation() {
  const task = translationQueue.then(translatePage, translatePage);
  translationQueue = task.catch(() => {});
  return task;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const task = message?.type === 'GET_CHATGPT_STATUS'
    ? chatGptStatus()
    : message?.type === 'OPEN_CHATGPT'
      ? chatGptStatus({ activate: true })
      : message?.type === 'TRANSLATE_PAGE'
        ? enqueueTranslation()
        : message?.type === 'RESTORE_PAGE'
          ? restorePage()
          : null;
  if (!task) return false;
  task.then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
