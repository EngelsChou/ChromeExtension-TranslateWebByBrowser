import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const backgroundSource = await readFile(new URL('../src/extension/background.js', import.meta.url), 'utf8');

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
