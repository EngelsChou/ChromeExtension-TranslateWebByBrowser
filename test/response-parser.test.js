import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTranslationResponse, validateTranslations } from '../src/extension/chatgpt-core.js';

const expected = [
  { id: 'tn-one', text: 'Hello' },
  { id: 'tn-two', text: 'World' },
];

test('parses strict JSON and tolerated fenced JSON', () => {
  const payload = '{"translations":[{"id":"tn-one","text":"哈囉"},{"id":"tn-two","text":"世界"}]}';
  assert.equal(parseTranslationResponse(payload, expected)[0].text, '哈囉');
  assert.equal(parseTranslationResponse(`Result:\n\`\`\`json\n${payload}\n\`\`\``, expected)[1].text, '世界');
});

test('rejects missing, duplicate, and unknown IDs', () => {
  assert.throws(() => parseTranslationResponse('{"translations":[{"id":"tn-one","text":"哈囉"}]}', expected), /缺少/u);
  assert.throws(() => parseTranslationResponse('{"translations":[{"id":"tn-one","text":"甲"},{"id":"tn-one","text":"乙"}]}', expected), /重複/u);
  assert.throws(() => parseTranslationResponse('{"translations":[{"id":"tn-one","text":"甲"},{"id":"tn-three","text":"乙"}]}', expected), /未知/u);
});

test('rejects prose-only and empty translations', () => {
  assert.throws(() => parseTranslationResponse('Here are the translations.', expected), /不是有效/u);
  assert.throws(() => parseTranslationResponse('{"translations":[{"id":"tn-one","text":""},{"id":"tn-two","text":"世界"}]}', expected), /空白/u);
});

test('revalidates structured translations before applying them', () => {
  assert.deepEqual(validateTranslations([
    { id: 'tn-one', text: '哈囉' },
    { id: 'tn-two', text: '世界' },
  ], expected).map(({ id }) => id), ['tn-one', 'tn-two']);
  assert.throws(() => validateTranslations([{ id: 'tn-one', text: '哈囉' }], expected), /缺少/u);
});
