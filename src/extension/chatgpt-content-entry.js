import { buildTranslationPrompt, parseTranslationResponse } from './chatgpt-core.js';

const COMPOSER_SELECTOR = '#prompt-textarea, textarea[data-testid="prompt-textarea"], [contenteditable="true"][data-virtualkeyboard]';
const ASSISTANT_SELECTOR = '[data-message-author-role="assistant"]';
if (!globalThis.__translateWebChatGptContentReady) {
  globalThis.__translateWebChatGptContentReady = true;
  let busy = false;

function sessionStatus() {
  const composer = document.querySelector(COMPOSER_SELECTOR);
  const signedOut = [...document.querySelectorAll('button, a')]
    .some((node) => /^(?:Log in|Sign up|登入|免費註冊)$/iu.test(node.textContent.trim()));
  return {
    ready: Boolean(composer) && !signedOut,
    signedOut,
    hasDraft: Boolean((composer?.value ?? composer?.textContent ?? '').trim()),
    url: location.href,
  };
}

function setComposerValue(composer, value) {
  composer.focus();
  if (composer instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!setter) throw new Error('無法寫入 ChatGPT 輸入框。');
    setter.call(composer, value);
    composer.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertText',
      data: value,
    }));
  } else {
    composer.replaceChildren();
    const inserted = document.execCommand('insertText', false, value);
    if (!inserted) {
      const paragraph = document.createElement('p');
      paragraph.textContent = value;
      composer.append(paragraph);
      composer.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: value,
      }));
    }
  }
}

async function waitForSendButton(composer, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const button = document.querySelector([
      'button[data-testid="send-button"]',
      'button[aria-label*="Send" i]',
      'button[aria-label*="傳送" i]',
    ].join(',')) ?? composer.closest('form')?.querySelector('button[type="submit"]');
    if (button && !button.disabled) return button;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('ChatGPT 傳送按鈕尚未可用。');
}

function assistantText(node) {
  const content = node?.querySelector('.markdown, .prose, [class*="markdown"]') ?? node;
  return content?.innerText?.trim() ?? '';
}

async function submitAndWait(prompt) {
  const composer = document.querySelector(COMPOSER_SELECTOR);
  if (!composer) throw new Error('找不到 ChatGPT 輸入框，請確認已登入。');
  const beforeNodes = [...document.querySelectorAll(ASSISTANT_SELECTOR)];
  const beforeText = assistantText(beforeNodes.at(-1));
  setComposerValue(composer, prompt);
  (await waitForSendButton(composer)).click();

  const deadline = Date.now() + 180_000;
  let stableText = '';
  let stableCount = 0;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    const assistants = [...document.querySelectorAll(ASSISTANT_SELECTOR)];
    const text = assistantText(assistants.at(-1));
    const streaming = Boolean(document.querySelector([
      'button[data-testid="stop-button"]',
      'button[aria-label*="Stop" i]',
      'button[aria-label*="停止" i]',
    ].join(',')));
    const isNew = assistants.length > beforeNodes.length || (text && text !== beforeText);
    const pageError = [...document.querySelectorAll('[role="alert"], [data-testid*="error" i]')]
      .map((node) => node.textContent.trim())
      .find((value) => /(?:something went wrong|network error|發生錯誤|網路錯誤|error)/iu.test(value));
    if (pageError && !isNew) throw new Error(`ChatGPT 顯示錯誤：${pageError}`);
    if (!isNew || !text) continue;
    if (text === stableText) stableCount += 1;
    else {
      stableText = text;
      stableCount = 1;
    }
    if (!streaming && stableCount >= 2) return text;
  }
  throw new Error('等待 ChatGPT 回覆逾時（180 秒）。');
}

async function translate(items) {
  if (busy) throw new Error('ChatGPT 分頁正在處理另一批翻譯。');
  if (!sessionStatus().ready) throw new Error('ChatGPT 尚未登入或輸入框未就緒。');
  busy = true;
  try {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await submitAndWait(buildTranslationPrompt(items, { retry: attempt > 0 }));
        return parseTranslationResponse(response, items);
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`ChatGPT 連續兩次未回傳有效翻譯：${lastError.message}`);
  } finally {
    busy = false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'PROVIDER_STATUS') {
    sendResponse(sessionStatus());
    return false;
  }
  if (message?.type !== 'PROVIDER_TRANSLATE_BATCH') return false;
  translate(message.items ?? [])
    .then((translations) => sendResponse({ ok: true, translations }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
}
