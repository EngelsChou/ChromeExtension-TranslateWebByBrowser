import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expireStaleJob,
  remainingItems,
  splitRetryItems,
  TRANSLATION_JOB_STALE_MS,
  withTimeout,
} from '../src/extension/job-guard.js';

test('expires an active job that has stopped reporting progress', () => {
  const now = 1_000_000;
  const job = {
    state: 'running', updatedAt: now - TRANSLATION_JOB_STALE_MS - 1,
    translated: 30, blocks: 66,
  };
  const expired = expireStaleJob(job, now);
  assert.equal(expired.state, 'error');
  assert.equal(expired.stale, true);
  assert.equal(expired.translated, 30);
  assert.match(expired.error, /已完成的中文仍會保留/u);
});

test('does not alter fresh or completed jobs', () => {
  const now = 1_000_000;
  const fresh = { state: 'running', updatedAt: now - 1_000 };
  const complete = { state: 'complete', updatedAt: 1 };
  assert.equal(expireStaleJob(fresh, now), fresh);
  assert.equal(expireStaleJob(complete, now), complete);
});

test('times out a provider promise with a recognizable error code', async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 5, 'batch timed out'),
    (error) => error.code === 'TRANSLATION_TIMEOUT' && error.message === 'batch timed out',
  );
});

test('returns only unapplied items and splits retries without changing order', () => {
  const items = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, text: id }));
  const remaining = remainingItems(items, new Set(['b', 'd']));
  assert.deepEqual(remaining.map(({ id }) => id), ['a', 'c', 'e']);
  assert.deepEqual(
    splitRetryItems(remaining).map((batch) => batch.map(({ id }) => id)),
    [['a', 'c'], ['e']],
  );
  assert.deepEqual(splitRetryItems([items[0]]), [[items[0]]]);
});
