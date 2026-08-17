import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const backgroundSource = await readFile(new URL('../src/extension/background.js', import.meta.url), 'utf8');
const contentSource = await readFile(new URL('../src/extension/content-entry.js', import.meta.url), 'utf8');
const chatgptSource = await readFile(new URL('../src/extension/chatgpt-content-entry.js', import.meta.url), 'utf8');
const m365Source = await readFile(new URL('../src/extension/m365-content-entry.js', import.meta.url), 'utf8');
const jobGuardSource = await readFile(new URL('../src/extension/job-guard.js', import.meta.url), 'utf8');
const providerTimingSource = await readFile(new URL('../src/extension/provider-timing.js', import.meta.url), 'utf8');
const popupHtml = await readFile(new URL('../extension/popup.html', import.meta.url), 'utf8');

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
  assert.match(backgroundSource, /applyResult\.applied !== (?:translations|remaining|unapplied)\.length/u);
  assert.doesNotMatch(backgroundSource, /COLLECT_TEXT_NODES/u);
});

test('whole-page mode includes visible English text nodes from menus and controls', () => {
  assert.match(contentSource, /collectVisibleEnglishTextNodes/u);
  assert.match(contentSource, /scope === 'page'/u);
  assert.match(contentSource, /kind: 'text'/u);
  assert.match(contentSource, /entry\.node\.replaceWith\(originalWrapper\)/u);
  assert.match(popupHtml, /整頁可見文字（含選單）/u);
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
  assert.match(contentSource, /expireStaleJob\(currentProgress\)/u);
});

