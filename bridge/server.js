import http from 'node:http';
import { ChatGptBrowserClient } from './chatgpt.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.BRIDGE_PORT || 17373);
const MAX_BODY_BYTES = 128 * 1024;
const allowedExtensionId = process.env.BRIDGE_EXTENSION_ID?.trim();
const client = new ChatGptBrowserClient();
let queue = Promise.resolve();

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (!origin.startsWith('chrome-extension://')) return false;
  return !allowedExtensionId || origin === `chrome-extension://${allowedExtensionId}`;
}

function corsHeaders(origin) {
  return origin && isAllowedOrigin(origin)
    ? { 'access-control-allow-origin': origin, vary: 'origin' }
    : {};
}

function send(response, status, payload, origin) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...corsHeaders(origin),
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('請求內容過大。');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function validateItems(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) throw new Error('items 必須包含 1 到 30 筆文字。');
  const ids = new Set();
  return value.map((item) => {
    if (!item || typeof item.id !== 'string' || !/^tn-[a-z0-9-]+$/u.test(item.id)) throw new Error('每筆資料都需要有效的穩定 id。');
    if (ids.has(item.id)) throw new Error(`重複的 id：${item.id}`);
    if (typeof item.text !== 'string' || !item.text.trim() || item.text.length > 4000) throw new Error(`無效的文字：${item.id}`);
    ids.add(item.id);
    return { id: item.id, text: item.text };
  });
}

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (!isAllowedOrigin(origin)) {
    send(response, 403, { error: '此 Chrome Extension origin 未獲 bridge 授權。' }, origin);
    return;
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      ...corsHeaders(origin),
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '600',
    });
    response.end();
    return;
  }

  try {
    if (request.method === 'GET' && request.url === '/health') {
      const status = await client.sessionStatus();
      send(response, 200, {
        ok: true,
        bridge: 'ready',
        chatgptReady: status.ready,
        message: status.message,
      }, origin);
      return;
    }
    if (request.method === 'POST' && request.url === '/translate') {
      const body = await readJson(request);
      if (body.sourceLanguage !== 'English' || body.targetLocale !== 'zh-TW') throw new Error('此 bridge 只支援英文翻成台灣繁體中文。');
      const items = validateItems(body.items);
      const work = queue.then(() => client.translate(items));
      queue = work.catch(() => {});
      const translations = await work;
      send(response, 200, { translations }, origin);
      return;
    }
    send(response, 404, { error: '找不到此端點。' }, origin);
  } catch (error) {
    send(response, 400, { error: error.message }, origin);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`ChatGPT browser bridge listening on http://${HOST}:${PORT}`);
});
