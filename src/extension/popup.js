import { DEFAULT_PROVIDER, getProvider } from './providers.js';

const elements = {
  provider: document.querySelector('#provider'),
  scope: document.querySelector('#scope'),
  displayMode: document.querySelector('#display-mode'),
  dot: document.querySelector('#status-dot'),
  title: document.querySelector('#status-title'),
  detail: document.querySelector('#status-detail'),
  translate: document.querySelector('#translate'),
  connect: document.querySelector('#connect'),
  restore: document.querySelector('#restore'),
  error: document.querySelector('#error'),
  progress: document.querySelector('#progress'),
  progressBar: document.querySelector('#progress-bar'),
};
let providerReady = false;

function selectedProvider() {
  return getProvider(elements.provider.value);
}

function setStatus(kind, title, detail) {
  elements.dot.className = `dot ${kind}`;
  elements.title.textContent = title;
  elements.detail.textContent = detail;
}

function showError(message) {
  elements.error.textContent = message;
  elements.error.hidden = !message;
}

function showConnectionState(ready) {
  providerReady = ready;
  elements.translate.disabled = !ready;
  elements.connect.hidden = ready;
  elements.connect.textContent = `開啟 ${selectedProvider().name} 登入`;
}

function progressPercent(job) {
  if (job.state === 'complete') return 100;
  if (!job.total) return 5;
  return Math.max(5, Math.round(((job.completed || 0) / job.total) * 100));
}

async function checkStatus() {
  const provider = selectedProvider();
  setStatus('pending', `已選擇 ${provider.name}`, '只檢查既有分頁，不會自動開啟服務。');
  showConnectionState(false);
  const result = await chrome.runtime.sendMessage({ type: 'GET_PROVIDER_STATUS', provider: provider.id });
  if (provider.id !== elements.provider.value) return;
  if (result.ok && result.providerReady) {
    setStatus('ok', '已連線', `${provider.name} 已登入，可以開始翻譯。`);
    showConnectionState(true);
  } else if (result.ok) {
    setStatus(result.blocked ? 'error' : 'pending', `需要處理 ${provider.name}`, result.message);
    showConnectionState(false);
  } else {
    setStatus('error', `無法連線 ${provider.name}`, result.error);
    showConnectionState(false);
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'TRANSLATION_PROGRESS' || message.provider !== elements.provider.value) return;
  if (message.state === 'complete') {
    elements.progress.hidden = false;
    elements.progressBar.style.width = '100%';
    setStatus('ok', '翻譯完成', `已處理 ${message.translated}/${message.blocks} 個段落`);
    return;
  }
  elements.progress.hidden = false;
  elements.progressBar.style.width = `${progressPercent(message)}%`;
  if (message.state === 'error') {
    setStatus('error', '翻譯失敗', '錯誤已保存，可恢復已套用的段落。');
    showError(message.error);
    return;
  }
  setStatus('pending', '翻譯中…', `批次 ${message.completed}/${message.total}，已處理 ${message.translated}/${message.blocks} 個段落`);
});

elements.provider.addEventListener('change', async () => {
  showError('');
  elements.progress.hidden = true;
  await chrome.storage.local.set({ translationProvider: elements.provider.value });
  await checkStatus();
});

for (const element of [elements.scope, elements.displayMode]) {
  element.addEventListener('change', () => chrome.storage.local.set({
    translationScope: elements.scope.value,
    translationDisplayMode: elements.displayMode.value,
  }));
}

elements.connect.addEventListener('click', async () => {
  showError('');
  const result = await chrome.runtime.sendMessage({ type: 'OPEN_PROVIDER', provider: elements.provider.value });
  if (!result.ok) showError(result.error);
  else window.close();
});

elements.translate.addEventListener('click', async () => {
  showError('');
  elements.translate.disabled = true;
  elements.provider.disabled = true;
  elements.scope.disabled = true;
  elements.displayMode.disabled = true;
  elements.progress.hidden = false;
  elements.progressBar.style.width = '0%';
  setStatus('pending', '準備翻譯…', elements.scope.value === 'main'
    ? '正在辨識主要內容與段落'
    : '正在掃描段落與當下視窗可見的功能選單');
  const result = await chrome.runtime.sendMessage({
    type: 'TRANSLATE_PAGE',
    provider: elements.provider.value,
    scope: elements.scope.value,
    displayMode: elements.displayMode.value,
  });
  if (result.ok) {
    elements.progressBar.style.width = '100%';
    setStatus('ok', '翻譯完成', result.message || `已翻譯 ${result.translated}/${result.total} 段文字`);
  } else {
    setStatus('error', '翻譯失敗', '已套用的批次會保留，可按「恢復原文」還原。');
    showError(result.error);
  }
  elements.provider.disabled = false;
  elements.scope.disabled = false;
  elements.displayMode.disabled = false;
  elements.translate.disabled = !providerReady;
});

elements.restore.addEventListener('click', async () => {
  showError('');
  const result = await chrome.runtime.sendMessage({ type: 'RESTORE_PAGE', provider: elements.provider.value });
  if (result.ok) setStatus('ok', '已恢復原文', `已恢復 ${result.restored} 段文字`);
  else showError(result.error);
});

async function initialize() {
  const stored = await chrome.storage.local.get([
    'translationProvider', 'translationScope', 'translationDisplayMode',
  ]);
  elements.provider.value = stored.translationProvider === 'm365' ? 'm365' : DEFAULT_PROVIDER;
  elements.scope.value = stored.translationScope === 'page' ? 'page' : 'main';
  elements.displayMode.value = stored.translationDisplayMode === 'replace' ? 'replace' : 'bilingual';
  await checkStatus();
  const jobResult = await chrome.runtime.sendMessage({ type: 'GET_TRANSLATION_JOB' });
  const job = jobResult.ok ? jobResult.state ? jobResult : null : null;
  if (job?.provider === elements.provider.value) {
    if (job.state === 'running') {
      elements.progress.hidden = false;
      elements.progressBar.style.width = `${progressPercent(job)}%`;
      setStatus('pending', '翻譯仍在進行', `批次 ${job.completed}/${job.total}，已處理 ${job.translated}/${job.blocks} 個段落`);
    } else if (job.state === 'complete') {
      elements.progress.hidden = false;
      elements.progressBar.style.width = '100%';
      setStatus('ok', '上次翻譯完成', `已處理 ${job.translated}/${job.blocks} 個段落`);
    } else if (job.state === 'error') {
      setStatus('error', '上次翻譯失敗', '可按「恢復原文」還原已完成的批次。');
      showError(job.error);
    }
  }
}

initialize().catch((error) => {
  setStatus('error', '初始化失敗', '無法連線 background service worker');
  showError(error.message);
  showConnectionState(false);
});
