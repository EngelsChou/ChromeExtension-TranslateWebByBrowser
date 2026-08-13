import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCK_SELECTOR, collectTranslationBlocks, findContentRoot, fnv1a,
  normalizeBlockText, shouldTranslateText, splitOuterWhitespace,
} from '../src/extension/text-nodes.js';

test('detects English prose and rejects non-English or unsafe noise', () => {
  assert.equal(shouldTranslateText('Translate this visible sentence.'), true);
  assert.equal(shouldTranslateText('  Account settings  '), true);
  assert.equal(shouldTranslateText('繁體中文內容'), false);
  assert.equal(shouldTranslateText('.NET 簡介'), false);
  assert.equal(shouldTranslateText('Download .NET 下載'), false);
  assert.equal(shouldTranslateText('https://example.com/path'), false);
  assert.equal(shouldTranslateText('42'), false);
});

test('preserves outer whitespace separately from translatable text', () => {
  assert.deepEqual(splitOuterWhitespace('\n  Hello world  \t'), {
    leading: '\n  ', core: 'Hello world', trailing: '  \t',
  });
});

test('stable hash is deterministic and content-sensitive', () => {
  assert.equal(fnv1a('same'), fnv1a('same'));
  assert.notEqual(fnv1a('same'), fnv1a('different'));
});

test('normalizes a rendered paragraph without sending markup', () => {
  assert.equal(normalizeBlockText('  .NET is\n a platform\tfor apps.  '), '.NET is a platform for apps.');
});

function fakeElement(tagName, innerText, queries = new Map()) {
  return {
    tagName: tagName.toUpperCase(),
    innerText,
    matches(selector) {
      return selector.split(',').map((value) => value.trim()).includes(tagName.toLowerCase());
    },
    querySelectorAll(selector) {
      return queries.get(selector) ?? [];
    },
    closest() { return null; },
    getClientRects() { return [{ width: 500, height: 30, top: 5000, bottom: 5030 }]; },
  };
}

test('main-content mode collects rendered offscreen paragraphs instead of viewport-only nodes', () => {
  const previousStyle = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1' });
  try {
    const first = fakeElement('p', 'This first paragraph explains the complete platform architecture in clear English.');
    const second = fakeElement('p', 'This second paragraph remains outside the viewport but must still be translated.');
    const mainQueries = new Map([[BLOCK_SELECTOR, [first, second]]]);
    const main = fakeElement('main', `${first.innerText} ${second.innerText}`, mainQueries);
    const body = fakeElement('body', `Navigation ${main.innerText}`, new Map([
      ['main, article, [role="main"]', [main]],
    ]));
    assert.equal(findContentRoot('main', body), main);
    assert.deepEqual(collectTranslationBlocks({ mode: 'main', root: body }).map(({ text }) => text), [
      first.innerText,
      second.innerText,
    ]);
  } finally {
    globalThis.getComputedStyle = previousStyle;
  }
});
