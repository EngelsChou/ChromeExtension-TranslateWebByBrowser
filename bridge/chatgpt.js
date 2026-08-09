import { setTimeout as delay } from 'node:timers/promises';
import { contentText, extractReturnedJson, runChromeDevtools } from './chrome-devtools.js';
import { buildTranslationPrompt } from './prompt.js';
import { parseTranslationResponse } from './response-parser.js';

const CHATGPT_HOST = /^(?:https:\/\/)?(?:chatgpt\.com|chat\.openai\.com)(?:\/|$)/iu;

function parsePages(output) {
  try {
    const parsed = JSON.parse(output);
    if (Array.isArray(parsed?.pages)) return parsed.pages.map((page) => ({
      id: Number(page.id), url: page.url, selected: Boolean(page.selected), title: page.title,
    }));
  } catch { /* fall back to the Markdown/text format */ }
  const text = contentText(output);
  const pages = [];
  for (const line of text.split(/\r?\n/u)) {
    const match = line.match(/^\s*(\d+)\s*:\s*(https?:\/\/\S+|about:\S+)(?:\s+\[selected\])?/u);
    if (match) pages.push({ id: Number(match[1]), url: match[2], selected: line.includes('[selected]') });
  }
  return pages;
}

async function evaluate(functionDeclaration, timeout = 30_000) {
  const result = await runChromeDevtools([
    'evaluate_script', functionDeclaration, '--output-format=json',
  ], { timeout });
  return extractReturnedJson(result.stdout);
}

export class ChatGptBrowserClient {
  async sessionStatus() {
    const daemon = await runChromeDevtools(['status'], { allowFailure: true, timeout: 8_000 });
    if (daemon.exitCode !== 0 || !/running/iu.test(`${daemon.stdout} ${daemon.stderr}`)) {
      return { ready: false, message: '請先執行 npm run chatgpt:start，並在開啟的 Chrome 登入 ChatGPT。' };
    }

    try {
      const page = await this.selectChatGptPage();
      if (!page) return { ready: false, message: '找不到 ChatGPT 分頁；請在專用 Chrome 中開啟 https://chatgpt.com/。' };
      const state = await evaluate(`() => ({
        url: location.href,
        hasComposer: Boolean(document.querySelector('#prompt-textarea, textarea[data-testid="prompt-textarea"], [contenteditable="true"][data-virtualkeyboard]')),
        signedOut: [...document.querySelectorAll('button, a')].some((node) => /^(?:Log in|登入)$/iu.test(node.textContent.trim())),
        title: document.title
      })`);
      return state.hasComposer && !state.signedOut
        ? { ready: true, page, title: state.title }
        : { ready: false, message: 'ChatGPT 分頁尚未可輸入；請完成登入或驗證後再試。' };
    } catch (error) {
      return { ready: false, message: error.message };
    }
  }

  async selectChatGptPage() {
    const { stdout } = await runChromeDevtools(['list_pages', '--output-format=json'], { timeout: 20_000 });
    const pages = parsePages(stdout);
    const page = pages.find((candidate) => CHATGPT_HOST.test(candidate.url));
    if (!page) return null;
    if (!page.selected) await runChromeDevtools(['select_page', String(page.id), '--output-format=json'], { timeout: 20_000 });
    await runChromeDevtools(['take_snapshot', '--output-format=json'], { timeout: 20_000 });
    return page;
  }

  async translate(items) {
    const status = await this.sessionStatus();
    if (!status.ready) throw new Error(status.message);

    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const raw = await this.submitAndWait(buildTranslationPrompt(items, { retry: attempt > 0 }));
        return parseTranslationResponse(raw, items);
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`ChatGPT 連續兩次未回傳有效翻譯：${lastError.message}`);
  }

  async submitAndWait(prompt) {
    const encodedPrompt = JSON.stringify(prompt);
    const before = await evaluate(`async () => {
      const composer = document.querySelector('#prompt-textarea, textarea[data-testid="prompt-textarea"], [contenteditable="true"][data-virtualkeyboard]');
      if (!composer) return { error: '找不到 ChatGPT 輸入框，請確認已登入。' };
      const assistants = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
      const beforeText = assistants.at(-1)?.innerText ?? '';
      composer.focus();
      const value = ${encodedPrompt};
      if (composer instanceof HTMLTextAreaElement) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(composer, value);
      } else {
        composer.innerHTML = '';
        const paragraph = document.createElement('p');
        paragraph.textContent = value;
        composer.append(paragraph);
      }
      composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      await new Promise((resolve) => setTimeout(resolve, 150));
      const send = document.querySelector('button[data-testid="send-button"], button[aria-label*="Send" i], button[aria-label*="傳送" i]');
      if (!send || send.disabled) return { error: 'ChatGPT 傳送按鈕尚未可用。' };
      send.click();
      return { beforeCount: assistants.length, beforeText };
    }`);
    if (before.error) throw new Error(before.error);

    const deadline = Date.now() + 180_000;
    let stableText = '';
    let stableCount = 0;
    while (Date.now() < deadline) {
      await delay(1_500);
      const state = await evaluate(`() => {
        const assistants = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
        const text = assistants.at(-1)?.innerText?.trim() ?? '';
        const streaming = Boolean(document.querySelector('button[data-testid="stop-button"], button[aria-label*="Stop" i], button[aria-label*="停止" i]'));
        const visibleError = [...document.querySelectorAll('[role="alert"]')].map((node) => node.innerText).filter(Boolean).at(-1) ?? '';
        return { count: assistants.length, text, streaming, visibleError };
      }`);
      const isNew = state.count > before.beforeCount || (state.text && state.text !== before.beforeText);
      if (state.visibleError && !isNew) throw new Error(`ChatGPT 顯示錯誤：${state.visibleError}`);
      if (!isNew || !state.text) continue;
      if (state.text === stableText) stableCount += 1;
      else { stableText = state.text; stableCount = 1; }
      if (!state.streaming && stableCount >= 2) return state.text;
    }
    throw new Error('等待 ChatGPT 回覆逾時（180 秒）。');
  }
}

export { parsePages };
