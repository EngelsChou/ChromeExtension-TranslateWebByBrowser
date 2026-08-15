import {
  BLOCK_SELECTOR,
  collectTranslationBlocks,
  collectVisibleEnglishTextNodes,
  makeStableBlockId,
  makeStableId,
  normalizeBlockText,
} from './text-nodes.js';
import { expireStaleJob } from './job-guard.js';

if (!globalThis.__translateWebContentReady) {
  globalThis.__translateWebContentReady = true;

  const idsByBlock = new WeakMap();
  const idsByTextNode = new WeakMap();
  const entriesById = new Map();
  let progressTimer = null;
  let hideProgressTimer = null;
  let currentProgress = null;

  function viewportDistance(element) {
    const rect = element.getBoundingClientRect();
    if (rect.bottom >= 0 && rect.top <= innerHeight) return Math.max(0, rect.top);
    if (rect.top > innerHeight) return innerHeight + rect.top;
    return innerHeight * 2 + Math.abs(rect.bottom);
  }

  function isInViewport(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0
      && rect.top <= innerHeight && rect.left <= innerWidth;
  }

  function progressElements() {
    let panel = document.querySelector('[data-twbt-ui="progress"]');
    if (panel) return {
      panel,
      title: panel.querySelector('[data-twbt-progress-title]'),
      detail: panel.querySelector('[data-twbt-progress-detail]'),
      bar: panel.querySelector('[data-twbt-progress-bar]'),
    };

    panel = document.createElement('section');
    panel.dataset.twbtUi = 'progress';
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');
    Object.assign(panel.style, {
      position: 'fixed', right: '20px', bottom: '20px', zIndex: '2147483647',
      boxSizing: 'border-box', width: 'min(360px, calc(100vw - 32px))',
      padding: '14px 16px', border: '1px solid rgba(15, 23, 42, .16)', borderRadius: '12px',
      background: '#ffffff', color: '#172033', boxShadow: '0 12px 34px rgba(15, 23, 42, .22)',
      font: '14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    });
    panel.innerHTML = '<button type="button" data-twbt-progress-close aria-label="關閉翻譯進度" style="position:absolute;right:8px;top:7px;border:0;background:transparent;color:#64748b;font:20px/1 system-ui;cursor:pointer">×</button><div data-twbt-progress-title style="padding-right:22px;font-weight:700"></div><div data-twbt-progress-detail style="margin-top:4px;color:#475569"></div><div style="height:5px;margin-top:11px;overflow:hidden;border-radius:999px;background:#e2e8f0"><div data-twbt-progress-bar style="height:100%;width:5%;border-radius:inherit;background:#2563eb;transition:width .25s ease"></div></div>';
    panel.querySelector('[data-twbt-progress-close]').addEventListener('click', () => {
      panel.hidden = true;
      clearInterval(progressTimer);
      progressTimer = null;
    });
    (document.body || document.documentElement).append(panel);
    return {
      panel,
      title: panel.querySelector('[data-twbt-progress-title]'),
      detail: panel.querySelector('[data-twbt-progress-detail]'),
      bar: panel.querySelector('[data-twbt-progress-bar]'),
    };
  }

  function progressCopy(job) {
    const provider = job.providerName || (job.provider === 'm365' ? 'Microsoft 365 Copilot' : 'ChatGPT');
    const elapsed = job.startedAt ? Math.max(0, Math.floor((Date.now() - job.startedAt) / 1000)) : 0;
    if (job.state === 'error') return ['翻譯失敗', job.error || '請稍後再試。'];
    if (job.state === 'complete') {
      return ['翻譯完成', job.message || `已顯示 ${job.translated || 0}/${job.blocks || 0} 個段落`];
    }
    if (job.stage === 'collecting') return ['正在分析網頁內容…', `已經過 ${elapsed} 秒`];
    if (job.stage === 'connecting') return [`正在連接 ${provider}…`, `已找到 ${job.blocks || 0} 個英文段落 · ${elapsed} 秒`];
    if (job.stage === 'streaming') {
      return ['可視區翻譯已開始顯示', `已顯示 ${job.translated || 0}/${job.blocks || 0} 個段落 · ${elapsed} 秒`];
    }
    if (job.stage === 'applied') {
      return [`已顯示 ${job.translated || 0}/${job.blocks || 0} 個段落`, `繼續翻譯第 ${Math.min((job.completed || 0) + 1, job.total || 1)}/${job.total || 1} 批 · ${elapsed} 秒`];
    }
    const first = !job.completed;
    return [first ? '正在翻譯第一批…' : `正在翻譯第 ${(job.completed || 0) + 1}/${job.total || 1} 批…`, first ? `完成後會立即顯示 · ${elapsed} 秒` : `已顯示 ${job.translated || 0}/${job.blocks || 0} 個段落 · ${elapsed} 秒`];
  }

  function showProgress(job) {
    currentProgress = job;
    const { panel, title, detail, bar } = progressElements();
    clearTimeout(hideProgressTimer);
    panel.hidden = false;
    const [titleText, detailText] = progressCopy(job);
    title.textContent = titleText;
    detail.textContent = detailText;
    const percent = job.state === 'complete' ? 100
      : job.total > 0 ? Math.max(5, Math.round(((job.completed || 0) / job.total) * 100)) : 5;
    bar.style.width = `${percent}%`;
    bar.style.background = job.state === 'error' ? '#dc2626' : job.state === 'complete' ? '#16a34a' : '#2563eb';

    clearInterval(progressTimer);
    progressTimer = null;
    if (job.state === 'preparing' || job.state === 'running') {
      progressTimer = setInterval(() => {
        if (!currentProgress || panel.hidden) return;
        const current = expireStaleJob(currentProgress);
        if (current !== currentProgress) {
          currentProgress = current;
          bar.style.background = '#dc2626';
          clearInterval(progressTimer);
          progressTimer = null;
        }
        const copy = progressCopy(currentProgress);
        title.textContent = copy[0];
        detail.textContent = copy[1];
      }, 1_000);
    } else if (job.state === 'complete') {
      hideProgressTimer = setTimeout(() => { panel.hidden = true; }, 7_000);
    }
  }

  function registerBlock({ element, text, type, heading }) {
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
      kind: 'block',
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

  function registerTextNode(node) {
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
      kind: 'text',
      node,
      element: node.parentElement,
      original: text,
      type: node.parentElement?.tagName.toLowerCase() || 'text',
      heading: '',
      originalWrapper: null,
      translationElement: null,
      translation: null,
    };
    idsByTextNode.set(node, id);
    entriesById.set(id, entry);
    return entry;
  }

  function collect(scope = 'main') {
    for (const [id, entry] of entriesById) {
      if (!entry.element.isConnected) entriesById.delete(id);
    }
    const blockEntries = collectTranslationBlocks({ mode: scope }).map(registerBlock);
    const selectedBlocks = new WeakSet(blockEntries.map(({ element }) => element));
    const textEntries = scope === 'page'
      ? collectVisibleEnglishTextNodes()
        .filter((node) => !selectedBlocks.has(node.parentElement?.closest(BLOCK_SELECTOR)))
        .map(registerTextNode)
      : [];
    return [...blockEntries, ...textEntries]
      .sort((left, right) => viewportDistance(left.element) - viewportDistance(right.element))
      .map((entry) => ({
      id: entry.id,
      text: entry.original,
      viewport: isInViewport(entry.element),
      context: { type: entry.type, heading: entry.heading || undefined },
    }));
  }

  function ensurePresentation(entry) {
    if (entry.originalWrapper?.isConnected && entry.translationElement?.isConnected) return;
    const originalWrapper = document.createElement('span');
    originalWrapper.dataset.twbtOriginal = entry.id;
    originalWrapper.style.display = 'contents';
    if (entry.kind === 'text') {
      entry.node.replaceWith(originalWrapper);
      originalWrapper.append(entry.node);
    } else {
      while (entry.element.firstChild) originalWrapper.append(entry.element.firstChild);
    }

    const translationElement = document.createElement('span');
    translationElement.dataset.twbtTranslation = entry.id;
    translationElement.setAttribute('lang', 'zh-Hant-TW');
    translationElement.setAttribute('aria-label', '台灣繁體中文翻譯');
    translationElement.style.color = 'inherit';
    translationElement.style.font = 'inherit';
    translationElement.style.lineHeight = 'inherit';

    if (entry.kind === 'text') originalWrapper.after(translationElement);
    else entry.element.append(originalWrapper, translationElement);
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
    const panel = document.querySelector('[data-twbt-ui="progress"]');
    if (panel) panel.hidden = true;
    clearInterval(progressTimer);
    clearTimeout(hideProgressTimer);
    progressTimer = null;
    currentProgress = null;
    let restored = 0;
    for (const entry of entriesById.values()) {
      if (!entry.element.isConnected || !entry.originalWrapper?.isConnected) continue;
      if (entry.kind === 'text') {
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
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'TRANSLATION_PROGRESS') {
      showProgress(message);
      sendResponse({ shown: true });
    } else if (message?.type === 'PING_TRANSLATOR') sendResponse({ ready: true });
    else if (message?.type === 'COLLECT_TRANSLATION_BLOCKS') {
      const items = collect(message.scope);
      sendResponse({ items, blocks: items.length });
    } else if (message?.type === 'APPLY_TRANSLATIONS') {
      sendResponse(apply(message.translations ?? [], message.displayMode));
    } else if (message?.type === 'RESTORE_TEXT_NODES') sendResponse({ restored: restore() });
  });
}
