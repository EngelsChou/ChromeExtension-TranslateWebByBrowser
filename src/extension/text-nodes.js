const EXCLUDED_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
  'CODE', 'PRE', 'KBD', 'SAMP', 'SVG', 'MATH', 'CANVAS', 'TEMPLATE',
]);

export const BLOCK_SELECTOR = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'dt', 'dd',
  'blockquote', 'figcaption', 'td', 'th', 'summary',
].join(',');

const ALWAYS_EXCLUDED_SELECTOR = [
  '[contenteditable="true"]', '[contenteditable=""]', '[aria-hidden="true"]',
  '[hidden]', 'dialog:not([open])', '[translate="no"]', '.notranslate',
  '[data-twbt-translation]', '[data-twbt-ui]',
].join(',');

const PAGE_CHROME_SELECTOR = [
  'nav', 'header', 'footer', 'aside', '[role="navigation"]', '[role="banner"]',
  '[role="contentinfo"]', '[role="complementary"]',
].join(',');

export function splitOuterWhitespace(value) {
  const match = String(value).match(/^(\s*)([\s\S]*?)(\s*)$/u);
  return { leading: match[1], core: match[2], trailing: match[3] };
}

export function normalizeBlockText(value) {
  return String(value).replace(/[\t\f\v ]+/gu, ' ').replace(/\s*\n\s*/gu, ' ').trim();
}

export function shouldTranslateText(value) {
  const core = normalizeBlockText(value);
  if (core.length < 2 || core.length > 6000) return false;
  if (!/[A-Za-z]/u.test(core) || !/[A-Za-z]{2,}/u.test(core)) return false;
  if (/^(https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/iu.test(core)) return false;

  const letters = core.match(/\p{L}/gu) ?? [];
  const latin = core.match(/\p{Script=Latin}/gu) ?? [];
  return letters.length > 0 && latin.length / letters.length >= 0.6;
}

export function isEligibleElement(element, { includePageChrome = false } = {}) {
  if (!element || EXCLUDED_TAGS.has(element.tagName)) return false;
  if (element.closest?.(ALWAYS_EXCLUDED_SELECTOR)) return false;
  if (!includePageChrome && element.closest?.(PAGE_CHROME_SELECTOR)) return false;
  return true;
}

export function isElementRendered(element) {
  if (!element) return false;
  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden'
    || style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
  return Boolean(element.getClientRects().length);
}

export function isTextNodeVisible(node) {
  const element = node.parentElement;
  if (!isEligibleElement(element, { includePageChrome: true }) || !isElementRendered(element)) return false;
  const range = document.createRange();
  range.selectNodeContents(node);
  const visible = [...range.getClientRects()].some((rect) => rect.width > 0 && rect.height > 0
    && rect.bottom >= 0 && rect.right >= 0
    && rect.top <= innerHeight && rect.left <= innerWidth);
  range.detach();
  return visible;
}

export function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function nodePath(node) {
  const parts = [];
  let current = node;
  while (current && current !== document.body) {
    const parent = current.parentNode;
    if (!parent) break;
    parts.push([...parent.childNodes].indexOf(current));
    current = parent;
  }
  return parts.reverse().join('.');
}

export function makeStableId(node, original, collision = 0) {
  const seed = `${location.origin}${location.pathname}|${nodePath(node)}|${original}`;
  return `tn-${fnv1a(seed)}${collision ? `-${collision}` : ''}`;
}

export function makeStableBlockId(element, original, collision = 0) {
  const seed = `${location.origin}${location.pathname}|${nodePath(element)}|${original}`;
  return `tb-${fnv1a(seed)}${collision ? `-${collision}` : ''}`;
}

function englishCharacterCount(element) {
  return (normalizeBlockText(element.innerText).match(/[A-Za-z]/gu) ?? []).length;
}

export function findContentRoot(mode = 'main', pageRoot = document.body) {
  if (!pageRoot || mode === 'page') return pageRoot;
  const candidates = [
    ...(pageRoot.matches?.('main, article, [role="main"]') ? [pageRoot] : []),
    ...pageRoot.querySelectorAll('main, article, [role="main"]'),
  ].filter(isElementRendered);
  const ranked = candidates
    .map((element) => ({ element, score: englishCharacterCount(element) }))
    .filter(({ score }) => score >= 80)
    .sort((left, right) => right.score - left.score);
  return ranked[0]?.element ?? pageRoot;
}

export function collectTranslationBlocks({ mode = 'main', root = document.body } = {}) {
  const contentRoot = findContentRoot(mode, root);
  if (!contentRoot) return [];
  const includePageChrome = mode === 'page';
  const elements = [
    ...(contentRoot.matches?.(BLOCK_SELECTOR) ? [contentRoot] : []),
    ...contentRoot.querySelectorAll(BLOCK_SELECTOR),
  ];
  const blocks = [];
  let heading = '';
  for (const element of elements) {
    if (!isEligibleElement(element, { includePageChrome }) || !isElementRendered(element)) continue;
    const nestedBlocks = [...element.querySelectorAll(BLOCK_SELECTOR)]
      .some((nested) => nested !== element && isElementRendered(nested));
    if (nestedBlocks) continue;
    const text = normalizeBlockText(element.innerText);
    if (!shouldTranslateText(text)) continue;
    const type = element.tagName.toLowerCase();
    if (/^h[1-6]$/u.test(type)) heading = text;
    blocks.push({ element, text, type, heading });
  }
  return blocks;
}

export function collectVisibleEnglishTextNodes(root = document.body) {
  if (!root) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return shouldTranslateText(node.data) && isTextNodeVisible(node)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}
