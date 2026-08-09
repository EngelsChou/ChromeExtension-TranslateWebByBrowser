import {
  collectVisibleEnglishTextNodes,
  makeStableId,
  splitOuterWhitespace,
} from './text-nodes.js';

if (!globalThis.__translateWebContentReady) {
  globalThis.__translateWebContentReady = true;

  const idsByNode = new WeakMap();
  const entriesById = new Map();

  function register(node) {
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
  }

  function collect() {
    for (const [id, entry] of entriesById) {
      if (!entry.node.isConnected) entriesById.delete(id);
    }
    return collectVisibleEnglishTextNodes().map(register).map(({ id, original }) => ({ id, text: original }));
  }

  function apply(translations) {
    let applied = 0;
    for (const { id, text } of translations) {
      const entry = entriesById.get(id);
      if (!entry?.node.isConnected || typeof text !== 'string') continue;
      entry.node.data = `${entry.leading}${text}${entry.trailing}`;
      entry.translation = text;
      applied += 1;
    }
    return applied;
  }

  function restore() {
    let restored = 0;
    for (const entry of entriesById.values()) {
      if (!entry.node.isConnected || entry.translation === null) continue;
      entry.node.data = `${entry.leading}${entry.original}${entry.trailing}`;
      entry.translation = null;
      restored += 1;
    }
    return restored;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'COLLECT_TEXT_NODES') sendResponse({ items: collect() });
    else if (message?.type === 'APPLY_TRANSLATIONS') sendResponse({ applied: apply(message.translations ?? []) });
    else if (message?.type === 'RESTORE_TEXT_NODES') sendResponse({ restored: restore() });
  });
}
