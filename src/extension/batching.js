export function createBatches(items, { maxItems = 30, maxCharacters = 6000 } = {}) {
  const batches = [];
  let batch = [];
  let characters = 0;

  for (const item of items) {
    const size = item.text.length;
    if (batch.length && (batch.length >= maxItems || characters + size > maxCharacters)) {
      batches.push(batch);
      batch = [];
      characters = 0;
    }
    batch.push(item);
    characters += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
