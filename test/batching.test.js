import test from 'node:test';
import assert from 'node:assert/strict';
import { createBatches } from '../src/extension/batching.js';

test('batches by item and character limits without changing order', () => {
  const items = [
    { id: '1', text: 'aaaa' },
    { id: '2', text: 'bbbb' },
    { id: '3', text: 'cc' },
  ];
  const batches = createBatches(items, { maxItems: 2, maxCharacters: 6 });
  assert.deepEqual(batches.map((batch) => batch.map(({ id }) => id)), [['1'], ['2', '3']]);
});

test('returns no empty batches', () => {
  assert.deepEqual(createBatches([]), []);
});
