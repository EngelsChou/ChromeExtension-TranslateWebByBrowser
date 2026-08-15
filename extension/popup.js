(() => {
  // src/extension/providers.js
  var DEFAULT_PROVIDER = "chatgpt";
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

  // src/extension/popup.js
  var elements = {
    provider: document.querySelector("#provider"),
    scope: document.querySelector("#scope"),
    displayMode: document.querySelector("#display-mode"),
    dot: document.querySelector("#status-dot"),
    title: document.querySelector("#status-title"),
    detail: document.querySelector("#status-detail"),
    translate: document.querySelector("#translate"),
    connect: document.querySelector("#connect"),
    restore: document.querySelector("#restore"),
    error: document.querySelector("#error"),
    progress: document.querySelector("#progress"),
    progressBar: document.querySelector("#progress-bar")
  };
  var providerReady = false;
  function selectedProvider() {
    return getProvider(elements.provider.value);
  }
  function setStatus(kind, title, detail) {
    elements.dot.className = `dot ${kind}`;
    elements.title.textContent = title;
    elements.detail.textContent = detail;
  }
  function showError(message) {
    elements.error.textContent = message;
    elements.error.hidden = !message;
  }
  function showConnectionState(ready) {
    providerReady = ready;
    elements.translate.disabled = !ready;
    elements.connect.hidden = ready;
    elements.connect.textContent = `\u958B\u555F ${selectedProvider().name} \u767B\u5165`;
  }
  function progressPercent(job) {
    if (job.state === "complete") return 100;
    if (!job.total) return 5;
    return Math.max(5, Math.round((job.completed || 0) / job.total * 100));
  }
  async function checkStatus() {
    const provider = selectedProvider();
    setStatus("pending", `\u5DF2\u9078\u64C7 ${provider.name}`, "\u53EA\u6AA2\u67E5\u65E2\u6709\u5206\u9801\uFF0C\u4E0D\u6703\u81EA\u52D5\u958B\u555F\u670D\u52D9\u3002");
    showConnectionState(false);
    const result = await chrome.runtime.sendMessage({ type: "GET_PROVIDER_STATUS", provider: provider.id });
    if (provider.id !== elements.provider.value) return;
    if (result.ok && result.providerReady) {
      setStatus("ok", "\u5DF2\u9023\u7DDA", `${provider.name} \u5DF2\u767B\u5165\uFF0C\u53EF\u4EE5\u958B\u59CB\u7FFB\u8B6F\u3002`);
      showConnectionState(true);
    } else if (result.ok) {
      setStatus(result.blocked ? "error" : "pending", `\u9700\u8981\u8655\u7406 ${provider.name}`, result.message);
      showConnectionState(false);
    } else {
      setStatus("error", `\u7121\u6CD5\u9023\u7DDA ${provider.name}`, result.error);
      showConnectionState(false);
    }
  }
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "TRANSLATION_PROGRESS" || message.provider !== elements.provider.value) return;
    if (message.state === "complete") {
      elements.progress.hidden = false;
      elements.progressBar.style.width = "100%";
      setStatus("ok", "\u7FFB\u8B6F\u5B8C\u6210", `\u5DF2\u8655\u7406 ${message.translated}/${message.blocks} \u500B\u6BB5\u843D`);
      return;
    }
    elements.progress.hidden = false;
    elements.progressBar.style.width = `${progressPercent(message)}%`;
    if (message.state === "error") {
      setStatus("error", "\u7FFB\u8B6F\u5931\u6557", "\u932F\u8AA4\u5DF2\u4FDD\u5B58\uFF0C\u53EF\u6062\u5FA9\u5DF2\u5957\u7528\u7684\u6BB5\u843D\u3002");
      showError(message.error);
      return;
    }
    setStatus("pending", "\u7FFB\u8B6F\u4E2D\u2026", `\u6279\u6B21 ${message.completed}/${message.total}\uFF0C\u5DF2\u8655\u7406 ${message.translated}/${message.blocks} \u500B\u6BB5\u843D`);
  });
  elements.provider.addEventListener("change", async () => {
    showError("");
    elements.progress.hidden = true;
    await chrome.storage.local.set({ translationProvider: elements.provider.value });
    await checkStatus();
  });
  for (const element of [elements.scope, elements.displayMode]) {
    element.addEventListener("change", () => chrome.storage.local.set({
      translationScope: elements.scope.value,
      translationDisplayMode: elements.displayMode.value
    }));
  }
  elements.connect.addEventListener("click", async () => {
    showError("");
    const result = await chrome.runtime.sendMessage({ type: "OPEN_PROVIDER", provider: elements.provider.value });
    if (!result.ok) showError(result.error);
    else window.close();
  });
  elements.translate.addEventListener("click", async () => {
    showError("");
    elements.translate.disabled = true;
    elements.provider.disabled = true;
    elements.scope.disabled = true;
    elements.displayMode.disabled = true;
    elements.progress.hidden = false;
    elements.progressBar.style.width = "0%";
    setStatus("pending", "\u6E96\u5099\u7FFB\u8B6F\u2026", elements.scope.value === "main" ? "\u6B63\u5728\u8FA8\u8B58\u4E3B\u8981\u5167\u5BB9\u8207\u6BB5\u843D" : "\u6B63\u5728\u6383\u63CF\u6BB5\u843D\u8207\u7576\u4E0B\u8996\u7A97\u53EF\u898B\u7684\u529F\u80FD\u9078\u55AE");
    const result = await chrome.runtime.sendMessage({
      type: "TRANSLATE_PAGE",
      provider: elements.provider.value,
      scope: elements.scope.value,
      displayMode: elements.displayMode.value
    });
    if (result.ok) {
      elements.progressBar.style.width = "100%";
      setStatus("ok", "\u7FFB\u8B6F\u5B8C\u6210", result.message || `\u5DF2\u7FFB\u8B6F ${result.translated}/${result.total} \u6BB5\u6587\u5B57`);
    } else {
      setStatus("error", "\u7FFB\u8B6F\u5931\u6557", "\u5DF2\u5957\u7528\u7684\u6279\u6B21\u6703\u4FDD\u7559\uFF0C\u53EF\u6309\u300C\u6062\u5FA9\u539F\u6587\u300D\u9084\u539F\u3002");
      showError(result.error);
    }
    elements.provider.disabled = false;
    elements.scope.disabled = false;
    elements.displayMode.disabled = false;
    elements.translate.disabled = !providerReady;
  });
  elements.restore.addEventListener("click", async () => {
    showError("");
    const result = await chrome.runtime.sendMessage({ type: "RESTORE_PAGE", provider: elements.provider.value });
    if (result.ok) setStatus("ok", "\u5DF2\u6062\u5FA9\u539F\u6587", `\u5DF2\u6062\u5FA9 ${result.restored} \u6BB5\u6587\u5B57`);
    else showError(result.error);
  });
  async function initialize() {
    const stored = await chrome.storage.local.get([
      "translationProvider",
      "translationScope",
      "translationDisplayMode"
    ]);
    elements.provider.value = stored.translationProvider === "m365" ? "m365" : DEFAULT_PROVIDER;
    elements.scope.value = stored.translationScope === "page" ? "page" : "main";
    elements.displayMode.value = stored.translationDisplayMode === "replace" ? "replace" : "bilingual";
    await checkStatus();
    const jobResult = await chrome.runtime.sendMessage({ type: "GET_TRANSLATION_JOB" });
    const job = jobResult.ok ? jobResult.state ? jobResult : null : null;
    if (job?.provider === elements.provider.value) {
      if (job.state === "preparing" || job.state === "running") {
        elements.progress.hidden = false;
        elements.progressBar.style.width = `${progressPercent(job)}%`;
        setStatus("pending", "\u7FFB\u8B6F\u4ECD\u5728\u9032\u884C", job.state === "preparing" ? `\u6B63\u5728\u6E96\u5099\uFF0C\u5171\u627E\u5230 ${job.blocks || 0} \u500B\u6BB5\u843D` : `\u6279\u6B21 ${job.completed}/${job.total}\uFF0C\u5DF2\u8655\u7406 ${job.translated}/${job.blocks} \u500B\u6BB5\u843D`);
      } else if (job.state === "complete") {
        elements.progress.hidden = false;
        elements.progressBar.style.width = "100%";
        setStatus("ok", "\u4E0A\u6B21\u7FFB\u8B6F\u5B8C\u6210", `\u5DF2\u8655\u7406 ${job.translated}/${job.blocks} \u500B\u6BB5\u843D`);
      } else if (job.state === "error") {
        setStatus("error", "\u4E0A\u6B21\u7FFB\u8B6F\u5931\u6557", "\u53EF\u6309\u300C\u6062\u5FA9\u539F\u6587\u300D\u9084\u539F\u5DF2\u5B8C\u6210\u7684\u6279\u6B21\u3002");
        showError(job.error);
      }
    }
  }
  initialize().catch((error) => {
    setStatus("error", "\u521D\u59CB\u5316\u5931\u6557", "\u7121\u6CD5\u9023\u7DDA background service worker");
    showError(error.message);
    showConnectionState(false);
  });
})();
