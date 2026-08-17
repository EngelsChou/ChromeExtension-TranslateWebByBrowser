import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHATGPT_WAKE_DELAY_MS,
  M365_WAKE_DELAY_MS,
  providerWakeDelayMs,
} from '../src/extension/provider-timing.js';

test('wakes M365 almost immediately while preserving the proven ChatGPT delay', () => {
  assert.equal(providerWakeDelayMs('m365'), M365_WAKE_DELAY_MS);
  assert.ok(M365_WAKE_DELAY_MS <= 1_000);
  assert.equal(providerWakeDelayMs('chatgpt'), CHATGPT_WAKE_DELAY_MS);
  assert.equal(CHATGPT_WAKE_DELAY_MS, 8_000);
});
