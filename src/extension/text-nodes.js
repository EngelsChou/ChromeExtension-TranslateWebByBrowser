const EXCLUDED_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
  'CODE', 'PRE', 'KBD', 'SAMP', 'SVG', 'MATH', 'CANVAS',
]);

export function splitOuterWhitespace(value) {
  const match = String(value).match(/^(\s*)([\s\S]*?)(\s*)$/u);
  return { leading: match[1], core: match[2], trailing: match[3] };
}

export function shouldTranslateText(value) {
  const { core } = splitOuterWhitespace(value);
  if (core.length < 2 || core.length > 4000) return false;
  if (!/[A-Za-z]/u.test(core) || !/[A-Za-z]{2,}/u.test(core)) return false;
  if (/^(https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/iu.test(core)) return false;

  const letters = core.match(/\p{L}/gu) ?? [];
  const latin = core.match(/\p{Script=Latin}/gu) ?? [];
  return letters.length > 0 && latin.length / letters.length >= 0.6;
}

export function isEligibleElement(element) {
  if (!element || EXCLUDED_TAGS.has(element.tagName)) return false;
  if (element.closest?.('[contenteditable="true"], [contenteditable=""], [aria-hidden="true"], [hidden], dialog:not([open])')) return false;
  return true;
}

export function isTextNodeVisible(node) {
  const element = node.parentElement;
  if (!isEligibleElement(element)) return false;

  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
  if (!element.getClientRects().length) return false;

  const range = document.createRange();
  range.selectNodeContents(node);
  const rects = [...range.getClientRects()];
  range.detach();
  return rects.some((rect) => rect.width > 0 && rect.height > 0
    && rect.bottom >= 0 && rect.right >= 0
    && rect.top <= innerHeight && rect.left <= innerWidth);
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
