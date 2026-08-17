import { createBatches } from './batching.js';
import { validateTranslations } from './chatgpt-core.js';
import {
  expireStaleJob,
  PROVIDER_BATCH_TIMEOUT_MS,
  remainingItems,
  splitRetryItems,
  TRANSLATION_JOB_TIMEOUT_MS,
  withTimeout,
} from './job-guard.js';
import { getProvider, PROVIDERS } from './providers.js';
import { providerWakeDelayMs } from './provider-timing.js';

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

async function createReusedM365Worker(provider, sourceTab, targetTab) {
  const originalWindowId = sourceTab.windowId;
  const originalIndex = Number.isInteger(sourceTab.index) ? sourceTab.index : -1;
  let workerWindow;
  const restoreSourceTab = async () => {
    try {
      await chrome.tabs.move(sourceTab.id, { windowId: originalWindowId, index: originalIndex });
    } catch { /* keep the signed-in provider tab open if its original window disappeared */ }
  };
  try {
    workerWindow = await chrome.windows.create({
      tabId: sourceTab.id,
      type: 'popup',
      focused: false,
      width: 520,
      height: 760,
    });
    if (!workerWindow?.id) throw new Error('無法移動已登入的 M365 分頁至工作視窗');
    await chrome.tabs.update(sourceTab.id, { active: true, autoDiscardable: false });
    await chrome.tabs.update(targetTab.id, { active: true });
    await chrome.windows.update(targetTab.windowId, { focused: true });
    const status = await waitForProviderContent(sourceTab.id, provider);
    if (!status.ready || status.blocked || status.hasDraft) {
      throw new Error(status.message || '既有 M365 分頁不適合執行翻譯。');
    }
    return {
      tab: { ...sourceTab, windowId: workerWindow.id },
      dedicated: true,
      reused: true,
      windowId: workerWindow.id,
      close: restoreSourceTab,
    };
  } catch (error) {
    if (workerWindow?.id) await restoreSourceTab();
    throw error;
  }
}

async function createProviderWorker(provider, sourceTab, targetTab) {
  if (provider.id === 'm365' && sourceTab?.id && sourceTab?.windowId != null) {
    try {
      return await createReusedM365Worker(provider, sourceTab, targetTab);
    } catch { /* fall back to a clean worker tab */ }
  }
  let workerTab;
  let workerWindow;
  try {
    workerTab = await chrome.tabs.create({ url: provider.homeUrl, active: false });
    if (!workerTab?.id) throw new Error('無法建立乾淨的 provider 工作分頁');
    await chrome.tabs.update(workerTab.id, { autoDiscardable: false });
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
      windowId: workerWindow.id,
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
    let fallbackTab;
    try {
      fallbackTab = await chrome.tabs.create({ url: provider.homeUrl, active: false });
      if (!fallbackTab?.id) throw new Error('無法建立乾淨的 provider 備援分頁');
      await chrome.tabs.update(fallbackTab.id, { autoDiscardable: false });
      const status = await waitForProviderContent(fallbackTab.id, provider);
      if (!status.ready || status.blocked || status.hasDraft) {
        throw new Error(status.message || `${provider.name} 備援分頁尚未就緒。`);
      }
      return {
        tab: fallbackTab,
        dedicated: false,
        warning: `無法建立作用中的 provider 工作視窗，改用乾淨的背景分頁：${error.message}`,
        async close() {
          try { await chrome.tabs.remove(fallbackTab.id); } catch { /* already closed */ }
        },
      };
    } catch (fallbackError) {
      if (fallbackTab?.id) {
        try { await chrome.tabs.remove(fallbackTab.id); } catch { /* already closed */ }
      }
      return {
        tab: sourceTab,
        dedicated: false,
        warning: `無法建立乾淨的 provider 工作頁，最後改用既有分頁：${error.message}；${fallbackError.message}`,
        async close() {},
      };
    }
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
  const job = { updatedAt: Date.now(), ...detail, ...(targetTabId ? { targetTabId } : {}) };
  chrome.storage.session.set({ translationJob: job }).catch(() => {});
  chrome.runtime.sendMessage({ type: 'TRANSLATION_PROGRESS', ...job }).catch(() => {});
  if (targetTabId) {
    chrome.tabs.sendMessage(targetTabId, { type: 'TRANSLATION_PROGRESS', ...job }).catch(() => {});
  }
  return job;
}

async function restoreTargetAfterWorkerWake(context, targetTabId, targetWindowId) {
  try { await context.workerWakePromise; } catch { /* wake is best-effort */ }
  if (!context.workerFocusRaised) return;
  context.workerFocusRaised = false;
  try {
    await chrome.tabs.update(targetTabId, { active: true });
    await chrome.windows.update(targetWindowId, { focused: true });
  } catch { /* the user may have closed or moved the target */ }
}

async function noteFirstTranslation(context, targetTabId, targetWindowId) {
  if (context.firstResultAt) return;
  context.firstResultAt = Date.now();
  await restoreTargetAfterWorkerWake(context, targetTabId, targetWindowId);
}

function scheduleProviderWake(context, worker, providerId, batchIndex, retryAttempt) {
  if (batchIndex !== 0 || retryAttempt || !worker.windowId || context.providerWakeUsed) return null;
  return setTimeout(() => {
    if (context.firstResultAt || context.providerWakeUsed) return;
    context.providerWakeUsed = true;
    context.workerWakePromise = (async () => {
      const targetWindow = await chrome.windows.get(context.targetWindowId);
      if (!targetWindow?.focused) return;
      await chrome.windows.update(worker.windowId, { focused: true });
      context.workerFocusRaised = true;
    })().catch(() => {});
  }, providerWakeDelayMs(providerId));
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
    translations.forEach(({ id }) => {
      pending.appliedIds.add(id);
      pending.context.appliedIds.add(id);
    });
    pending.context.translated = (pending.context.translated ?? 0) + result.applied;
    await noteFirstTranslation(
      pending.context, pending.targetTabId, pending.targetWindowId,
    );
    updateJob({
      state: 'running', stage: 'streaming', provider: pending.provider.id,
      providerName: pending.provider.name, scope: pending.scope,
      displayMode: pending.displayMode, completed: pending.batchIndex,
      total: pending.totalBatches, translated: pending.context.translated,
      blocks: pending.context.blocks, startedAt: pending.context.startedAt,
      firstResultMs: pending.context.firstResultAt - pending.context.startedAt,
    }, pending.targetTabId);
    return result;
  });
  return pending.applyChain;
}

