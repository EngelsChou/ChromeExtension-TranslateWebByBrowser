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
    "[data-twbt-translation]"
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

  // src/extension/content-entry.js
  if (!globalThis.__translateWebContentReady) {
    let register = function({ element, text, type, heading }) {
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
    }, collect = function(scope = "main") {
      for (const [id, entry] of entriesById) {
        if (!entry.element.isConnected) entriesById.delete(id);
      }
      return collectTranslationBlocks({ mode: scope }).map(register).map((entry) => ({
        id: entry.id,
        text: entry.original,
        context: { type: entry.type, heading: entry.heading || void 0 }
      }));
    }, ensurePresentation = function(entry) {
      if (entry.originalWrapper?.isConnected && entry.translationElement?.isConnected) return;
      const originalWrapper = document.createElement("span");
      originalWrapper.dataset.twbtOriginal = entry.id;
      originalWrapper.style.display = "contents";
      while (entry.element.firstChild) originalWrapper.append(entry.element.firstChild);
      const translationElement = document.createElement("span");
      translationElement.dataset.twbtTranslation = entry.id;
      translationElement.setAttribute("lang", "zh-Hant-TW");
      translationElement.setAttribute("aria-label", "\u53F0\u7063\u7E41\u9AD4\u4E2D\u6587\u7FFB\u8B6F");
      translationElement.style.color = "inherit";
      translationElement.style.font = "inherit";
      translationElement.style.lineHeight = "inherit";
      entry.element.append(originalWrapper, translationElement);
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
      let restored = 0;
      for (const entry of entriesById.values()) {
        if (!entry.element.isConnected || !entry.originalWrapper?.isConnected) continue;
        while (entry.originalWrapper.firstChild) {
          entry.element.insertBefore(entry.originalWrapper.firstChild, entry.originalWrapper);
        }
        entry.originalWrapper.remove();
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
    const entriesById = /* @__PURE__ */ new Map();
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "PING_TRANSLATOR") sendResponse({ ready: true });
      else if (message?.type === "COLLECT_TRANSLATION_BLOCKS") {
        const items = collect(message.scope);
        sendResponse({ items, blocks: items.length });
      } else if (message?.type === "APPLY_TRANSLATIONS") {
        sendResponse(apply(message.translations ?? [], message.displayMode));
      } else if (message?.type === "RESTORE_TEXT_NODES") sendResponse({ restored: restore() });
    });
  }
})();
