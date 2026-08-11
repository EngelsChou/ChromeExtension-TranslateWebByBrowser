import { collectTranslationBlocks, makeStableBlockId } from './text-nodes.js';

if (!globalThis.__translateWebContentReady) {
  globalThis.__translateWebContentReady = true;

  const idsByBlock = new WeakMap();
  const entriesById = new Map();

  function register({ element, text, type, heading }) {
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
      translation: null,
    };
    idsByBlock.set(element, id);
    entriesById.set(id, entry);
    return entry;
  }

  function collect(scope = 'main') {
    for (const [id, entry] of entriesById) {
      if (!entry.element.isConnected) entriesById.delete(id);
    }
    return collectTranslationBlocks({ mode: scope }).map(register).map((entry) => ({
      id: entry.id,
      text: entry.original,
      context: { type: entry.type, heading: entry.heading || undefined },
    }));
  }

  function ensurePresentation(entry) {
    if (entry.originalWrapper?.isConnected && entry.translationElement?.isConnected) return;
    const originalWrapper = document.createElement('span');
    originalWrapper.dataset.twbtOriginal = entry.id;
    originalWrapper.style.display = 'contents';
    while (entry.element.firstChild) originalWrapper.append(entry.element.firstChild);

    const translationElement = document.createElement('span');
    translationElement.dataset.twbtTranslation = entry.id;
    translationElement.setAttribute('lang', 'zh-Hant-TW');
    translationElement.setAttribute('aria-label', '台灣繁體中文翻譯');
    translationElement.style.color = 'inherit';
    translationElement.style.font = 'inherit';
    translationElement.style.lineHeight = 'inherit';

    entry.element.append(originalWrapper, translationElement);
    entry.originalWrapper = originalWrapper;
    entry.translationElement = translationElement;
  }

  function apply(translations, displayMode = 'bilingual') {
    let applied = 0;
    const missing = [];
    for (const { id, text } of translations) {
      const entry = entriesById.get(id);
      if (!entry?.element.isConnected || typeof text !== 'string') {
        missing.push(id);
        continue;
      }
      ensurePresentation(entry);
      entry.translationElement.textContent = text;
      entry.translationElement.style.display = displayMode === 'replace' ? 'contents' : 'block';
      entry.translationElement.style.marginTop = displayMode === 'replace' ? '' : '0.35em';
      entry.translationElement.style.opacity = displayMode === 'replace' ? '' : '0.92';
      entry.originalWrapper.style.display = displayMode === 'replace' ? 'none' : 'contents';
      entry.translation = text;
      applied += 1;
    }
    return { applied, missing };
  }

  function restore() {
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
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'PING_TRANSLATOR') sendResponse({ ready: true });
    else if (message?.type === 'COLLECT_TRANSLATION_BLOCKS') {
      const items = collect(message.scope);
      sendResponse({ items, blocks: items.length });
    } else if (message?.type === 'APPLY_TRANSLATIONS') {
      sendResponse(apply(message.translations ?? [], message.displayMode));
    } else if (message?.type === 'RESTORE_TEXT_NODES') sendResponse({ restored: restore() });
  });
}
