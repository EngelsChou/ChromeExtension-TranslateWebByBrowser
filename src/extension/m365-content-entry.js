import { buildM365TranslationPrompt, parseFirstValidTranslationResponse } from './chatgpt-core.js';

const COMPOSER_SELECTORS = [
  'textarea#userInput',
  'textarea[data-testid*="chat-input" i]',
  '[contenteditable="true"][role="textbox"]',
  '[data-lexical-editor="true"]',
  '[data-testid*="composer" i] [contenteditable="true"]',
];
const ASSISTANT_SELECTOR = [
  '[data-content="ai-message"]',
  '[data-testid*="assistant" i]',
  '[data-testid*="response" i]',
  '[data-author="assistant"]',
  '[data-message-role="assistant"]',
  '[data-role="assistant"]',
  '[data-message-type="assistant"]',
  '[class*="AIMessage"]',
  '[class*="AiMessage"]',
  '[class*="AssistantMessage"]',
  '[class*="CopilotMessage"]',
].join(',');
const RESPONSE_CONTENT_SELECTOR = [
  '.fai-CopilotMessage__content',
  '[data-testid*="message-content" i]',
  '.markdown',
  '.ac-textBlock',
  '[class*="MessageContent"]',
  '[class*="ResponseContent"]',
  '[class*="ResponseRenderer"]',
].join(',');

