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
    "CANVAS"
  ]);
  function splitOuterWhitespace(value) {
    const match = String(value).match(/^(\s*)([\s\S]*?)(\s*)$/u);
    return { leading: match[1], core: match[2], trailing: match[3] };
  }
  function shouldTranslateText(value) {
    const { core } = splitOuterWhitespace(value);
    if (core.length < 2 || core.length > 4e3) return false;
    if (!/[A-Za-z]/u.test(core) || !/[A-Za-z]{2,}/u.test(core)) return false;
    if (/^(https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/iu.test(core)) return false;
    const letters = core.match(new RegExp("\\p{L}", "gu")) ?? [];
    const latin = core.match(new RegExp("\\p{Script=Latin}", "gu")) ?? [];
    return letters.length > 0 && latin.length / letters.length >= 0.6;
  }
  function isEligibleElement(element) {
    if (!element || EXCLUDED_TAGS.has(element.tagName)) return false;
    if (element.closest?.('[contenteditable="true"], [contenteditable=""], [aria-hidden="true"], [hidden], dialog:not([open])')) return false;
    return true;
  }
  function isTextNodeVisible(node) {
    const element = node.parentElement;
    if (!isEligibleElement(element)) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || Number(style.opacity) === 0) return false;
    if (!element.getClientRects().length) return false;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()];
    range.detach();
    return rects.some((rect) => rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= innerHeight && rect.left <= innerWidth);
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

  // src/extension/content-entry.js
  if (!globalThis.__translateWebContentReady) {
    let register = function(node) {
      const knownId = idsByNode.get(node);
      if (knownId) return entriesById.get(knownId);
      const { leading, core, trailing } = splitOuterWhitespace(node.data);
      let collision = 0;
      let id = makeStableId(node, core, collision);
      while (entriesById.has(id) && entriesById.get(id).node !== node) {
        collision += 1;
        id = makeStableId(node, core, collision);
      }
      const entry = { id, node, original: core, leading, trailing, translation: null };
      idsByNode.set(node, id);
      entriesById.set(id, entry);
      return entry;
    }, collect = function() {
      for (const [id, entry] of entriesById) {
        if (!entry.node.isConnected) entriesById.delete(id);
      }
      return collectVisibleEnglishTextNodes().map(register).map(({ id, original }) => ({ id, text: original }));
    }, apply = function(translations) {
      let applied = 0;
      for (const { id, text } of translations) {
        const entry = entriesById.get(id);
        if (!entry?.node.isConnected || typeof text !== "string") continue;
        entry.node.data = `${entry.leading}${text}${entry.trailing}`;
        entry.translation = text;
        applied += 1;
      }
      return applied;
    }, restore = function() {
      let restored = 0;
      for (const entry of entriesById.values()) {
        if (!entry.node.isConnected || entry.translation === null) continue;
        entry.node.data = `${entry.leading}${entry.original}${entry.trailing}`;
        entry.translation = null;
        restored += 1;
      }
      return restored;
    };
    globalThis.__translateWebContentReady = true;
    const idsByNode = /* @__PURE__ */ new WeakMap();
    const entriesById = /* @__PURE__ */ new Map();
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "PING_TRANSLATOR") sendResponse({ ready: true });
      else if (message?.type === "COLLECT_TEXT_NODES") sendResponse({ items: collect() });
      else if (message?.type === "APPLY_TRANSLATIONS") sendResponse({ applied: apply(message.translations ?? []) });
      else if (message?.type === "RESTORE_TEXT_NODES") sendResponse({ restored: restore() });
    });
  }
})();
