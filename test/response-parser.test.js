import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFirstValidTranslationResponse,
  parsePartialTranslationResponse,
  parseTranslationResponse,
  validateTranslations,
} from '../src/extension/chatgpt-core.js';

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

test('skips prompt schema examples and selects the later ID-complete response', () => {
  const noisy = [
    'Schema: {"translations":[{"id":"same-id","text":"translated text"}]}',
    'INPUT_JSON={"items":[{"id":"tn-one","text":"Hello"},{"id":"tn-two","text":"World"}]}',
    'Answer: {"translations":[{"id":"tn-one","text":"哈囉"},{"id":"tn-two","text":"世界"}]}',
  ].join('\n');
  assert.equal(parseTranslationResponse(noisy, expected)[1].text, '世界');
});

test('selects a valid M365 answer while ignoring follow-up suggestions', () => {
  const result = parseFirstValidTranslationResponse([
    '新增其他語言翻譯',
    '{"translations":[{"id":"tn-one","text":"哈囉"},{"id":"tn-two","text":"世界"}]}',
  ], expected);
  assert.equal(result.length, 2);
});

test('rejects a long English echo as an untranslated response', () => {
  const source = [{ id: 'tn-long', text: 'This paragraph contains enough English words to require a real translation.' }];
  const echo = '{"translations":[{"id":"tn-long","text":"This paragraph contains enough English words to require a real translation."}]}';
  assert.throws(() => parseTranslationResponse(echo, source), /不像台灣繁體中文/u);
});

test('extracts complete translated paragraph objects from an unfinished JSON stream', () => {
  const streaming = '{"translations":[{"id":"tn-one","text":"哈囉"},{"id":"tn-two","text":"世';
  assert.deepEqual(parsePartialTranslationResponse(streaming, expected), [
    { id: 'tn-one', text: '哈囉' },
  ]);
});

test('partial stream parsing ignores schema examples and untranslated echoes', () => {
  const longExpected = [{ id: 'tn-long', text: 'This paragraph contains enough English words for validation.' }];
  const streaming = '{"id":"same-id","text":"translated text"}\n'
    + '{"id":"tn-long","text":"This paragraph contains enough English words for validation."}';
  assert.deepEqual(parsePartialTranslationResponse(streaming, longExpected), []);
});