async function translatePage(providerId, { scope = 'main', displayMode = 'bilingual' } = {}, context = {}) {
  const provider = getProvider(providerId);
  const targetTab = await activeTargetTab();
  context.targetTabId = targetTab.id;
  context.targetWindowId = targetTab.windowId;
  context.startedAt = Date.now();
  context.deadline = context.startedAt + TRANSLATION_JOB_TIMEOUT_MS;
  context.appliedIds = new Set();
  context.completed = 0;
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

  let worker = await createProviderWorker(provider, providerTab, targetTab);
  const batches = createBatches(items);
  context.total = batches.length;
  context.translated = 0;

  async function replaceWorker() {
    await worker.close();
    worker = await createProviderWorker(provider, providerTab, targetTab);
  }

  async function submitBatch(batch, batchIndex, retryAttempt = 0) {
    const outstanding = remainingItems(batch, context.appliedIds);
    if (!outstanding.length) return;

    const remainingJobTime = context.deadline - Date.now();
    if (remainingJobTime <= 0) {
      const error = new Error(`整體翻譯已超過 ${Math.round(TRANSLATION_JOB_TIMEOUT_MS / 60_000)} 分鐘，已自動停止。`);
      error.code = 'TRANSLATION_TIMEOUT';
      throw error;
    }

    updateJob({
      state: 'running', stage: retryAttempt ? 'retrying' : 'waiting',
      provider: provider.id, providerName: provider.name, scope, displayMode,
      completed: batchIndex, total: batches.length, translated: context.translated,
      blocks: items.length, retryAttempt, workerActive: worker.dedicated,
      warning: worker.warning, startedAt: context.startedAt,
    }, targetTab.id);

    const requestId = crypto.randomUUID();
    const pending = {
      requestId, providerTabId: worker.tab.id, provider, targetTabId: targetTab.id,
      targetWindowId: targetTab.windowId, batch: outstanding, batchIndex,
      totalBatches: batches.length, displayMode, scope, context,
      appliedIds: new Set(), applyChain: Promise.resolve(),
    };
    pendingRequests.set(requestId, pending);
    const wakeTimer = scheduleProviderWake(context, worker, provider.id, batchIndex, retryAttempt);
    let failure;
    try {
      const timeoutMs = Math.min(PROVIDER_BATCH_TIMEOUT_MS, remainingJobTime);
      const result = await withTimeout(chrome.tabs.sendMessage(worker.tab.id, {
        type: 'PROVIDER_TRANSLATE_BATCH', items: outstanding, requestId,
      }), timeoutMs, `${provider.name} 本批等待超過 ${Math.round(timeoutMs / 1000)} 秒。`);
      await pending.applyChain;
      if (!result?.ok) throw new Error(result?.error || `${provider.name} 沒有回傳可用的翻譯。`);
      const translations = validateTranslations(result.translations, outstanding);
      const unapplied = remainingItems(translations, context.appliedIds);
      if (unapplied.length) {
        const applyResult = await chrome.tabs.sendMessage(targetTab.id, {
          type: 'APPLY_TRANSLATIONS', translations: unapplied, displayMode,
        });
        if (applyResult.applied !== unapplied.length) {
          throw new Error(`原網頁在翻譯期間已重繪，${unapplied.length - applyResult.applied} 個段落無法安全套用。`);
        }
        unapplied.forEach(({ id }) => context.appliedIds.add(id));
        context.translated += applyResult.applied;
        await noteFirstTranslation(context, targetTab.id, targetTab.windowId);
      }
    } catch (error) {
      failure = error;
    } finally {
      try {
        await pending.applyChain;
      } catch (error) {
        failure ??= error;
      }
      pendingRequests.delete(requestId);
      if (wakeTimer) clearTimeout(wakeTimer);
    }

    if (!failure) return;
    const remaining = remainingItems(outstanding, context.appliedIds);
    if (!remaining.length) return;
    if (retryAttempt >= 2 || Date.now() >= context.deadline) {
      const error = new Error(
        `${provider.name} 仍有 ${remaining.length} 個段落未完成，已停止重試；`
        + `已完成的 ${context.translated}/${items.length} 個段落會保留。原因：${failure.message}`,
      );
      error.code = failure.code;
      throw error;
    }

    updateJob({
      state: 'running', stage: 'retrying', provider: provider.id, providerName: provider.name,
      scope, displayMode, completed: batchIndex, total: batches.length,
      translated: context.translated, blocks: items.length, retryAttempt: retryAttempt + 1,
      warning: `${failure.message} 將剩餘 ${remaining.length} 個段落拆小重試。`,
      startedAt: context.startedAt,
    }, targetTab.id);
    await replaceWorker();
    for (const retryBatch of splitRetryItems(remaining)) {
      await submitBatch(retryBatch, batchIndex, retryAttempt + 1);
    }
  }

  try {
    for (let index = 0; index < batches.length; index += 1) {
      await submitBatch(batches[index], index);
      context.completed = index + 1;
      updateJob({
        state: 'running', stage: 'applied', provider: provider.id, providerName: provider.name,
        scope, displayMode,
        completed: context.completed, total: batches.length, translated: context.translated,
        blocks: items.length,
        firstResultMs: context.firstResultAt
          ? context.firstResultAt - context.startedAt
          : undefined,
        workerActive: worker.dedicated, warning: worker.warning, startedAt: context.startedAt,
      }, targetTab.id);
    }
  } finally {
    await worker.close();
  }

  return {
    translated: context.translated,
    total: items.length,
    batches: batches.length,
    firstResultMs: context.firstResultAt ? context.firstResultAt - context.startedAt : undefined,
  };
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
        firstResultMs: result.firstResultMs,
        message: result.message, startedAt: context.startedAt,
      }, context.targetTabId);
      return result;
    } catch (error) {
      updateJob({
        state: 'error', stage: 'error', provider: providerId,
        providerName: getProvider(providerId).name, ...options, error: error.message,
        completed: context.completed ?? 0, total: context.total ?? 0,
        translated: context.translated ?? 0,
        blocks: context.blocks ?? 0,
        firstResultMs: context.firstResultAt
          ? context.firstResultAt - context.startedAt
          : undefined,
        startedAt: context.startedAt,
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
  const job = stored.translationJob ?? null;
  const current = expireStaleJob(job);
  if (current !== job) await chrome.storage.session.set({ translationJob: current });
  return current;
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
