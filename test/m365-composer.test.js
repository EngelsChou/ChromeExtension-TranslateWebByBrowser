import test from 'node:test';
import assert from 'node:assert/strict';
import { hasCompleteSinglePrompt, normalizeComposerText } from '../src/extension/m365-composer.js';

const batchPrompt = [
  'Translate the supplied webpage text.',
  'Return JSON only.',
  'INPUT_JSON={"items":[{"id":"tb-a","text":"Hello world"}]}',
].join('\n');

test('M365 composer verification accepts harmless editor whitespace', () => {
  const lexicalText = `\u200BTranslate the supplied webpage text.\n\nReturn JSON only.\n${batchPrompt.split('\n').at(-1)}\n`;
  assert.equal(hasCompleteSinglePrompt(lexicalText, batchPrompt), true);
  assert.equal(normalizeComposerText('A\u00a0 B'), 'A B');
});

test('M365 composer verification rejects duplicate and incomplete prompts', () => {
  assert.equal(hasCompleteSinglePrompt(`${batchPrompt}\n${batchPrompt}`, batchPrompt), false);
  assert.equal(hasCompleteSinglePrompt(batchPrompt.slice(0, -4), batchPrompt), false);
});

test('M365 composer verification validates single-item INPUT payloads', () => {
  const prompt = 'Translate directly.\nINPUT={"id":"tb-a","text":"Hello"}';
  assert.equal(hasCompleteSinglePrompt(prompt, prompt), true);
  assert.equal(hasCompleteSinglePrompt(prompt.replace('Hello', 'Changed'), prompt), false);
});
