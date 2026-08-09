function jsonCandidates(raw) {
  const text = String(raw).trim();
  const candidates = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)].map((match) => match[1].trim());
  candidates.push(text);

  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{' && text[start] !== '[') continue;
    const candidate = balancedCandidate(text, start);
    if (candidate) candidates.push(candidate);
  }
  return [...new Set(candidates)];
}

function balancedCandidate(text, start) {
  const stack = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') stack.push(char);
    else if (char === '}' || char === ']') {
      const expected = char === '}' ? '{' : '[';
      if (stack.pop() !== expected) return null;
      if (!stack.length) return text.slice(start, index + 1);
    }
  }
  return null;
}

export function parseTranslationResponse(raw, expectedItems) {
  let payload;
  for (const candidate of jsonCandidates(raw)) {
    try {
      const parsed = JSON.parse(candidate);
      const values = Array.isArray(parsed) ? parsed : parsed?.translations;
      if (Array.isArray(values)) {
        payload = values;
        break;
      }
    } catch { /* robustly continue past prose and malformed fences */ }
  }
  if (!payload) throw new Error('ChatGPT 回覆不是有效的翻譯 JSON。');

  const expectedIds = new Set(expectedItems.map((item) => item.id));
  const seen = new Set();
  const translations = payload.map((item) => {
    if (!item || typeof item.id !== 'string' || typeof item.text !== 'string') {
      throw new Error('ChatGPT JSON 的每個翻譯都必須包含字串 id 與 text。');
    }
    if (!expectedIds.has(item.id)) throw new Error(`ChatGPT 回傳了未知 ID：${item.id}`);
    if (seen.has(item.id)) throw new Error(`ChatGPT 回傳了重複 ID：${item.id}`);
    if (!item.text.trim()) throw new Error(`ChatGPT 回傳空白翻譯：${item.id}`);
    seen.add(item.id);
    return { id: item.id, text: item.text };
  });

  const missing = [...expectedIds].filter((id) => !seen.has(id));
  if (missing.length) throw new Error(`ChatGPT 缺少 ${missing.length} 個翻譯 ID：${missing.slice(0, 3).join(', ')}`);
  if (translations.length !== expectedItems.length) throw new Error('ChatGPT 回傳的翻譯數量不符。');
  return translations;
}
