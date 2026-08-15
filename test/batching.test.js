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

test('uses a small first batch before larger throughput-oriented batches', () => {
  const items = Array.from({ length: 12 }, (_, index) => ({
    id: String(index + 1),
    text: 'A'.repeat(150),
  }));
  const batches = createBatches(items);
  assert.deepEqual(batches.map((batch) => batch.length), [1, 11]);
  assert.deepEqual(batches.flat().map(({ id }) => id), items.map(({ id }) => id));
});

test('keeps viewport follow-up batches small before offscreen throughput batches', () => {
  const items = [
    ...Array.from({ length: 9 }, (_, index) => ({
      id: `visible-${index + 1}`,
      text: 'A'.repeat(180),
      viewport: true,
    })),
    ...Array.from({ length: 14 }, (_, index) => ({
      id: `offscreen-${index + 1}`,
      text: 'B'.repeat(120),
    })),
  ];
  const batches = createBatches(items);
  assert.deepEqual(batches.map((batch) => batch.length), [1, 4, 4, 12, 2]);
  assert.ok(batches.slice(0, 3).flat().every(({ viewport }) => viewport));
  assert.ok(batches.slice(3).flat().every(({ viewport }) => !viewport));
});

test('caps viewport follow-up batches by character count', () => {
  const items = Array.from({ length: 5 }, (_, index) => ({
    id: `visible-${index + 1}`,
    text: 'A'.repeat(400),
    viewport: true,
  }));
  const batches = createBatches(items);
  assert.deepEqual(batches.map((batch) => batch.length), [1, 2, 2]);
});

test('caps the fast first batch while keeping all viewport items ahead of offscreen work', () => {
  const items = [
    { id: 'visible-1', text: 'A'.repeat(600), viewport: true },
    { id: 'visible-2', text: 'B'.repeat(600), viewport: true },
    { id: 'visible-3', text: 'C'.repeat(600), viewport: true },
    { id: 'offscreen-1', text: 'D'.repeat(100) },
  ];
  const batches = createBatches(items);
  assert.deepEqual(batches[0].map(({ id }) => id), ['visible-1']);
  assert.deepEqual(batches.flat().map(({ id }) => id), [
    'visible-1', 'visible-2', 'visible-3', 'offscreen-1',
  ]);
});

test('uses exactly one viewport item in the fast first batch', () => {
  const items = Array.from({ length: 7 }, (_, index) => ({
    id: `visible-${index + 1}`,
    text: 'A'.repeat(150),
    viewport: true,
  }));
  const batches = createBatches(items);
  assert.equal(batches[0].length, 1);
  assert.equal(batches[0].reduce((total, item) => total + item.text.length, 0), 150);
  assert.deepEqual(batches.flat().map(({ id }) => id), items.map(({ id }) => id));
});
