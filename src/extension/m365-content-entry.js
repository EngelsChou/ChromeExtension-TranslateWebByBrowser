import {
  buildM365TranslationPrompt,
  mergePartialTranslationCandidates,
  parseFirstValidTranslationResponse,
} from './chatgpt-core.js';
import { hasCompleteSinglePrompt, normalizeComposerText } from './m365-composer.js';
import { PROVIDER_RESPONSE_TIMEOUT_MS } from './job-guard.js';

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
const STREAMING_RESPONSE_SELECTOR = 'p, pre, code';
const USER_MESSAGE_SELECTOR = [
  '.fai-UserMessage',
  '[class*="UserMessage"]',
  '[data-testid="chatOutput"]',
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

  function composerText(composer) {
    const text = 'value' in composer ? composer.value : composer.innerText || composer.textContent || '';
    return normalizeComposerText(text);
  }

  function notifyComposerCleared(composer) {
    composer.replaceChildren();
    composer.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'deleteContentBackward',
      data: null,
    }));
    composer.dispatchEvent(new Event('change', { bubbles: true }));
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

  async function setComposerValue(composer, value) {
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
      await sleep(100);
      return;
    }

    notifyComposerCleared(composer);
    await sleep(50);

    try {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', value);
      const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(paste, 'clipboardData', { value: dataTransfer });
      composer.dispatchEvent(paste);
      await sleep(150);
      if (hasCompleteSinglePrompt(composerText(composer), value)) return;
    } catch { /* fall through to a clean insertText attempt */ }

    notifyComposerCleared(composer);
    await sleep(50);
    document.execCommand('insertText', false, value);
    await sleep(100);
    if (!hasCompleteSinglePrompt(composerText(composer), value)) {
      notifyComposerCleared(composer);
      await sleep(50);
      const paragraph = document.createElement('p');
      paragraph.textContent = value;
      composer.append(paragraph);
      composer.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: null,
      }));
    }
    composer.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(100);
  }

  function userMessageCount() {
    return new Set([
      ...document.querySelectorAll('.fai-UserMessage, [class*="UserMessage"]'),
    ]).size;
  }

  function isGenerating() {
    return [...document.querySelectorAll('button, [role="button"]')]
      .some((node) => isClickable(node)
        && /(?:stop|停止|中止|取消生成|取消產生|取消回覆|取消回应)/iu.test(labelOf(node)));
  }

  async function waitForSubmission(composer, previousUserMessages, timeout = 2_500) {
    const submitted = () => !composerText(composer)
      || userMessageCount() > previousUserMessages
      || isGenerating();
    let deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (submitted()) return;
      await sleep(100);
    }

    composer.focus();
    for (const type of ['keydown', 'keypress', 'keyup']) {
      composer.dispatchEvent(new KeyboardEvent(type, {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
        bubbles: true, cancelable: true,
      }));
    }
    deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (submitted()) return;
      await sleep(100);
    }
    throw new Error('Microsoft 365 Copilot 傳送按鈕尚未送出翻譯內容。');
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
      ...document.querySelectorAll(STREAMING_RESPONSE_SELECTOR),
    ];
    const texts = nodes
      .filter((node) => !node.closest(USER_MESSAGE_SELECTOR))
      .filter((node) => !COMPOSER_SELECTORS.some((selector) => node.closest(selector)))
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
    const generating = isGenerating();
    const candidates = responseCandidateTexts().filter((text) => !excludedCandidates.has(text));
    let translations = null;
    try {
      translations = parseFirstValidTranslationResponse(candidates, items);
    } catch { /* a complete, schema-valid response has not appeared yet */ }
    return { candidates, translations, generating, copyActions: copyActionCount() };
  }

  async function submitAndWait(prompt, items, requestId) {
    const composer = findComposer();
    if (!composer) throw new Error('找不到 Microsoft 365 Copilot 輸入框，請確認已登入 Copilot Chat。');
    const before = responseState(items);
    const previousCandidates = new Set(before.candidates);
    const previousUserMessages = userMessageCount();
    await setComposerValue(composer, prompt);
    if (!hasCompleteSinglePrompt(composerText(composer), prompt)) {
      throw new Error('Microsoft 365 Copilot 輸入框內容重複或不完整，尚未送出。');
    }
    (await waitForSendButton(composer)).click();
    await waitForSubmission(composer, previousUserMessages);

    const deadline = Date.now() + PROVIDER_RESPONSE_TIMEOUT_MS;
    let stableTranslation = '';
    let stableCount = 0;
    let generationSeen = false;
    const emittedIds = new Set();
    while (Date.now() < deadline) {
      await sleep(emittedIds.size ? 400 : 150);
      if (location.pathname.toLowerCase().startsWith('/chat/blocked')) {
        throw new Error('Microsoft 365 Copilot Chat 已導向封鎖頁面；請確認帳戶授權與租用戶原則。');
      }
      const current = responseState(items, previousCandidates);
      generationSeen ||= current.generating;
      const partial = mergePartialTranslationCandidates(current.candidates, items)
        .filter(({ id }) => !emittedIds.has(id));
      if (partial.length && requestId) {
        const acknowledgement = await chrome.runtime.sendMessage({
          type: 'PROVIDER_TRANSLATION_PARTIAL', requestId, translations: partial,
        });
        if (!acknowledgement?.ok
          || (acknowledgement.applied !== partial.length && !acknowledgement.duplicate)) {
          throw new Error('原網頁未確認套用 Microsoft 365 Copilot 翻譯，已停止以避免遺漏中文。');
        }
        partial.forEach(({ id }) => emittedIds.add(id));
      }
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
    throw new Error(`等待 Microsoft 365 Copilot 回覆逾時（${Math.round(PROVIDER_RESPONSE_TIMEOUT_MS / 1000)} 秒）。`);
  }

  async function translate(items, requestId) {
    if (busy) throw new Error('Microsoft 365 Copilot 分頁正在處理另一批翻譯。');
    const status = sessionStatus();
    if (!status.ready) throw new Error(status.message || 'Microsoft 365 Copilot 尚未登入或輸入框不可用。');
    busy = true;
    try {
      let lastError;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return await submitAndWait(buildM365TranslationPrompt(items, { retry: attempt > 0 }), items, requestId);
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
    translate(message.items ?? [], message.requestId)
      .then((translations) => sendResponse({ ok: true, translations }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
}