test('translation jobs have provider, batch, whole-job, and stale-state timeouts', () => {
  assert.match(backgroundSource, /withTimeout\(chrome\.tabs\.sendMessage/u);
  assert.match(backgroundSource, /TRANSLATION_JOB_TIMEOUT_MS/u);
  assert.match(backgroundSource, /expireStaleJob\(job\)/u);
  assert.match(jobGuardSource, /PROVIDER_RESPONSE_TIMEOUT_MS = 55_000/u);
  assert.doesNotMatch(chatgptSource, /180_000/u);
  assert.doesNotMatch(m365Source, /180_000/u);
});

test('failed batches preserve completed IDs and split only remaining work for retry', () => {
  assert.match(backgroundSource, /context\.appliedIds\.add\(id\)/u);
  assert.match(backgroundSource, /remainingItems\(outstanding, context\.appliedIds\)/u);
  assert.match(backgroundSource, /splitRetryItems\(remaining\)/u);
  assert.match(backgroundSource, /completed: context\.completed/u);
});

test('providers accept the first complete schema-valid response without an extra stability delay', () => {
  assert.match(chatgptSource, /parseTranslationResponse\(text, items\)/u);
  assert.doesNotMatch(chatgptSource, /stableCount/u);
  assert.match(chatgptSource, /setTimeout\(resolve, emittedIds\.size \? 400 : 150\)/u);
  assert.match(m365Source, /sleep\(emittedIds\.size \? 400 : 150\)/u);
});

test('both providers stream validated paragraph objects back to the source page', () => {
  assert.match(backgroundSource, /PROVIDER_TRANSLATION_PARTIAL/u);
  assert.match(chatgptSource, /parsePartialTranslationResponse/u);
  assert.match(m365Source, /mergePartialTranslationCandidates/u);
  assert.match(m365Source, /STREAMING_RESPONSE_SELECTOR/u);
  assert.match(m365Source, /USER_MESSAGE_SELECTOR/u);
  assert.match(m365Source, /!node\.closest\(USER_MESSAGE_SELECTOR\)/u);
  assert.match(m365Source, /emittedIds\.size \? 400 : 150/u);
  assert.match(contentSource, /可視區翻譯已開始顯示/u);
});

test('M365 deduplicates nested DOM response candidates before streaming', () => {
  assert.match(m365Source, /mergePartialTranslationCandidates\(current\.candidates, items\)/u);
  assert.doesNotMatch(m365Source, /current\.candidates\s*\.flatMap/u);
});

test('each streamed provider result waits for source-page acknowledgement', () => {
  for (const providerSource of [chatgptSource, m365Source]) {
    assert.match(providerSource, /const acknowledgement = await chrome\.runtime\.sendMessage/u);
    assert.match(providerSource, /acknowledgement\.applied !== partial\.length/u);
    assert.match(providerSource, /partial\.forEach\(\(\{ id \}\) => emittedIds\.add\(id\)\)/u);
  }
  assert.match(backgroundSource, /await chrome\.tabs\.sendMessage\(pending\.targetTabId/u);
});

test('bilingual results place a Chinese block after the original English content', () => {
  assert.match(contentSource, /entry\.element\.append\(originalWrapper, translationElement\)/u);
  assert.match(contentSource, /translationElement\.style\.display = displayMode === 'replace' \? 'contents' : 'block'/u);
  assert.match(contentSource, /translationElement\.setAttribute\('lang', 'zh-Hant-TW'\)/u);
});

test('translation runs in an unfocused active provider worker window and cleans it up', () => {
  assert.match(backgroundSource, /chrome\.tabs\.create\(\{ url: provider\.homeUrl, active: false \}\)/u);
  assert.doesNotMatch(backgroundSource, /chrome\.tabs\.duplicate\(sourceTab\.id\)/u);
  assert.match(backgroundSource, /chrome\.windows\.create\(\{[\s\S]*?focused: false/u);
  assert.match(backgroundSource, /chrome\.tabs\.update\(workerTab\.id, \{ active: true, autoDiscardable: false \}\)/u);
  assert.match(backgroundSource, /await worker\.close\(\)/u);
});

test('M365 can reuse a loaded draft-free tab and restores it to the original window', () => {
  assert.match(backgroundSource, /provider\.id === 'm365'/u);
  assert.match(backgroundSource, /createReusedM365Worker/u);
  assert.match(backgroundSource, /chrome\.tabs\.move\(sourceTab\.id, \{ windowId: originalWindowId, index: originalIndex \}\)/u);
});

test('a stalled first provider batch is briefly surfaced only while the target Chrome window is focused', () => {
  assert.match(providerTimingSource, /CHATGPT_WAKE_DELAY_MS = 8_000/u);
  assert.match(providerTimingSource, /M365_WAKE_DELAY_MS = 750/u);
  assert.match(backgroundSource, /providerWakeDelayMs\(providerId\)/u);
  assert.match(backgroundSource, /chrome\.windows\.get\(context\.targetWindowId\)/u);
  assert.match(backgroundSource, /if \(!targetWindow\?\.focused\) return/u);
  assert.match(backgroundSource, /chrome\.windows\.update\(worker\.windowId, \{ focused: true \}\)/u);
  assert.match(backgroundSource, /restoreTargetAfterWorkerWake/u);
});

test('ChatGPT composer integration updates React state and fails fast before an unsent retry', () => {
  assert.match(chatgptSource, /ClipboardEvent\('paste'/u);
  assert.match(chatgptSource, /new InputEvent\('input'/u);
  assert.doesNotMatch(chatgptSource, /composer\.value \?\? composer\.innerText/u);
  assert.match(chatgptSource, /waitForSendButton\(composer\)\)\.click/u);
  assert.match(chatgptSource, /傳送按鈕\|尚未送出\|輸入框/u);
});

test('ChatGPT translation switches away from Work mode without changing model speed settings', () => {
  assert.match(chatgptSource, /CONVERSATION_MODE_PATTERN/u);
  assert.match(chatgptSource, /ensureConversationMode/u);
  assert.match(chatgptSource, /await ensureConversationMode\(\)/u);
  assert.doesNotMatch(chatgptSource, /啟用快速模式|menuitemcheckbox|推理強度/u);
});

test('M365 composer integration synchronizes Lexical state before checking the Send button', () => {
  const composerHandler = m365Source.slice(
    m365Source.indexOf('async function setComposerValue'),
    m365Source.indexOf('function isClickable'),
  );
  assert.match(composerHandler, /ClipboardEvent\('paste'/u);
  assert.match(composerHandler, /new InputEvent\('input'/u);
  assert.match(composerHandler, /new Event\('change'/u);
  assert.match(composerHandler, /composer\.dispatchEvent\(paste\);\n\s+await sleep\(150\);\n\s+if \(hasCompleteSinglePrompt/u);
  assert.match(composerHandler, /notifyComposerCleared\(composer\);[\s\S]*?document\.execCommand\('insertText'/u);
  assert.doesNotMatch(composerHandler.slice(composerHandler.indexOf('notifyComposerCleared(composer)')), /data:\s*value/u);
  assert.match(m365Source, /await setComposerValue\(composer, prompt\)/u);
  assert.match(m365Source, /!hasCompleteSinglePrompt\(composerText\(composer\), prompt\)/u);
  assert.match(m365Source, /await waitForSubmission\(composer, previousUserMessages\)/u);
  assert.match(m365Source, /new KeyboardEvent\(type/u);
});
