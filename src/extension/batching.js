export function createBatches(items, {
  maxItems = 12,
  maxCharacters = 2400,
  viewportMaxItems = 4,
  viewportMaxCharacters = 1000,
  firstMaxItems = 1,
  firstMaxCharacters = Math.min(450, maxCharacters),
} = {}) {
  const batches = [];
  const viewportItems = items.filter((item) => item.viewport);
  const offscreenItems = items.filter((item) => !item.viewport);
  const queuedItems = [...viewportItems, ...offscreenItems];

  function appendBatches(group, itemLimit, characterLimit) {
    let batch = [];
    let characters = 0;
    for (const item of group) {
      const size = item.text.length;
      if (batch.length && (batch.length >= itemLimit || characters + size > characterLimit)) {
        batches.push(batch);
        batch = [];
        characters = 0;
      }
      batch.push(item);
      characters += size;
    }
    if (batch.length) batches.push(batch);
  }

  if (queuedItems.length) {
    appendBatches(queuedItems.slice(0, firstMaxItems), firstMaxItems, firstMaxCharacters);
  }
  const firstIds = new Set(batches.flat().map(({ id }) => id));
  appendBatches(
    viewportItems.filter(({ id }) => !firstIds.has(id)),
    viewportMaxItems,
    viewportMaxCharacters,
  );
  appendBatches(
    offscreenItems.filter(({ id }) => !firstIds.has(id)),
    maxItems,
    maxCharacters,
  );
  return batches;
}
