(() => {
  // src/extension/text-nodes.js
  var EXCLUDED_TAGS = /* @__PURE__ */ new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEXTAREA",
    "INPUT",
    "SELECT",
    "OPTION",
    "CODE",
    "PRE",
    "KBD",
    "SAMP",
    "SVG",
    "MATH",
    "CANVAS",
    "TEMPLATE"
  ]);
  var BLOCK_SELECTOR = [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "li",
    "dt",
    "dd",
    "blockquote",
    "figcaption",
    "td",
    "th",
    "summary"
  ].join(",");
  var ALWAYS_EXCLUDED_SELECTOR = [
    '[contenteditable="true"]',
    '[contenteditable=""]',
    '[aria-hidden="true"]',
    "[hidden]",
    "dialog:not([open])",
    '[translate="no"]',
    ".notranslate",
    "[data-twbt-translation]",
    "[data-twbt-ui]"
  ].join(",");
  var PAGE_CHROME_SELECTOR = [
    "nav",
    "header",
    "footer",
    "aside",
    '[role="navigation"]',
    '[role="banner"]',
    '[role="contentinfo"]',
    '[role="complementary"]'
  ].join(",");
  function normalizeBlockText(value) {
    return String(value).replace(/[\t\f\v ]+/gu, " ").replace(/\s*\n\s*/gu, " ").trim();
  }
  function shouldTranslateText(value) {
    const core = normalizeBlockText(value);
    if (core.length < 2 || core.length > 6e3) return false;
    if (!/[A-Za-z]/u.test(core) || !/[A-Za-z]{2,}/u.test(core)) return false;
    if (new RegExp("\\p{Script=Han}", "u").test(core)) return false;
    if (/^(https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/iu.test(core)) return false;
    const letters = core.match(new RegExp("\\p{L}", "gu")) ?? [];
    const latin = core.match(new RegExp("\\p{Script=Latin}", "gu")) ?? [];
    return letters.length > 0 && latin.length / letters.length >= 0.6;
  }
  function isEligibleElement(element, { includePageChrome = false } = {}) {
    if (!element || EXCLUDED_TAGS.has(element.tagName)) return false;
    if (element.closest?.(ALWAYS_EXCLUDED_SELECTOR)) return false;
    if (!includePageChrome && element.closest?.(PAGE_CHROME_SELECTOR)) return false;
    return true;
  }
  function isElementRendered(element) {
    if (!element) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || Number(style.opacity) === 0) return false;
    return Boolean(element.getClientRects().length);
  }
  function isTextNodeVisible(node) {
    const element = node.parentElement;
    if (!isEligibleElement(element, { includePageChrome: true }) || !isElementRendered(element)) return false;
    const range = document.createRange();
    range.selectNodeContents(node);
    const visible = [...range.getClientRects()].some((rect) => rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= innerHeight && rect.left <= innerWidth);
    range.detach();
    return visible;
  }
  function fnv1a(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }
  function nodePath(node) {
    const parts = [];
    let current = node;
    while (current && current !== document.body) {
      const parent = current.parentNode;
      if (!parent) break;
      parts.push([...parent.childNodes].indexOf(current));
      current = parent;
    }
    return parts.reverse().join(".");
  }
  function makeStableId(node, original, collision = 0) {
    const seed = `${location.origin}${location.pathname}|${nodePath(node)}|${original}`;
    return `tn-${fnv1a(seed)}${collision ? `-${collision}` : ""}`;
  }
  function makeStableBlockId(element, original, collision = 0) {
    const seed = `${location.origin}${location.pathname}|${nodePath(element)}|${original}`;
    return `tb-${fnv1a(seed)}${collision ? `-${collision}` : ""}`;
  }
  function englishCharacterCount(element) {
    return (normalizeBlockText(element.innerText).match(/[A-Za-z]/gu) ?? []).length;
  }
  function findContentRoot(mode = "main", pageRoot = document.body) {
    if (!pageRoot || mode === "page") return pageRoot;
    const candidates = [
      ...pageRoot.matches?.('main, article, [role="main"]') ? [pageRoot] : [],
      ...pageRoot.querySelectorAll('main, article, [role="main"]')
    ].filter(isElementRendered);
    const ranked = candidates.map((element) => ({ element, score: englishCharacterCount(element) })).filter(({ score }) => score >= 80).sort((left, right) => right.score - left.score);
    return ranked[0]?.element ?? pageRoot;
  }
  function collectTranslationBlocks({ mode = "main", root = document.body } = {}) {
    const contentRoot = findContentRoot(mode, root);
    if (!contentRoot) return [];
    const includePageChrome = mode === "page";
    const elements = [
      ...contentRoot.matches?.(BLOCK_SELECTOR) ? [contentRoot] : [],
      ...contentRoot.querySelectorAll(BLOCK_SELECTOR)
    ];
    const blocks = [];
    let heading = "";
    for (const element of elements) {
      if (!isEligibleElement(element, { includePageChrome }) || !isElementRendered(element)) continue;
      const nestedBlocks = [...element.querySelectorAll(BLOCK_SELECTOR)].some((nested) => nested !== element && isElementRendered(nested));
      if (nestedBlocks) continue;
      const text = normalizeBlockText(element.innerText);
      if (!shouldTranslateText(text)) continue;
      const type = element.tagName.toLowerCase();
      if (/^h[1-6]$/u.test(type)) heading = text;
      blocks.push({ element, text, type, heading });
    }
    return blocks;
  }
  function collectVisibleEnglishTextNodes(root = document.body) {
    if (!root) return [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return shouldTranslateText(node.data) && isTextNodeVisible(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
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

  // src/extension/content-entry.js
  if (!globalThis.__translateWebContentReady) {
    let viewportDistance = function(element) {
      const rect = element.getBoundingClientRect();
      if (rect.bottom >= 0 && rect.top <= innerHeight) return Math.max(0, rect.top);
      if (rect.top > innerHeight) return innerHeight + rect.top;
      return innerHeight * 2 + Math.abs(rect.bottom);
    }, isInViewport = function(element) {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= innerHeight && rect.left <= innerWidth;
    }, progressElements = function() {
      let panel = document.querySelector('[data-twbt-ui="progress"]');
      if (panel) return {
        panel,
        title: panel.querySelector("[data-twbt-progress-title]"),
        detail: panel.querySelector("[data-twbt-progress-detail]"),
        bar: panel.querySelector("[data-twbt-progress-bar]")
      };
      panel = document.createElement("section");
      panel.dataset.twbtUi = "progress";
      panel.setAttribute("role", "status");
      panel.setAttribute("aria-live", "polite");
      Object.assign(panel.style, {
        position: "fixed",
        right: "20px",
        bottom: "20px",
        zIndex: "2147483647",
        boxSizing: "border-box",
        width: "min(360px, calc(100vw - 32px))",
        padding: "14px 16px",
        border: "1px solid rgba(15, 23, 42, .16)",
        borderRadius: "12px",
        background: "#ffffff",
        color: "#172033",
        boxShadow: "0 12px 34px rgba(15, 23, 42, .22)",
        font: '14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
      });
      panel.innerHTML = '<button type="button" data-twbt-progress-close aria-label="\u95DC\u9589\u7FFB\u8B6F\u9032\u5EA6" style="position:absolute;right:8px;top:7px;border:0;background:transparent;color:#64748b;font:20px/1 system-ui;cursor:pointer">\xD7</button><div data-twbt-progress-title style="padding-right:22px;font-weight:700"></div><div data-twbt-progress-detail style="margin-top:4px;color:#475569"></div><div style="height:5px;margin-top:11px;overflow:hidden;border-radius:999px;background:#e2e8f0"><div data-twbt-progress-bar style="height:100%;width:5%;border-radius:inherit;background:#2563eb;transition:width .25s ease"></div></div>';
      panel.querySelector("[data-twbt-progress-close]").addEventListener("click", () => {
        panel.hidden = true;
        clearInterval(progressTimer);
        progressTimer = null;
      });
      (document.body || document.documentElement).append(panel);
      return {
        panel,
        title: panel.querySelector("[data-twbt-progress-title]"),
        detail: panel.querySelector("[data-twbt-progress-detail]"),
        bar: panel.querySelector("[data-twbt-progress-bar]")
      };
    }, progressCopy = function(job) {
      const provider = job.providerName || (job.provider === "m365" ? "Microsoft 365 Copilot" : "ChatGPT");
      const elapsed = job.startedAt ? Math.max(0, Math.floor((Date.now() - job.startedAt) / 1e3)) : 0;
      const firstResult = job.firstResultMs != null ? `\u9996\u6279 ${Math.max(1, Math.ceil(job.firstResultMs / 1e3))} \u79D2` : "";
      if (job.state === "error") return ["\u7FFB\u8B6F\u5931\u6557", job.error || "\u8ACB\u7A0D\u5F8C\u518D\u8A66\u3002"];
      if (job.state === "complete") {
        const detail = job.message || `\u5DF2\u986F\u793A ${job.translated || 0}/${job.blocks || 0} \u500B\u6BB5\u843D`;
        return ["\u7FFB\u8B6F\u5B8C\u6210", firstResult ? `${detail} \xB7 ${firstResult}` : detail];
      }
      if (job.stage === "collecting") return ["\u6B63\u5728\u5206\u6790\u7DB2\u9801\u5167\u5BB9\u2026", `\u5DF2\u7D93\u904E ${elapsed} \u79D2`];
      if (job.stage === "connecting") return [`\u6B63\u5728\u9023\u63A5 ${provider}\u2026`, `\u5DF2\u627E\u5230 ${job.blocks || 0} \u500B\u82F1\u6587\u6BB5\u843D \xB7 ${elapsed} \u79D2`];
      if (job.stage === "streaming") {
        return ["\u53EF\u8996\u5340\u7FFB\u8B6F\u5DF2\u958B\u59CB\u986F\u793A", `${firstResult} \xB7 \u5DF2\u986F\u793A ${job.translated || 0}/${job.blocks || 0} \u500B\u6BB5\u843D \xB7 ${elapsed} \u79D2`];
      }
      if (job.stage === "applied") {
        return [`\u5DF2\u986F\u793A ${job.translated || 0}/${job.blocks || 0} \u500B\u6BB5\u843D`, `\u7E7C\u7E8C\u7FFB\u8B6F\u7B2C ${Math.min((job.completed || 0) + 1, job.total || 1)}/${job.total || 1} \u6279 \xB7 ${elapsed} \u79D2`];
      }
      const first = !job.completed;
      return [first ? "\u6B63\u5728\u7FFB\u8B6F\u7B2C\u4E00\u6279\u2026" : `\u6B63\u5728\u7FFB\u8B6F\u7B2C ${(job.completed || 0) + 1}/${job.total || 1} \u6279\u2026`, first ? `\u5B8C\u6210\u5F8C\u6703\u7ACB\u5373\u986F\u793A \xB7 ${elapsed} \u79D2` : `\u5DF2\u986F\u793A ${job.translated || 0}/${job.blocks || 0} \u500B\u6BB5\u843D \xB7 ${elapsed} \u79D2`];
    }, showProgress = function(job) {
      currentProgress = job;
      const { panel, title, detail, bar } = progressElements();
      clearTimeout(hideProgressTimer);
      panel.hidden = false;
      const [titleText, detailText] = progressCopy(job);
      title.textContent = titleText;
      detail.textContent = detailText;
      const percent = job.state === "complete" ? 100 : job.total > 0 ? Math.max(5, Math.round((job.completed || 0) / job.total * 100)) : 5;
      bar.style.width = `${percent}%`;
      bar.style.background = job.state === "error" ? "#dc2626" : job.state === "complete" ? "#16a34a" : "#2563eb";
      clearInterval(progressTimer);
      progressTimer = null;
      if (job.state === "preparing" || job.state === "running") {
        progressTimer = setInterval(() => {
          if (!currentProgress || panel.hidden) return;
          const current = expireStaleJob(currentProgress);
          if (current !== currentProgress) {
            currentProgress = current;
            bar.style.background = "#dc2626";
            clearInterval(progressTimer);
            progressTimer = null;
          }
          const copy = progressCopy(currentProgress);
          title.textContent = copy[0];
          detail.textContent = copy[1];
        }, 1e3);
      } else if (job.state === "complete") {
        hideProgressTimer = setTimeout(() => {
          panel.hidden = true;
        }, 7e3);
      }
    }, registerBlock = function({ element, text, type, heading }) {
      const knownId = idsByBlock.get(element);
      if (knownId) return entriesById.get(knownId);
      let collision = 0;
      let id = makeStableBlockId(element, text, collision);
      while (entriesById.has(id) && entriesById.get(id).element !== element) {
        collision += 1;
        id = makeStableBlockId(element, text, collision);
      }
      const entry = {
        id,
        kind: "block",
        element,
        original: text,
        type,
        heading,
        originalWrapper: null,
        translationElement: null,
        translation: null
      };
      idsByBlock.set(element, id);
      entriesById.set(id, entry);
      return entry;
    }, registerTextNode = function(node) {
      const knownId = idsByTextNode.get(node);
      if (knownId) return entriesById.get(knownId);
      const text = normalizeBlockText(node.data);
      let collision = 0;
      let id = makeStableId(node, text, collision);
      while (entriesById.has(id) && entriesById.get(id).node !== node) {
        collision += 1;
        id = makeStableId(node, text, collision);
      }
      const entry = {
        id,
        kind: "text",
        node,
        element: node.parentElement,
        original: text,
        type: node.parentElement?.tagName.toLowerCase() || "text",
        heading: "",
        originalWrapper: null,
        translationElement: null,
        translation: null
      };
      idsByTextNode.set(node, id);
      entriesById.set(id, entry);
      return entry;
    }, collect = function(scope = "main") {
      for (const [id, entry] of entriesById) {
        if (!entry.element.isConnected) entriesById.delete(id);
      }
      const blockEntries = collectTranslationBlocks({ mode: scope }).map(registerBlock);
      const selectedBlocks = new WeakSet(blockEntries.map(({ element }) => element));
      const textEntries = scope === "page" ? collectVisibleEnglishTextNodes().filter((node) => !selectedBlocks.has(node.parentElement?.closest(BLOCK_SELECTOR))).map(registerTextNode) : [];
      return [...blockEntries, ...textEntries].sort((left, right) => viewportDistance(left.element) - viewportDistance(right.element)).map((entry) => ({
        id: entry.id,
        text: entry.original,
        viewport: isInViewport(entry.element),
        context: { type: entry.type, heading: entry.heading || void 0 }
      }));
    }, ensurePresentation = function(entry) {
      if (entry.originalWrapper?.isConnected && entry.translationElement?.isConnected) return;
      const originalWrapper = document.createElement("span");
      originalWrapper.dataset.twbtOriginal = entry.id;
      originalWrapper.style.display = "contents";
      if (entry.kind === "text") {
        entry.node.replaceWith(originalWrapper);
        originalWrapper.append(entry.node);
      } else {
        while (entry.element.firstChild) originalWrapper.append(entry.element.firstChild);
      }
      const translationElement = document.createElement("span");
      translationElement.dataset.twbtTranslation = entry.id;
      translationElement.setAttribute("lang", "zh-Hant-TW");
      translationElement.setAttribute("aria-label", "\u53F0\u7063\u7E41\u9AD4\u4E2D\u6587\u7FFB\u8B6F");
      translationElement.style.color = "inherit";
      translationElement.style.font = "inherit";
      translationElement.style.lineHeight = "inherit";
      if (entry.kind === "text") originalWrapper.after(translationElement);
      else entry.element.append(originalWrapper, translationElement);
      entry.originalWrapper = originalWrapper;
      entry.translationElement = translationElement;
    }, apply = function(translations, displayMode = "bilingual") {
      let applied = 0;
      const missing = [];
      for (const { id, text } of translations) {
        const entry = entriesById.get(id);
        if (!entry?.element.isConnected || typeof text !== "string") {
          missing.push(id);
          continue;
        }
        ensurePresentation(entry);
        entry.translationElement.textContent = text;
        entry.translationElement.style.display = displayMode === "replace" ? "contents" : "block";
        entry.translationElement.style.marginTop = displayMode === "replace" ? "" : "0.35em";
        entry.translationElement.style.opacity = displayMode === "replace" ? "" : "0.92";
        entry.originalWrapper.style.display = displayMode === "replace" ? "none" : "contents";
        entry.translation = text;
        applied += 1;
      }
      return { applied, missing };
    }, restore = function() {
      const panel = document.querySelector('[data-twbt-ui="progress"]');
      if (panel) panel.hidden = true;
      clearInterval(progressTimer);
      clearTimeout(hideProgressTimer);
      progressTimer = null;
      currentProgress = null;
      let restored = 0;
      for (const entry of entriesById.values()) {
        if (!entry.element.isConnected || !entry.originalWrapper?.isConnected) continue;
        if (entry.kind === "text") {
          entry.originalWrapper.replaceWith(entry.node);
        } else {
          while (entry.originalWrapper.firstChild) {
            entry.element.insertBefore(entry.originalWrapper.firstChild, entry.originalWrapper);
          }
          entry.originalWrapper.remove();
        }
        entry.translationElement?.remove();
        entry.originalWrapper = null;
        entry.translationElement = null;
        entry.translation = null;
        restored += 1;
      }
      return restored;
    };
    globalThis.__translateWebContentReady = true;
    const idsByBlock = /* @__PURE__ */ new WeakMap();
    const idsByTextNode = /* @__PURE__ */ new WeakMap();
    const entriesById = /* @__PURE__ */ new Map();
    let progressTimer = null;
    let hideProgressTimer = null;
    let currentProgress = null;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "TRANSLATION_PROGRESS") {
        showProgress(message);
        sendResponse({ shown: true });
      } else if (message?.type === "PING_TRANSLATOR") sendResponse({ ready: true });
      else if (message?.type === "COLLECT_TRANSLATION_BLOCKS") {
        const items = collect(message.scope);
        sendResponse({ items, blocks: items.length });
      } else if (message?.type === "APPLY_TRANSLATIONS") {
        sendResponse(apply(message.translations ?? [], message.displayMode));
      } else if (message?.type === "RESTORE_TEXT_NODES") sendResponse({ restored: restore() });
    });
  }
})();
