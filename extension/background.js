(() => {
  // src/extension/batching.js
  function createBatches(items, { maxItems = 30, maxCharacters = 6e3 } = {}) {
    const batches = [];
    let batch = [];
    let characters = 0;
    for (const item of items) {
      const size = item.text.length;
      if (batch.length && (batch.length >= maxItems || characters + size > maxCharacters)) {
        batches.push(batch);
        batch = [];
        characters = 0;
      }
      batch.push(item);
      characters += size;
    }
    if (batch.length) batches.push(batch);
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
      seen.add(item.id);
      return { id: item.id, text: item.text };
    });
    const missing = [...expectedIds].filter((id) => !seen.has(id));
    if (missing.length) throw new Error(`\u670D\u52D9\u7F3A\u5C11 ${missing.length} \u500B\u7FFB\u8B6F ID\uFF1A${missing.slice(0, 3).join(", ")}`);
    if (translations.length !== expectedItems.length) throw new Error("\u670D\u52D9\u56DE\u50B3\u7684\u7FFB\u8B6F\u6578\u91CF\u4E0D\u7B26\u3002");
    return translations;
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
  function announce(detail) {
    chrome.runtime.sendMessage({ type: "TRANSLATION_PROGRESS", ...detail }).catch(() => {
    });
  }
  async function translatePage(providerId) {
    const provider = getProvider(providerId);
    const targetTab = await activeTargetTab();
    await ensureTargetContentScript(targetTab.id);
    const { items } = await chrome.tabs.sendMessage(targetTab.id, { type: "COLLECT_TEXT_NODES" });
    if (!items?.length) return { translated: 0, total: 0, message: "\u76EE\u524D\u756B\u9762\u6C92\u6709\u7B26\u5408\u689D\u4EF6\u7684\u53EF\u898B\u82F1\u6587\u6587\u5B57\u3002" };
    const { tab: providerTab, status } = await findOrCreateProviderTab(provider);
    if (!status.ready) {
      await chrome.tabs.update(providerTab.id, { active: true });
      await chrome.windows.update(providerTab.windowId, { focused: true });
      throw new Error(status.message || `\u8ACB\u5148\u5728 ${provider.name} \u5206\u9801\u5B8C\u6210\u767B\u5165\u6216\u8655\u7406\u5E33\u6236\u63D0\u793A\u3002`);
    }
    const batches = createBatches(items);
    let translated = 0;
    announce({ provider: provider.id, completed: 0, total: batches.length, translated, nodes: items.length });
    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index];
      const result = await chrome.tabs.sendMessage(providerTab.id, {
        type: "PROVIDER_TRANSLATE_BATCH",
        items: batch
      });
      if (!result?.ok) throw new Error(result?.error || `${provider.name} \u6C92\u6709\u56DE\u50B3\u53EF\u7528\u7684\u7FFB\u8B6F\u3002`);
      const translations = validateTranslations(result.translations, batch);
      const applyResult = await chrome.tabs.sendMessage(targetTab.id, {
        type: "APPLY_TRANSLATIONS",
        translations
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
    return chrome.tabs.sendMessage(tab.id, { type: "RESTORE_TEXT_NODES" });
  }
  function enqueueTranslation(providerId) {
    const task = translationQueue.then(() => translatePage(providerId), () => translatePage(providerId));
    translationQueue = task.catch(() => {
    });
    return task;
  }
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const task = message?.type === "GET_PROVIDER_STATUS" ? providerStatus(message.provider) : message?.type === "OPEN_PROVIDER" ? openProvider(message.provider) : message?.type === "TRANSLATE_PAGE" ? enqueueTranslation(message.provider) : message?.type === "RESTORE_PAGE" ? restorePage(message.provider) : null;
    if (!task) return false;
    task.then((result) => sendResponse({ ok: true, ...result })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
})();
