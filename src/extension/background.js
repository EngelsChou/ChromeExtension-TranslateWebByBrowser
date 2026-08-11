import { createBatches } from './batching.js';
import { validateTranslations } from './chatgpt-core.js';
import { getProvider, PROVIDERS } from './providers.js';

let translationQueue = Promise.resolve();
const pendingRequests = new Map();

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

async function findExistingProviderTab(provider) {
  const tabs = await chrome.tabs.query({ url: provider.tabPatterns });
  return tabs.find((candidate) => candidate.status === 'complete' && !candidate.discarded)
    ?? tabs.find((candidate) => !candidate.discarded)
    ?? null;
}

async function findOrCreateProviderTab(provider) {
  let tab = await findExistingProviderTab(provider);
  if (!tab) tab = await chrome.tabs.create({ url: provider.homeUrl, active: false });
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

async function createProviderWorker(provider, sourceTab, targetTab) {
  let workerTab;
  let workerWindow;
  try {
    workerTab = await chrome.tabs.duplicate(sourceTab.id);
    if (!workerTab?.id) throw new Error('無法複製 provider 分頁');
    workerWindow = await chrome.windows.create({
      tabId: workerTab.id,
      type: 'popup',
      focused: false,
      width: 520,
      height: 760,
    });
    if (!workerWindow?.id) throw new Error('無法建立 provider 工作視窗');
    await chrome.tabs.update(workerTab.id, { active: true, autoDiscardable: false });
    await chrome.tabs.update(targetTab.id, { active: true });
    await chrome.windows.update(targetTab.windowId, { focused: true });
    const status = await waitForProviderContent(workerTab.id, provider);
    if (!status.ready || status.blocked || status.hasDraft) {
      throw new Error(status.message || `${provider.name} 工作視窗尚未就緒。`);
    }
    return {
      tab: workerTab,
      dedicated: true,
      async close() {
        try { await chrome.windows.remove(workerWindow.id); } catch { /* already closed */ }
      },
    };
  } catch (error) {
    if (workerWindow?.id) {
      try { await chrome.windows.remove(workerWindow.id); } catch { /* already closed */ }
    } else if (workerTab?.id) {
      try { await chrome.tabs.remove(workerTab.id); } catch { /* already closed */ }
    }
    return {
      tab: sourceTab,
      dedicated: false,
      warning: `無法建立作用中的 provider 工作視窗，改用既有背景分頁：${error.message}`,
      async close() {},
    };
  }
}

async function providerStatus(providerId) {
  const provider = getProvider(providerId);
  const tab = await findExistingProviderTab(provider);
  if (!tab?.id) {
    return {
      provider: provider.id,
      providerName: provider.name,
      providerReady: false,
      signedOut: false,
      blocked: false,
      tabId: null,
      message: `尚未開啟 ${provider.name}。請先確認選擇，再按下方登入按鈕。`,
    };
  }
  const status = await waitForProviderContent(tab.id, provider);
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
  let tab = await findExistingProviderTab(provider);
  if (!tab) tab = await chrome.tabs.create({ url: provider.homeUrl, active: true });
  if (!tab?.id) throw new Error(`無法建立 ${provider.name} 分頁。`);
  await chrome.tabs.update(tab.id, { active: true, autoDiscardable: false });
  await chrome.windows.update(tab.windowId, { focused: true });
  return { provider: provider.id, providerName: provider.name, tabId: tab.id };
}

function updateJob(detail, targetTabId) {
  const job = { updatedAt: Date.now(), ...detail };
  chrome.storage.session.set({ translationJob: job }).catch(() => {});
  chrome.runtime.sendMessage({ type: 'TRANSLATION_PROGRESS', ...job }).catch(() => {});
  if (targetTabId) {
    chrome.tabs.sendMessage(targetTabId, { type: 'TRANSLATION_PROGRESS', ...job }).catch(() => {});
  }
  return job;
}

function applyPartialTranslations(message, sender) {
  const pending = pendingRequests.get(message.requestId);
  if (!pending || sender.tab?.id !== pending.providerTabId) return Promise.resolve({ ignored: true });
  pending.applyChain = pending.applyChain.then(async () => {
    const candidates = (message.translations ?? [])
      .filter(({ id }) => !pending.appliedIds.has(id));
    if (!candidates.length) return { applied: 0, duplicate: true };
    const candidateIds = new Set(candidates.map(({ id }) => id));
    const expectedItems = pending.batch.filter(({ id }) => candidateIds.has(id));
    const translations = validateTranslations(candidates, expectedItems);
    const result = await chrome.tabs.sendMessage(pending.targetTabId, {
      type: 'APPLY_TRANSLATIONS', translations, displayMode: pending.displayMode,
    });
    if (result.applied !== translations.length) {
      throw new Error('原網頁在串流翻譯期間已重繪，無法安全套用段落。');
    }
    translations.forEach(({ id }) => pending.appliedIds.add(id));
    pending.context.translated = (pending.context.translated ?? 0) + result.applied;
    updateJob({
      state: 'running', stage: 'streaming', provider: pending.provider.id,
      providerName: pending.provider.name, scope: pending.scope,
      displayMode: pending.displayMode, completed: pending.batchIndex,
      total: pending.totalBatches, translated: pending.context.translated,
      blocks: pending.context.blocks, startedAt: pending.context.startedAt,
    }, pending.targetTabId);
    return result;
  });
  return pending.applyChain;
}

async function translatePage(providerId, { scope = 'main', displayMode = 'bilingual' } = {}, context = {}) {
  const provider = getProvider(providerId);
  const targetTab = await activeTargetTab();
  context.targetTabId = targetTab.id;
  context.startedAt = Date.now();
  await ensureTargetContentScript(targetTab.id);
  updateJob({
    state: 'preparing', stage: 'collecting', provider: provider.id, providerName: provider.name,
    scope, displayMode, completed: 0, total: 0, translated: 0, blocks: 0,
    startedAt: context.startedAt,
  }, targetTab.id);
  const { items } = await chrome.tabs.sendMessage(targetTab.id, {
    type: 'COLLECT_TRANSLATION_BLOCKS',
    scope,
  });
  context.blocks = items?.length ?? 0;
  if (!items?.length) return { translated: 0, total: 0, batches: 0, message: '找不到符合條件的英文主要內容。' };

  updateJob({
    state: 'preparing', stage: 'connecting', provider: provider.id, providerName: provider.name,
    scope, displayMode, completed: 0, total: 0, translated: 0, blocks: items.length,
    startedAt: context.startedAt,
  }, targetTab.id);
  const { tab: providerTab, status } = await findOrCreateProviderTab(provider);
  if (!status.ready) {
    await chrome.tabs.update(providerTab.id, { active: true });
    await chrome.windows.update(providerTab.windowId, { focused: true });
    throw new Error(status.message || `請先在 ${provider.name} 分頁完成登入或處理帳戶提示。`);
  }

  const worker = await createProviderWorker(provider, providerTab, targetTab);
  const translationTab = worker.tab;
  const batches = createBatches(items);
  let translated = 0;
  context.total = batches.length;
  context.translated = translated;

  try {
    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index];
      updateJob({
        state: 'running', stage: 'waiting', provider: provider.id, providerName: provider.name,
        scope, displayMode, completed: index, total: batches.length, translated, blocks: items.length,
        workerActive: worker.dedicated, warning: worker.warning, startedAt: context.startedAt,
      }, targetTab.id);
      const requestId = crypto.randomUUID();
      const pending = {
        requestId, providerTabId: translationTab.id, provider, targetTabId: targetTab.id,
        batch, batchIndex: index, totalBatches: batches.length, displayMode, scope, context,
        appliedIds: new Set(), applyChain: Promise.resolve(),
      };
      pendingRequests.set(requestId, pending);
      try {
        const result = await chrome.tabs.sendMessage(translationTab.id, {
          type: 'PROVIDER_TRANSLATE_BATCH', items: batch, requestId,
        });
        await pending.applyChain;
        if (!result?.ok) throw new Error(result?.error || `${provider.name} 沒有回傳可用的翻譯。`);
        const translations = validateTranslations(result.translations, batch);
        const remaining = translations.filter(({ id }) => !pending.appliedIds.has(id));
        if (remaining.length) {
          const applyResult = await chrome.tabs.sendMessage(targetTab.id, {
            type: 'APPLY_TRANSLATIONS', translations: remaining, displayMode,
          });
          if (applyResult.applied !== remaining.length) {
            throw new Error(`原網頁在翻譯期間已重繪，${remaining.length - applyResult.applied} 個段落無法安全套用。請恢復後重試。`);
          }
          context.translated += applyResult.applied;
        }
      } finally {
        pendingRequests.delete(requestId);
      }
      translated = context.translated;
      updateJob({
        state: 'running', stage: 'applied', provider: provider.id, providerName: provider.name,
        scope, displayMode,
        completed: index + 1, total: batches.length, translated, blocks: items.length,
        workerActive: worker.dedicated, warning: worker.warning, startedAt: context.startedAt,
      }, targetTab.id);
    }
  } finally {
    await worker.close();
  }

  return { translated, total: items.length, batches: batches.length };
}

