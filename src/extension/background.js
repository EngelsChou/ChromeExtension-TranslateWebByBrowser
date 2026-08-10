import { createBatches } from './batching.js';
import { validateTranslations } from './chatgpt-core.js';
import { getProvider, PROVIDERS } from './providers.js';

let translationQueue = Promise.resolve();

async function activeTargetTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('找不到目前作用中的分頁。');
  if (/^(chrome|edge|about|devtools):/u.test(tab.url ?? '')) {
    throw new Error('Chrome 內建頁面不允許 Extension 翻譯，請切換到一般網頁。');
  }
  const service = Object.values(PROVIDERS).find((candidate) => candidate.ownedUrl.test(tab.url ?? ''));
  if (service) {
    throw new Error(`${service.name} 分頁不能同時作為翻譯目標，請回到要翻譯的網頁再開啟 popup。`);
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

async function waitForProviderContent(tabId, provider, timeout = 25_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  let injected = false;
  while (Date.now() < deadline) {
    try {
      return await chrome.tabs.sendMessage(tabId, { type: 'PROVIDER_STATUS' });
    } catch (error) {
      lastError = error;
      if (!injected) {
        try {
          await chrome.scripting.executeScript({ target: { tabId }, files: [provider.contentScript] });
          injected = true;
        } catch { /* the provider tab may still be navigating */ }
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  throw new Error(`${provider.name} 分頁載入逾時：${lastError?.message ?? 'content script 尚未就緒'}`);
}

async function findOrCreateProviderTab(provider) {
  const tabs = await chrome.tabs.query({ url: provider.tabPatterns });
  let tab = tabs.find((candidate) => candidate.status === 'complete' && !candidate.discarded) ?? tabs[0];
  if (!tab) tab = await chrome.tabs.create({ url: provider.homeUrl, active: false });
  if (tab.discarded) {
    await chrome.tabs.reload(tab.id);
    tab = await chrome.tabs.get(tab.id);
  }
  if (!tab?.id) throw new Error(`無法建立 ${provider.name} 分頁。`);
  await chrome.tabs.update(tab.id, { autoDiscardable: false });
  let status = await waitForProviderContent(tab.id, provider);
  if (status.blocked) return { tab, status };
  if (status.hasDraft) {
    tab = await chrome.tabs.create({ url: provider.homeUrl, active: false });
    if (!tab?.id) throw new Error(`無法建立沒有既存草稿的 ${provider.name} 分頁。`);
    await chrome.tabs.update(tab.id, { autoDiscardable: false });
    status = await waitForProviderContent(tab.id, provider);
  }
  return { tab, status };
}

async function providerStatus(providerId, { activate = false } = {}) {
  const provider = getProvider(providerId);
  const { tab, status } = await findOrCreateProviderTab(provider);
  if (activate || !status.ready) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  return {
    provider: provider.id,
    providerName: provider.name,
    providerReady: status.ready,
    signedOut: status.signedOut,
    blocked: status.blocked,
    tabId: tab.id,
    message: status.message ?? (status.ready
      ? `${provider.name} 分頁已登入，可以翻譯。`
      : `請在剛開啟的 ${provider.name} 分頁完成登入，再回到原網頁。`),
  };
}

async function openProvider(providerId) {
  const provider = getProvider(providerId);
  const tabs = await chrome.tabs.query({ url: provider.tabPatterns });
  let tab = tabs.find((candidate) => !candidate.discarded) ?? tabs[0];
  if (!tab) tab = await chrome.tabs.create({ url: provider.homeUrl, active: true });
  if (!tab?.id) throw new Error(`無法建立 ${provider.name} 分頁。`);
  await chrome.tabs.update(tab.id, { active: true, autoDiscardable: false });
  await chrome.windows.update(tab.windowId, { focused: true });
  return { provider: provider.id, providerName: provider.name, tabId: tab.id };
}

function announce(detail) {
  chrome.runtime.sendMessage({ type: 'TRANSLATION_PROGRESS', ...detail }).catch(() => {});
}

async function translatePage(providerId) {
  const provider = getProvider(providerId);
  const targetTab = await activeTargetTab();
  await ensureTargetContentScript(targetTab.id);
  const { items } = await chrome.tabs.sendMessage(targetTab.id, { type: 'COLLECT_TEXT_NODES' });
  if (!items?.length) return { translated: 0, total: 0, message: '目前畫面沒有符合條件的可見英文文字。' };

  const { tab: providerTab, status } = await findOrCreateProviderTab(provider);
  if (!status.ready) {
    await chrome.tabs.update(providerTab.id, { active: true });
    await chrome.windows.update(providerTab.windowId, { focused: true });
    throw new Error(status.message || `請先在 ${provider.name} 分頁完成登入或處理帳戶提示。`);
  }

  const batches = createBatches(items);
  let translated = 0;
  announce({ provider: provider.id, completed: 0, total: batches.length, translated, nodes: items.length });

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const result = await chrome.tabs.sendMessage(providerTab.id, {
      type: 'PROVIDER_TRANSLATE_BATCH',
      items: batch,
    });
    if (!result?.ok) throw new Error(result?.error || `${provider.name} 沒有回傳可用的翻譯。`);
    const translations = validateTranslations(result.translations, batch);
    const applyResult = await chrome.tabs.sendMessage(targetTab.id, {
      type: 'APPLY_TRANSLATIONS',
      translations,
    });
    translated += applyResult.applied;
    announce({ provider: provider.id, completed: index + 1, total: batches.length, translated, nodes: items.length });
  }

  return { translated, total: items.length };
}

async function restorePage(providerId) {
  getProvider(providerId);
  const tab = await activeTargetTab();
  await ensureTargetContentScript(tab.id);
  return chrome.tabs.sendMessage(tab.id, { type: 'RESTORE_TEXT_NODES' });
}

function enqueueTranslation(providerId) {
  const task = translationQueue.then(() => translatePage(providerId), () => translatePage(providerId));
  translationQueue = task.catch(() => {});
  return task;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const task = message?.type === 'GET_PROVIDER_STATUS'
    ? providerStatus(message.provider)
    : message?.type === 'OPEN_PROVIDER'
      ? openProvider(message.provider)
      : message?.type === 'TRANSLATE_PAGE'
        ? enqueueTranslation(message.provider)
        : message?.type === 'RESTORE_PAGE'
          ? restorePage(message.provider)
          : null;
  if (!task) return false;
  task.then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
