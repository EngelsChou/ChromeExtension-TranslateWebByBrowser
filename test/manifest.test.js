import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const backgroundSource = await readFile(new URL('../src/extension/background.js', import.meta.url), 'utf8');
const contentSource = await readFile(new URL('../src/extension/content-entry.js', import.meta.url), 'utf8');
const chatgptSource = await readFile(new URL('../src/extension/chatgpt-content-entry.js', import.meta.url), 'utf8');
const m365Source = await readFile(new URL('../src/extension/m365-content-entry.js', import.meta.url), 'utf8');

test('ships a self-contained Manifest V3 provider-tab extension', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, packageJson.version);
  assert.deepEqual(manifest.host_permissions, [
    'https://chatgpt.com/*',
    'https://chat.openai.com/*',
    'https://m365.cloud.microsoft/*',
  ]);
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage']);
  assert.equal(manifest.content_scripts[0].js[0], 'chatgpt-content.js');
  assert.equal(manifest.content_scripts[1].js[0], 'm365-content.js');
});

test('normal use has no bridge, native host, executable, or runtime dependency', () => {
  assert.equal(packageJson.dependencies, undefined);
  assert.equal(packageJson.scripts.bridge, undefined);
  assert.equal(packageJson.scripts['chatgpt:start'], undefined);
  assert.doesNotMatch(JSON.stringify(manifest), /localhost|127\.0\.0\.1|nativeMessaging/iu);
  assert.doesNotMatch(backgroundSource, /localhost|127\.0\.0\.1|fetch\s*\(/iu);
});

test('the repository extension folder contains every manifest entry point', async () => {
  const files = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    'popup.css',
    'popup.js',
    'content.js',
    ...manifest.content_scripts.flatMap(({ js }) => js),
  ];
  await Promise.all([...new Set(files)].map((file) => access(new URL(`../extension/${file}`, import.meta.url))));
});

test('opening the popup cannot create or activate a provider tab', () => {
  const statusHandler = backgroundSource.slice(
    backgroundSource.indexOf('async function providerStatus'),
    backgroundSource.indexOf('async function openProvider'),
  );
  assert.match(statusHandler, /findExistingProviderTab/u);
  assert.doesNotMatch(statusHandler, /findOrCreateProviderTab|tabs\.create|tabs\.update|windows\.update/u);
});

test('translation uses paragraph blocks and verifies every applied result', () => {
  assert.match(backgroundSource, /COLLECT_TRANSLATION_BLOCKS/u);
  assert.match(backgroundSource, /applyResult\.applied !== (?:translations|remaining)\.length/u);
  assert.doesNotMatch(backgroundSource, /COLLECT_TEXT_NODES/u);
});

test('M365 waits for schema-valid candidates and response completion markers', () => {
  assert.match(m365Source, /parseFirstValidTranslationResponse/u);
  assert.match(m365Source, /copyActionCount/u);
  assert.match(m365Source, /previousCandidates/u);
});

test('translation progress remains visible on the original webpage', () => {
  assert.match(backgroundSource, /tabs\.sendMessage\(targetTabId, \{ type: 'TRANSLATION_PROGRESS'/u);
  assert.match(contentSource, /data-twbt-ui="progress"/u);
  assert.match(contentSource, /已經過/u);
  assert.match(contentSource, /viewportDistance/u);
});

test('providers accept the first complete schema-valid response without an extra stability delay', () => {
  assert.match(chatgptSource, /parseTranslationResponse\(text, items\)/u);
  assert.doesNotMatch(chatgptSource, /stableCount/u);
  assert.match(chatgptSource, /setTimeout\(resolve, 700\)/u);
  assert.match(m365Source, /sleep\(800\)/u);
});

test('both providers stream validated paragraph objects back to the source page', () => {
  assert.match(backgroundSource, /PROVIDER_TRANSLATION_PARTIAL/u);
  assert.match(chatgptSource, /parsePartialTranslationResponse/u);
  assert.match(m365Source, /parsePartialTranslationResponse/u);
  assert.match(contentSource, /可視區翻譯已開始顯示/u);
});

test('ChatGPT composer integration updates React state and fails fast before an unsent retry', () => {
  assert.match(chatgptSource, /ClipboardEvent\('paste'/u);
  assert.match(chatgptSource, /new InputEvent\('input'/u);
  assert.doesNotMatch(chatgptSource, /composer\.value \?\? composer\.innerText/u);
  assert.match(chatgptSource, /waitForSendButton\(composer\)\)\.click/u);
  assert.match(chatgptSource, /傳送按鈕\|尚未送出\|輸入框/u);
});