async function restorePage(providerId) {
  getProvider(providerId);
  const tab = await activeTargetTab();
  await ensureTargetContentScript(tab.id);
  return chrome.tabs.sendMessage(tab.id, { type: 'RESTORE_TEXT_NODES' });
}

function enqueueTranslation(providerId, options) {
  const context = {};
  const execute = async () => {
    try {
      const result = await translatePage(providerId, options, context);
      updateJob({
        state: 'complete', stage: 'complete', provider: providerId,
        providerName: getProvider(providerId).name, ...options,
        completed: result.batches, total: result.batches,
        translated: result.translated, blocks: result.total,
        message: result.message, startedAt: context.startedAt,
      }, context.targetTabId);
      return result;
    } catch (error) {
      updateJob({
        state: 'error', stage: 'error', provider: providerId,
        providerName: getProvider(providerId).name, ...options, error: error.message,
        completed: 0, total: context.total ?? 0, translated: context.translated ?? 0,
        blocks: context.blocks ?? 0, startedAt: context.startedAt,
      }, context.targetTabId);
      throw error;
    }
  };
  const task = translationQueue.then(execute, execute);
  translationQueue = task.catch(() => {});
  return task;
}

async function translationJob() {
  const stored = await chrome.storage.session.get('translationJob');
  return stored.translationJob ?? null;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const task = message?.type === 'PROVIDER_TRANSLATION_PARTIAL'
    ? applyPartialTranslations(message, _sender)
    : message?.type === 'GET_PROVIDER_STATUS'
    ? providerStatus(message.provider)
    : message?.type === 'OPEN_PROVIDER'
      ? openProvider(message.provider)
      : message?.type === 'TRANSLATE_PAGE'
        ? enqueueTranslation(message.provider, {
          scope: message.scope === 'page' ? 'page' : 'main',
          displayMode: message.displayMode === 'replace' ? 'replace' : 'bilingual',
        })
        : message?.type === 'RESTORE_PAGE'
          ? restorePage(message.provider)
          : message?.type === 'GET_TRANSLATION_JOB'
            ? translationJob()
          : null;
  if (!task) return false;
  task.then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
