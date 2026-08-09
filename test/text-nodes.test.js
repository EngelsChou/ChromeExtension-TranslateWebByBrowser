import test from 'node:test';
import assert from 'node:assert/strict';
import { fnv1a, shouldTranslateText, splitOuterWhitespace } from '../src/extension/text-nodes.js';

test('detects English prose and rejects non-English or unsafe noise', () => {
  assert.equal(shouldTranslateText('Translate this visible sentence.'), true);
  assert.equal(shouldTranslateText('  Account settings  '), true);
  assert.equal(shouldTranslateText('繁體中文內容'), false);
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
