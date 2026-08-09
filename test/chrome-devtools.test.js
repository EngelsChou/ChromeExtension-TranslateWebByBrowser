import test from 'node:test';
import assert from 'node:assert/strict';
import { contentText, extractReturnedJson } from '../bridge/chrome-devtools.js';
import { parsePages } from '../bridge/chatgpt.js';

test('reads MCP JSON text content and page identifiers', () => {
  const output = JSON.stringify({ content: [{ type: 'text', text: '# Pages\n0: about:blank\n2: https://chatgpt.com/ [selected]' }] });
  assert.match(contentText(output), /chatgpt/u);
  assert.deepEqual(parsePages(output), [
    { id: 0, url: 'about:blank', selected: false },
    { id: 2, url: 'https://chatgpt.com/', selected: true },
  ]);
});

test('reads current CLI structured page output', () => {
  const output = JSON.stringify({ pages: [{ id: 2, url: 'https://chatgpt.com/', title: 'ChatGPT', selected: true }] });
  assert.deepEqual(parsePages(output), [
    { id: 2, url: 'https://chatgpt.com/', title: 'ChatGPT', selected: true },
  ]);
});

test('extracts JSON returned inside CLI prose', () => {
  const output = JSON.stringify({ content: [{ type: 'text', text: 'Script returned:\n```json\n{"ok":true}\n```' }] });
  assert.deepEqual(extractReturnedJson(output), { ok: true });
});

test('extracts JSON from current CLI message envelope', () => {
  const output = JSON.stringify({ message: 'Script ran on page and returned:\n```json\n{"signedOut":true}\n```' });
  assert.deepEqual(extractReturnedJson(output), { signedOut: true });
});
