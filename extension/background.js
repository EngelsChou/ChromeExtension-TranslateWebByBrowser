(() => {
  // src/extension/batching.js
  function createBatches(items, {
    maxItems = 12,
    maxCharacters = 2400,
    viewportMaxItems = 4,
    viewportMaxCharacters = 1e3,
    firstMaxItems = 1,
    firstMaxCharacters = Math.min(450, maxCharacters)
  } = {}) {
    const batches = [];
    const viewportItems = items.filter((item) => item.viewport);
    const offscreenItems = items.filter((item) => !item.viewport);
    const queuedItems = [...viewportItems, ...offscreenItems];
    function appendBatches(group, itemLimit, characterLimit) {
      let batch = [];
      let characters = 0;
      for (const item of group) {
        const size = item.text.length;
        if (batch.length && (batch.length >= itemLimit || characters + size > characterLimit)) {
          batches.push(batch);
          batch = [];
          characters = 0;
        }
        batch.push(item);
        characters += size;
      }
      if (batch.length) batches.push(batch);
    }
    if (queuedItems.length) {
      appendBatches(queuedItems.slice(0, firstMaxItems), firstMaxItems, firstMaxCharacters);
    }
    const firstIds = new Set(batches.flat().map(({ id }) => id));
    appendBatches(
      viewportItems.filter(({ id }) => !firstIds.has(id)),
      viewportMaxItems,
      viewportMaxCharacters
    );
    appendBatches(
      offscreenItems.filter(({ id }) => !firstIds.has(id)),
      maxItems,
      maxCharacters
    );
    return batches;
  }

  // src/extension/chatgpt-core.js
  function validateTranslations(payload, expectedItems) {
    if (!Array.isArray(payload)) throw new Error("\u7FFB\u8B6F\u8CC7\u6599\u5FC5\u9808\u662F\u9663\u5217\u3002");
    const expectedIds = new Set(expectedItems.map((item) => item.id));
    const seen = /* @__PURE__ */ new Set();
    const translations = payload.map((item) => {
      if (!item || typeof item.id !== "string" || typeof item.text !== "string") {
        throw new Error("JSON \u7684\u6BCF\u500B\u7FFB\u8B6F\u90FD\u5FC5\u9808\u5305\u542B\u5B57\u4E32 id \u8207 text\u3002");
      }
      if (!expectedIds.has(item.id)) throw new Error(`\u670D\u52D9\u56DE\u50B3\u4E86\u672A\u77E5 ID\uFF1A${item.id}`);
      if (seen.has(item.id)) throw new Error(`\u670D\u52D9\u56DE\u50B3\u4E86\u91CD\u8907 ID\uFF1A${item.id}`);
      if (!item.text.trim()) throw new Error(`\u670D\u52D9\u56DE\u50B3\u7A7A\u767D\u7FFB\u8B6F\uFF1A${item.id}`);
      const source = expectedItems.find((expected) => expected.id === item.id)?.text ?? "";
      const sourceWords = source.match(/[A-Za-z][A-Za-z'-]*/gu) ?? [];
      if (sourceWords.length >= 4 && source.length >= 24 && !/[\p{Script=Han}]/u.test(item.text)) {
        throw new Error(`\u670D\u52D9\u56DE\u50B3\u7684\u5167\u5BB9\u4E0D\u50CF\u53F0\u7063\u7E41\u9AD4\u4E2D\u6587\uFF1A${item.id}`);
      }
      seen.add(item.id);
      return { id: item.id, text: item.text };
    });
    const missing = [...expectedIds].filter((id) => !seen.has(id));
    if (missing.length) throw new Error(`\u670D\u52D9\u7F3A\u5C11 ${missing.length} \u500B\u7FFB\u8B6F ID\uFF1A${missing.slice(0, 3).join(", ")}`);
    if (translations.length !== expectedItems.length) throw new Error("\u670D\u52D9\u56DE\u50B3\u7684\u7FFB\u8B6F\u6578\u91CF\u4E0D\u7B26\u3002");
    return translations;
  }

  // src/extension/job-guard.js
  var PROVIDER_BATCH_TIMEOUT_MS = 12e4;
  var TRANSLATION_JOB_TIMEOUT_MS = 8 * 6e4;
  var TRANSLATION_JOB_STALE_MS = PROVIDER_BATCH_TIMEOUT_MS + 3e4;
  function isActiveJob(job) {
    return job?.state === "preparing" || job?.state === "running";
  }
  function expireStaleJob(job, now = Date.now()) {
    if (!isActiveJob(job) || !job.updatedAt || now - job.updatedAt <= TRANSLATION_JOB_STALE_MS) return job;
    return {
      ...job,
      state: "error",
      stage: "error",
      stale: true,
      error: `\u7FFB\u8B6F\u5DE5\u4F5C\u5DF2\u8D85\u904E ${Math.round(TRANSLATION_JOB_STALE_MS / 1e3)} \u79D2\u6C92\u6709\u9032\u5EA6\uFF0C\u5DF2\u81EA\u52D5\u505C\u6B62\u3002\u5DF2\u5B8C\u6210\u7684\u4E2D\u6587\u4ECD\u6703\u4FDD\u7559\uFF0C\u53EF\u91CD\u8A66\u6216\u6062\u5FA9\u539F\u6587\u3002`,
      updatedAt: now
    };
  }
  function withTimeout(promise, timeoutMs, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(message);
        error.code = "TRANSLATION_TIMEOUT";
        reject(error);
      }, timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }
  function remainingItems(items, appliedIds) {
    return items.filter(({ id }) => !appliedIds.has(id));
  }
  function splitRetryItems(items) {
    if (items.length <= 1) return [items];
    const midpoint = Math.ceil(items.length / 2);
    return [items.slice(0, midpoint), items.slice(midpoint)];
  }

  // src/extension/providers.js
  var PROVIDERS = Object.freeze({
    chatgpt: Object.freeze({
      id: "chatgpt",
      name: "ChatGPT",
      homeUrl: "https://chatgpt.com/",
      tabPatterns: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
      ownedUrl: /^https:\/\/(?:chatgpt\.com|chat\.openai\.com)(?:\/|$)/u,
      contentScript: "chatgpt-content.js"
    }),
    m365: Object.freeze({
      id: "m365",
      name: "Microsoft 365 Copilot",
      homeUrl: "https://m365.cloud.microsoft/chat/",
      tabPatterns: ["https://m365.cloud.microsoft/*"],
      ownedUrl: /^https:\/\/m365\.cloud\.microsoft(?:\/|$)/u,
      contentScript: "m365-content.js"
    })
  });
  function getProvider(id) {
    const provider = PROVIDERS[id];
    if (!provider) throw new Error(`\u4E0D\u652F\u63F4\u7684\u7FFB\u8B6F\u670D\u52D9\uFF1A${String(id)}`);
    return provider;
  }

  // src/extension/background.js
  var translationQueue = Promise.resolve();
  var pendingRequests = /* @__PURE__ */ new Map();
  async function activeTargetTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("\u627E\u4E0D\u5230\u76EE\u524D\u4F5C\u7528\u4E2D\u7684\u5206\u9801\u3002");
    if (/^(chrome|edge|about|devtools):/u.test(tab.url ?? "")) {
      throw new Error("Chrome \u5167\u5EFA\u9801\u9762\u4E0D\u5141\u8A31 Extension \u7FFB\u8B6F\uFF0C\u8ACB\u5207\u63DB\u5230\u4E00\u822C\u7DB2\u9801\u3002");
    }
    const service = Object.values(PROVIDERS).find((candidate) => candidate.ownedUrl.test(tab.url ?? ""));
    if (service) {
      throw new Error(`${service.name} \u5206\u9801\u4E0D\u80FD\u540C\u6642\u4F5C\u70BA\u7FFB\u8B6F\u76EE\u6A19\uFF0C\u8ACB\u56DE\u5230\u8981\u7FFB\u8B6F\u7684\u7DB2\u9801\u518D\u958B\u555F popup\u3002`);
    }
    return tab;
  }
  async function ensureTargetContentScript(tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "PING_TRANSLATOR" });
    } catch {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    }
  }
  async function waitForProviderContent(tabId, provider, timeout = 25e3) {
    const deadline = Date.now() + timeout;
    let lastError;
    let injected = false;
    while (Date.now() < deadline) {
      try {
        return await chrome.tabs.sendMessage(tabId, { type: "PROVIDER_STATUS" });
      } catch (error) {
        lastError = error;
        if (!injected) {
          try {
            await chrome.scripting.executeScript({ target: { tabId }, files: [provider.contentScript] });
            injected = true;
          } catch {
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }
    throw new Error(`${provider.name} \u5206\u9801\u8F09\u5165\u903E\u6642\uFF1A${lastError?.message ?? "content script \u5C1A\u672A\u5C31\u7DD2"}`);
  }
  async function findExistingProviderTab(provider) {
    const tabs = await chrome.tabs.query({ url: provider.tabPatterns });
    return tabs.find((candidate) => candidate.status === "complete" && !candidate.discarded) ?? tabs.find((candidate) => !candidate.discarded) ?? null;
  }
  async function findOrCreateProviderTab(provider) {
    let tab = await findExistingProviderTab(provider);
    if (!tab) tab = await chrome.tabs.create({ url: provider.homeUrl, active: false });
    if (!tab?.id) throw new Error(`\u7121\u6CD5\u5EFA\u7ACB ${provider.name} \u5206\u9801\u3002`);
    await chrome.tabs.update(tab.id, { autoDiscardable: false });
    let status = await waitForProviderContent(tab.id, provider);
    if (status.blocked) return { tab, status };
    if (status.hasDraft) {
      tab = await chrome.tabs.create({ url: provider.homeUrl, active: false });
      if (!tab?.id) throw new Error(`\u7121\u6CD5\u5EFA\u7ACB\u6C92\u6709\u65E2\u5B58\u8349\u7A3F\u7684 ${provider.name} \u5206\u9801\u3002`);
      await chrome.tabs.update(tab.id, { autoDiscardable: false });
      status = await waitForProviderContent(tab.id, provider);
    }
    return { tab, status };
  }
  async function createProviderWorker(provider, sourceTab, targetTab) {
    let workerTab;
    let workerWindow;
    try {
      workerTab = await chrome.tabs.create({ url: provider.homeUrl, active: false });
      if (!workerTab?.id) throw new Error("\u7121\u6CD5\u5EFA\u7ACB\u4E7E\u6DE8\u7684 provider \u5DE5\u4F5C\u5206\u9801");
      await chrome.tabs.update(workerTab.id, { autoDiscardable: false });
      workerWindow = await chrome.windows.create({
        tabId: workerTab.id,
        type: "popup",
        focused: false,
        width: 520,
        height: 760
      });
      if (!workerWindow?.id) throw new Error("\u7121\u6CD5\u5EFA\u7ACB provider \u5DE5\u4F5C\u8996\u7A97");
      await chrome.tabs.update(workerTab.id, { active: true, autoDiscardable: false });
      await chrome.tabs.update(targetTab.id, { active: true });
      await chrome.windows.update(targetTab.windowId, { focused: true });
      const status = await waitForProviderContent(workerTab.id, provider);
      if (!status.ready || status.blocked || status.hasDraft) {
        throw new Error(status.message || `${provider.name} \u5DE5\u4F5C\u8996\u7A97\u5C1A\u672A\u5C31\u7DD2\u3002`);
      }
      return {
        tab: workerTab,
        dedicated: true,
        async close() {
          try {
            await chrome.windows.remove(workerWindow.id);
          } catch {
          }
        }
      };
    } catch (error) {
      if (workerWindow?.id) {
        try {
          await chrome.windows.remove(workerWindow.id);
        } catch {
        }
      } else if (workerTab?.id) {
        try {
          await chrome.tabs.remove(workerTab.id);
        } catch {
        }
      }
      let fallbackTab;
      try {
        fallbackTab = await chrome.tabs.create({ url: provider.homeUrl, active: false });
        if (!fallbackTab?.id) throw new Error("\u7121\u6CD5\u5EFA\u7ACB\u4E7E\u6DE8\u7684 provider \u5099\u63F4\u5206\u9801");
        await chrome.tabs.update(fallbackTab.id, { autoDiscardable: false });
        const status = await waitForProviderContent(fallbackTab.id, provider);
        if (!status.ready || status.blocked || status.hasDraft) {
          throw new Error(status.message || `${provider.name} \u5099\u63F4\u5206\u9801\u5C1A\u672A\u5C31\u7DD2\u3002`);
        }
        return {
          tab: fallbackTab,
          dedicated: false,
          warning: `\u7121\u6CD5\u5EFA\u7ACB\u4F5C\u7528\u4E2D\u7684 provider \u5DE5\u4F5C\u8996\u7A97\uFF0C\u6539\u7528\u4E7E\u6DE8\u7684\u80CC\u666F\u5206\u9801\uFF1A${error.message}`,
          async close() {
            try {
              await chrome.tabs.remove(fallbackTab.id);
            } catch {
            }
          }
        };
      } catch (fallbackError) {
        if (fallbackTab?.id) {
          try {
            await chrome.tabs.remove(fallbackTab.id);
          } catch {
          }
        }
        return {
          tab: sourceTab,
          dedicated: false,
          warning: `\u7121\u6CD5\u5EFA\u7ACB\u4E7E\u6DE8\u7684 provider \u5DE5\u4F5C\u9801\uFF0C\u6700\u5F8C\u6539\u7528\u65E2\u6709\u5206\u9801\uFF1A${error.message}\uFF1B${fallbackError.message}`,
          async close() {
          }
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
        message: `\u5C1A\u672A\u958B\u555F ${provider.name}\u3002\u8ACB\u5148\u78BA\u8A8D\u9078\u64C7\uFF0C\u518D\u6309\u4E0B\u65B9\u767B\u5165\u6309\u9215\u3002`
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
      message: status.message ?? (status.ready ? `${provider.name} \u5206\u9801\u5DF2\u767B\u5165\uFF0C\u53EF\u4EE5\u7FFB\u8B6F\u3002` : `\u8ACB\u5728\u525B\u958B\u555F\u7684 ${provider.name} \u5206\u9801\u5B8C\u6210\u767B\u5165\uFF0C\u518D\u56DE\u5230\u539F\u7DB2\u9801\u3002`)
    };
  }
  async function openProvider(providerId) {
    const provider = getProvider(providerId);
    let tab = await findExistingProviderTab(provider);
    if (!tab) tab = await chrome.tabs.create({ url: provider.homeUrl, active: true });
    if (!tab?.id) throw new Error(`\u7121\u6CD5\u5EFA\u7ACB ${provider.name} \u5206\u9801\u3002`);
    await chrome.tabs.update(tab.id, { active: true, autoDiscardable: false });
    await chrome.windows.update(tab.windowId, { focused: true });
    return { provider: provider.id, providerName: provider.name, tabId: tab.id };
  }
  function updateJob(detail, targetTabId) {
    const job = { updatedAt: Date.now(), ...detail, ...targetTabId ? { targetTabId } : {} };
    chrome.storage.session.set({ translationJob: job }).catch(() => {
    });
    chrome.runtime.sendMessage({ type: "TRANSLATION_PROGRESS", ...job }).catch(() => {
    });
    if (targetTabId) {
      chrome.tabs.sendMessage(targetTabId, { type: "TRANSLATION_PROGRESS", ...job }).catch(() => {
      });
    }
    return job;
  }
  function applyPartialTranslations(message, sender) {
    const pending = pendingRequests.get(message.requestId);
    if (!pending || sender.tab?.id !== pending.providerTabId) return Promise.resolve({ ignored: true });
    pending.applyChain = pending.applyChain.then(async () => {
      const candidates = (message.translations ?? []).filter(({ id }) => !pending.appliedIds.has(id));
      if (!candidates.length) return { applied: 0, duplicate: true };
      const candidateIds = new Set(candidates.map(({ id }) => id));
      const expectedItems = pending.batch.filter(({ id }) => candidateIds.has(id));
      const translations = validateTranslations(candidates, expectedItems);
      const result = await chrome.tabs.sendMessage(pending.targetTabId, {
        type: "APPLY_TRANSLATIONS",
        translations,
        displayMode: pending.displayMode
      });
      if (result.applied !== translations.length) {
        throw new Error("\u539F\u7DB2\u9801\u5728\u4E32\u6D41\u7FFB\u8B6F\u671F\u9593\u5DF2\u91CD\u7E6A\uFF0C\u7121\u6CD5\u5B89\u5168\u5957\u7528\u6BB5\u843D\u3002");
      }
      translations.forEach(({ id }) => {
        pending.appliedIds.add(id);
        pending.context.appliedIds.add(id);
      });
      pending.context.translated = (pending.context.translated ?? 0) + result.applied;
      updateJob({
        state: "running",
        stage: "streaming",
        provider: pending.provider.id,
        providerName: pending.provider.name,
        scope: pending.scope,
        displayMode: pending.displayMode,
        completed: pending.batchIndex,
        total: pending.totalBatches,
        translated: pending.context.translated,
        blocks: pending.context.blocks,
        startedAt: pending.context.startedAt
      }, pending.targetTabId);
      return result;
    });
    return pending.applyChain;
  }
  async function translatePage(providerId, { scope = "main", displayMode = "bilingual" } = {}, context = {}) {
    const provider = getProvider(providerId);
    const targetTab = await activeTargetTab();
    context.targetTabId = targetTab.id;
    context.startedAt = Date.now();
    context.deadline = context.startedAt + TRANSLATION_JOB_TIMEOUT_MS;
    context.appliedIds = /* @__PURE__ */ new Set();
    context.completed = 0;
    await ensureTargetContentScript(targetTab.id);
    updateJob({
      state: "preparing",
      stage: "collecting",
      provider: provider.id,
      providerName: provider.name,
      scope,
      displayMode,
      completed: 0,
      total: 0,
      translated: 0,
      blocks: 0,
      startedAt: context.startedAt
    }, targetTab.id);
    const { items } = await chrome.tabs.sendMessage(targetTab.id, {
      type: "COLLECT_TRANSLATION_BLOCKS",
      scope
    });
    context.blocks = items?.length ?? 0;
    if (!items?.length) return { translated: 0, total: 0, batches: 0, message: "\u627E\u4E0D\u5230\u7B26\u5408\u689D\u4EF6\u7684\u82F1\u6587\u4E3B\u8981\u5167\u5BB9\u3002" };
    updateJob({
      state: "preparing",
      stage: "connecting",
      provider: provider.id,
      providerName: provider.name,
      scope,
      displayMode,
      completed: 0,
      total: 0,
      translated: 0,
      blocks: items.length,
      startedAt: context.startedAt
    }, targetTab.id);
    const { tab: providerTab, status } = await findOrCreateProviderTab(provider);
    if (!status.ready) {
      await chrome.tabs.update(providerTab.id, { active: true });
      await chrome.windows.update(providerTab.windowId, { focused: true });
      throw new Error(status.message || `\u8ACB\u5148\u5728 ${provider.name} \u5206\u9801\u5B8C\u6210\u767B\u5165\u6216\u8655\u7406\u5E33\u6236\u63D0\u793A\u3002`);
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
        const error = new Error(`\u6574\u9AD4\u7FFB\u8B6F\u5DF2\u8D85\u904E ${Math.round(TRANSLATION_JOB_TIMEOUT_MS / 6e4)} \u5206\u9418\uFF0C\u5DF2\u81EA\u52D5\u505C\u6B62\u3002`);
        error.code = "TRANSLATION_TIMEOUT";
        throw error;
      }
      updateJob({
        state: "running",
        stage: retryAttempt ? "retrying" : "waiting",
        provider: provider.id,
        providerName: provider.name,
        scope,
        displayMode,
        completed: batchIndex,
        total: batches.length,
        translated: context.translated,
        blocks: items.length,
        retryAttempt,
        workerActive: worker.dedicated,
        warning: worker.warning,
        startedAt: context.startedAt
      }, targetTab.id);
      const requestId = crypto.randomUUID();
      const pending = {
        requestId,
        providerTabId: worker.tab.id,
        provider,
        targetTabId: targetTab.id,
        batch: outstanding,
        batchIndex,
        totalBatches: batches.length,
        displayMode,
        scope,
        context,
        appliedIds: /* @__PURE__ */ new Set(),
        applyChain: Promise.resolve()
      };
      pendingRequests.set(requestId, pending);
      let failure;
      try {
        const timeoutMs = Math.min(PROVIDER_BATCH_TIMEOUT_MS, remainingJobTime);
        const result = await withTimeout(chrome.tabs.sendMessage(worker.tab.id, {
          type: "PROVIDER_TRANSLATE_BATCH",
          items: outstanding,
          requestId
        }), timeoutMs, `${provider.name} \u672C\u6279\u7B49\u5F85\u8D85\u904E ${Math.round(timeoutMs / 1e3)} \u79D2\u3002`);
        await pending.applyChain;
        if (!result?.ok) throw new Error(result?.error || `${provider.name} \u6C92\u6709\u56DE\u50B3\u53EF\u7528\u7684\u7FFB\u8B6F\u3002`);
        const translations = validateTranslations(result.translations, outstanding);
        const unapplied = remainingItems(translations, context.appliedIds);
        if (unapplied.length) {
          const applyResult = await chrome.tabs.sendMessage(targetTab.id, {
            type: "APPLY_TRANSLATIONS",
            translations: unapplied,
            displayMode
          });
          if (applyResult.applied !== unapplied.length) {
            throw new Error(`\u539F\u7DB2\u9801\u5728\u7FFB\u8B6F\u671F\u9593\u5DF2\u91CD\u7E6A\uFF0C${unapplied.length - applyResult.applied} \u500B\u6BB5\u843D\u7121\u6CD5\u5B89\u5168\u5957\u7528\u3002`);
          }
          unapplied.forEach(({ id }) => context.appliedIds.add(id));
          context.translated += applyResult.applied;
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
      }
      if (!failure) return;
      const remaining = remainingItems(outstanding, context.appliedIds);
      if (!remaining.length) return;
      if (retryAttempt >= 2 || Date.now() >= context.deadline) {
        const error = new Error(
          `${provider.name} \u4ECD\u6709 ${remaining.length} \u500B\u6BB5\u843D\u672A\u5B8C\u6210\uFF0C\u5DF2\u505C\u6B62\u91CD\u8A66\uFF1B\u5DF2\u5B8C\u6210\u7684 ${context.translated}/${items.length} \u500B\u6BB5\u843D\u6703\u4FDD\u7559\u3002\u539F\u56E0\uFF1A${failure.message}`
        );
        error.code = failure.code;
        throw error;
      }
      updateJob({
        state: "running",
        stage: "retrying",
        provider: provider.id,
        providerName: provider.name,
        scope,
        displayMode,
        completed: batchIndex,
        total: batches.length,
        translated: context.translated,
        blocks: items.length,
        retryAttempt: retryAttempt + 1,
        warning: `${failure.message} \u5C07\u5269\u9918 ${remaining.length} \u500B\u6BB5\u843D\u62C6\u5C0F\u91CD\u8A66\u3002`,
        startedAt: context.startedAt
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
          state: "running",
          stage: "applied",
          provider: provider.id,
          providerName: provider.name,
          scope,
          displayMode,
          completed: context.completed,
          total: batches.length,
          translated: context.translated,
          blocks: items.length,
          workerActive: worker.dedicated,
          warning: worker.warning,
          startedAt: context.startedAt
        }, targetTab.id);
      }
    } finally {
      await worker.close();
    }
    return { translated: context.translated, total: items.length, batches: batches.length };
  }
  async function restorePage(providerId) {
    getProvider(providerId);
    const tab = await activeTargetTab();
    await ensureTargetContentScript(tab.id);
    return chrome.tabs.sendMessage(tab.id, { type: "RESTORE_TEXT_NODES" });
  }
  function enqueueTranslation(providerId, options) {
    const context = {};
    const execute = async () => {
      try {
        const result = await translatePage(providerId, options, context);
        updateJob({
          state: "complete",
          stage: "complete",
          provider: providerId,
          providerName: getProvider(providerId).name,
          ...options,
          completed: result.batches,
          total: result.batches,
          translated: result.translated,
          blocks: result.total,
          message: result.message,
          startedAt: context.startedAt
        }, context.targetTabId);
        return result;
      } catch (error) {
        updateJob({
          state: "error",
          stage: "error",
          provider: providerId,
          providerName: getProvider(providerId).name,
          ...options,
          error: error.message,
          completed: context.completed ?? 0,
          total: context.total ?? 0,
          translated: context.translated ?? 0,
          blocks: context.blocks ?? 0,
          startedAt: context.startedAt
        }, context.targetTabId);
        throw error;
      }
    };
    const task = translationQueue.then(execute, execute);
    translationQueue = task.catch(() => {
    });
    return task;
  }
  async function translationJob() {
    const stored = await chrome.storage.session.get("translationJob");
    const job = stored.translationJob ?? null;
    const current = expireStaleJob(job);
    if (current !== job) await chrome.storage.session.set({ translationJob: current });
    return current;
  }
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const task = message?.type === "PROVIDER_TRANSLATION_PARTIAL" ? applyPartialTranslations(message, _sender) : message?.type === "GET_PROVIDER_STATUS" ? providerStatus(message.provider) : message?.type === "OPEN_PROVIDER" ? openProvider(message.provider) : message?.type === "TRANSLATE_PAGE" ? enqueueTranslation(message.provider, {
      scope: message.scope === "page" ? "page" : "main",
      displayMode: message.displayMode === "replace" ? "replace" : "bilingual"
    }) : message?.type === "RESTORE_PAGE" ? restorePage(message.provider) : message?.type === "GET_TRANSLATION_JOB" ? translationJob() : null;
    if (!task) return false;
    task.then((result) => sendResponse({ ok: true, ...result })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
})();
