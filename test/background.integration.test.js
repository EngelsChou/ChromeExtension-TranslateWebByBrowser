import test from 'node:test';
import assert from 'node:assert/strict';

function createChromeHarness({ failRetries = false } = {}) {
  let listener;
  let nextWorkerId = 3;
  let providerCall = 0;
  const providerBatches = [];
  const applied = [];
  const stored = {};

  function dispatch(message, sender = {}) {
    return new Promise((resolve, reject) => {
      try {
        const asynchronous = listener(message, sender, resolve);
        if (!asynchronous) queueMicrotask(() => resolve(undefined));
      } catch (error) {
        reject(error);
      }
    });
  }

  const chrome = {
    runtime: {
      onMessage: { addListener(callback) { listener = callback; } },
      sendMessage() { return Promise.resolve({ shown: true }); },
    },
    storage: {
      session: {
        async set(value) { Object.assign(stored, value); },
        async get(key) { return { [key]: stored[key] }; },
      },
    },
    scripting: { async executeScript() {} },
    windows: {
      async create() { return { id: nextWorkerId + 100 }; },
      async update() {},
      async remove() {},
    },
    tabs: {
      async query(options) {
        if (options.active) return [{ id: 1, url: 'https://learn.microsoft.com/test', windowId: 10 }];
        return [{ id: 2, url: 'https://chatgpt.com/', windowId: 20, status: 'complete' }];
      },
      async duplicate() {
        const id = nextWorkerId;
        nextWorkerId += 1;
        return { id, url: 'https://chatgpt.com/', windowId: id + 100, status: 'complete' };
      },
      async update() {},
      async remove() {},
      async sendMessage(tabId, message) {
        if (message.type === 'PING_TRANSLATOR') return { ready: true };
        if (message.type === 'COLLECT_TRANSLATION_BLOCKS') {
          return {
            items: ['a', 'b', 'c'].map((id) => ({
              id, text: `English paragraph ${id} with enough source words for validation.`,
              viewport: true, context: { type: 'p' },
            })),
          };
        }
        if (message.type === 'APPLY_TRANSLATIONS') {
          applied.push(...message.translations.map(({ id }) => id));
          return { applied: message.translations.length, missing: [] };
        }
        if (message.type === 'TRANSLATION_PROGRESS') return { shown: true };
        if (message.type === 'PROVIDER_STATUS') {
          return { ready: true, blocked: false, signedOut: false, hasDraft: false };
        }
        if (message.type === 'PROVIDER_TRANSLATE_BATCH') {
          providerCall += 1;
          providerBatches.push(message.items.map(({ id }) => id));
          if (providerCall === 1) {
            await dispatch({
              type: 'PROVIDER_TRANSLATION_PARTIAL', requestId: message.requestId,
              translations: [{ id: 'a', text: '已完成的繁體中文段落。' }],
            }, { tab: { id: tabId } });
            return { ok: false, error: '模擬 provider 中途故障' };
          }
          if (failRetries) return { ok: false, error: '模擬重試仍失敗' };
          return {
            ok: true,
            translations: message.items.map(({ id }) => ({ id, text: `繁體中文翻譯 ${id}` })),
          };
        }
        throw new Error(`Unexpected message: ${message.type}`);
      },
    },
  };

  return { chrome, dispatch, providerBatches, applied, stored };
}

async function loadBackground(chrome) {
  globalThis.chrome = chrome;
  await import(`../src/extension/background.js?harness=${crypto.randomUUID()}`);
}

test('background keeps streamed translations and retries only unfinished IDs', async () => {
  const harness = createChromeHarness();
  await loadBackground(harness.chrome);
  const result = await harness.dispatch({
    type: 'TRANSLATE_PAGE', provider: 'chatgpt', scope: 'main', displayMode: 'bilingual',
  });

  assert.equal(result.ok, true);
  assert.equal(result.translated, 3);
  assert.deepEqual(harness.providerBatches, [['a', 'b', 'c'], ['b'], ['c']]);
  assert.deepEqual(harness.applied, ['a', 'b', 'c']);
  assert.equal(harness.stored.translationJob.state, 'complete');
  assert.equal(harness.stored.translationJob.translated, 3);
});

test('background reports a bounded partial failure without discarding applied Chinese', async () => {
  const harness = createChromeHarness({ failRetries: true });
  await loadBackground(harness.chrome);
  const result = await harness.dispatch({
    type: 'TRANSLATE_PAGE', provider: 'chatgpt', scope: 'main', displayMode: 'bilingual',
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /已完成的 1\/3 個段落會保留/u);
  assert.deepEqual(harness.applied, ['a']);
  assert.deepEqual(harness.providerBatches, [['a', 'b', 'c'], ['b'], ['b']]);
  assert.equal(harness.stored.translationJob.state, 'error');
  assert.equal(harness.stored.translationJob.translated, 1);
  assert.equal(harness.stored.translationJob.completed, 0);
});
