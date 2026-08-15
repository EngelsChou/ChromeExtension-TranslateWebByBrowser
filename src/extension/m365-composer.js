export function normalizeComposerText(value) {
  return String(value ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/gu, '')
    .replace(/\u00A0/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function promptMarker(prompt) {
  if (prompt.includes('INPUT_JSON=')) return 'INPUT_JSON=';
  if (prompt.includes('INPUT=')) return 'INPUT=';
  return null;
}

export function hasCompleteSinglePrompt(actualValue, expectedPrompt) {
  const actual = normalizeComposerText(actualValue);
  const expected = normalizeComposerText(expectedPrompt);
  const marker = promptMarker(expected);
  if (!actual || !expected || !marker) return false;

  const markerMatches = actual.split(marker).length - 1;
  if (markerMatches !== 1) return false;

  const actualPayload = actual.slice(actual.indexOf(marker) + marker.length);
  const expectedPayload = expected.slice(expected.indexOf(marker) + marker.length);
  try {
    return JSON.stringify(JSON.parse(actualPayload)) === JSON.stringify(JSON.parse(expectedPayload));
  } catch {
    return false;
  }
}
