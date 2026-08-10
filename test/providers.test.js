import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROVIDER, getProvider, PROVIDERS } from '../src/extension/providers.js';

test('ChatGPT remains the default and both approved providers are available', () => {
  assert.equal(DEFAULT_PROVIDER, 'chatgpt');
  assert.deepEqual(Object.keys(PROVIDERS), ['chatgpt', 'm365']);
  assert.equal(getProvider('m365').homeUrl, 'https://m365.cloud.microsoft/chat/');
});

test('provider URL ownership is host-specific', () => {
  assert.equal(getProvider('chatgpt').ownedUrl.test('https://chatgpt.com/c/abc'), true);
  assert.equal(getProvider('m365').ownedUrl.test('https://m365.cloud.microsoft/chat/'), true);
  assert.equal(getProvider('m365').ownedUrl.test('https://m365.cloud.microsoft.evil.test/chat/'), false);
  assert.throws(() => getProvider('claude'), /不支援/u);
});