if (!globalThis.__translateWebM365ContentReady) {
  globalThis.__translateWebM365ContentReady = true;
  let busy = false;

  const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

  function isVisible(node) {
    if (!node) return false;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
      && rect.width > 0 && rect.height > 0;
  }

  function findComposer() {
    return COMPOSER_SELECTORS
      .flatMap((selector) => [...document.querySelectorAll(selector)])
      .find(isVisible);
  }

  function labelOf(node) {
    return [
      node?.getAttribute('aria-label'),
      node?.getAttribute('title'),
      node?.getAttribute('data-testid'),
      node?.textContent,
    ].filter(Boolean).join(' ').trim();
  }

  function sessionStatus() {
    const composer = findComposer();
    const blocked = location.pathname.toLowerCase().startsWith('/chat/blocked');
    const signedOut = [...document.querySelectorAll('a, button, [role="button"]')]
      .some((node) => isVisible(node) && /(?:sign in|log in|login|登入|登錄|登录)/iu.test(labelOf(node)));
    const draft = composer && ('value' in composer ? composer.value : composer.innerText || composer.textContent);
    return {
      ready: Boolean(composer) && !signedOut && !blocked,
      signedOut,
      blocked,
      hasDraft: Boolean(draft?.trim()),
      url: location.href,
      message: blocked
        ? '此帳戶或組織無法使用 Microsoft 365 Copilot Chat。請確認授權與租用戶原則；尚未送出任何文字。'
        : undefined,
    };
  }

  function setComposerValue(composer, value) {
    composer.focus();
    if (composer instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (!setter) throw new Error('無法寫入 Microsoft 365 Copilot 輸入框。');
      setter.call(composer, value);
      composer.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: value,
      }));
      composer.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

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

  function isClickable(node) {
    return Boolean(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true' && isVisible(node);
  }

  function belongsToComposer(button, composer) {
    const form = composer.closest('form');
    const wrapper = composer.closest('[data-testid*="composer" i], [data-testid*="chat-input" i], [class*="Composer"], [class*="ChatInput"], [class*="PromptInput"]');
    const ancestors = [];
    for (let node = composer, depth = 0; node && depth < 8; node = node.parentElement, depth += 1) ancestors.push(node);
    const composerRect = composer.getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    const verticalDistance = Math.max(0, composerRect.top - rect.bottom, rect.top - composerRect.bottom);
    const overlaps = rect.right >= composerRect.left - 160 && rect.left <= composerRect.right + 160;
    return Boolean(form?.contains(button) || wrapper?.contains(button)
      || ancestors.some((node) => node.contains(button)) || (overlaps && verticalDistance <= 160));
  }

  async function waitForSendButton(composer, timeout = 15_000) {
    const selectors = [
      'button[class*="SendButton"][type="submit"]',
      'button[type="submit"][aria-label]',
      'button[data-testid*="submit" i]',
      'button[data-testid*="send" i]',
      'button[aria-label*="Send" i]',
      'button[aria-label*="Submit" i]',
      'button[aria-label*="傳送" i]',
      'button[aria-label*="发送" i]',
    ];
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      for (const selector of selectors) {
        const button = [...document.querySelectorAll(selector)]
          .find((candidate) => isClickable(candidate)
            && belongsToComposer(candidate, composer)
            && !/(?:stop|停止|中止|取消)/iu.test(labelOf(candidate)));
        if (button) return button;
      }
      await sleep(100);
    }
    throw new Error('Microsoft 365 Copilot 傳送按鈕沒有啟用。');
  }

  function responseCandidateTexts() {
    const nodes = [
      ...document.querySelectorAll(RESPONSE_CONTENT_SELECTOR),
      ...document.querySelectorAll(ASSISTANT_SELECTOR),
    ];
    const texts = nodes
      .map((node) => node.innerText?.trim() ?? '')
      .filter((text) => text.includes('"translations"'))
      .reverse();
    return [...new Set(texts)];
  }

  function copyActionCount() {
    return [...document.querySelectorAll('button, [role="button"]')]
      .filter((node) => {
        const label = labelOf(node);
        return /(?:copy|複製|复制|コピー|복사)/iu.test(label)
          && !/(?:code|程式碼|代码|table|表格)/iu.test(label)
          && !node.closest('pre, code, [class*="code"], [data-testid*="code"]');
      }).length;
  }

  function responseState(items, excludedCandidates = new Set()) {
    const generating = [...document.querySelectorAll('button, [role="button"]')]
      .some((node) => isClickable(node) && /(?:stop|停止|中止|取消生成|取消產生|取消回覆|取消回应)/iu.test(labelOf(node)));
    const candidates = responseCandidateTexts().filter((text) => !excludedCandidates.has(text));
    let translations = null;
    try {
      translations = parseFirstValidTranslationResponse(candidates, items);
    } catch { /* a complete, schema-valid response has not appeared yet */ }
    return { candidates, translations, generating, copyActions: copyActionCount() };
  }

  async function submitAndWait(prompt, items) {
    const composer = findComposer();
    if (!composer) throw new Error('找不到 Microsoft 365 Copilot 輸入框，請確認已登入 Copilot Chat。');
    const before = responseState(items);
    const previousCandidates = new Set(before.candidates);
    setComposerValue(composer, prompt);
    const written = 'value' in composer ? composer.value : composer.innerText || composer.textContent;
    if (!written?.trim()) throw new Error('Microsoft 365 Copilot 輸入框仍是空白，未送出文字。');
    (await waitForSendButton(composer)).click();

    const deadline = Date.now() + 180_000;
    let stableTranslation = '';
    let stableCount = 0;
    let generationSeen = false;
    while (Date.now() < deadline) {
      await sleep(1_200);
      if (location.pathname.toLowerCase().startsWith('/chat/blocked')) {
        throw new Error('Microsoft 365 Copilot Chat 已導向封鎖頁面；請確認帳戶授權與租用戶原則。');
      }
      const current = responseState(items, previousCandidates);
      generationSeen ||= current.generating;
      if (!current.translations) continue;
      const signature = JSON.stringify(current.translations);
      if (signature === stableTranslation) stableCount += 1;
      else {
        stableTranslation = signature;
        stableCount = 1;
      }
      const completionMarker = generationSeen || current.copyActions > before.copyActions;
      if (!current.generating && stableCount >= (completionMarker ? 1 : 3)) return current.translations;
    }
    throw new Error('等待 Microsoft 365 Copilot 回覆逾時（180 秒）。');
  }

  async function translate(items) {
    if (busy) throw new Error('Microsoft 365 Copilot 分頁正在處理另一批翻譯。');
    const status = sessionStatus();
    if (!status.ready) throw new Error(status.message || 'Microsoft 365 Copilot 尚未登入或輸入框不可用。');
    busy = true;
    try {
      let lastError;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return await submitAndWait(buildM365TranslationPrompt(items, { retry: attempt > 0 }), items);
        } catch (error) {
          lastError = error;
        }
      }
      throw new Error(`Microsoft 365 Copilot 兩次都未產生有效 JSON 翻譯：${lastError.message}`);
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
