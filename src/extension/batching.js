export function createBatches(items, {
  maxItems = 24,
  maxCharacters = 5000,
  firstMaxItems = Math.min(4, maxItems),
  firstMaxCharacters = Math.min(900, maxCharacters),
} = {}) {
  const batches = [];
  let batch = [];
  let characters = 0;

  for (const item of items) {
    const size = item.text.length;
    const itemLimit = batches.length === 0 ? firstMaxItems : maxItems;
    const characterLimit = batches.length === 0 ? firstMaxCharacters : maxCharacters;
    if (batch.length && (batch.length >= itemLimit || characters + size > characterLimit)) {
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
