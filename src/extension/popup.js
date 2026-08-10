import { DEFAULT_PROVIDER, getProvider } from './providers.js';

const elements = {
  provider: document.querySelector('#provider'),
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
  elements.translate.disabled = !ready;
  elements.connect.hidden = ready;
  elements.connect.textContent = `開啟 ${selectedProvider().name} 登入`;
}

async function checkStatus() {
  const provider = selectedProvider();
  setStatus('pending', `正在檢查 ${provider.name}`, '正在尋找或建立服務分頁…');
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
  elements.progress.hidden = false;
  elements.progressBar.style.width = `${Math.round((message.completed / message.total) * 100)}%`;
  setStatus('pending', '翻譯中…', `批次 ${message.completed}/${message.total}，已處理 ${message.translated}/${message.nodes} 段`);
});

elements.provider.addEventListener('change', async () => {
  showError('');
  elements.progress.hidden = true;
  await chrome.storage.local.set({ translationProvider: elements.provider.value });
  await checkStatus();
});

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
  elements.progress.hidden = false;
  elements.progressBar.style.width = '0%';
  setStatus('pending', '準備翻譯…', '正在擷取畫面中的可見英文 Text Nodes');
  const result = await chrome.runtime.sendMessage({ type: 'TRANSLATE_PAGE', provider: elements.provider.value });
  if (result.ok) {
    elements.progressBar.style.width = '100%';
    setStatus('ok', '翻譯完成', result.message || `已翻譯 ${result.translated}/${result.total} 段文字`);
  } else {
    setStatus('error', '翻譯失敗', '已套用的批次會保留，可按「恢復原文」還原。');
    showError(result.error);
  }
  elements.provider.disabled = false;
  elements.translate.disabled = false;
});

elements.restore.addEventListener('click', async () => {
  showError('');
  const result = await chrome.runtime.sendMessage({ type: 'RESTORE_PAGE', provider: elements.provider.value });
  if (result.ok) setStatus('ok', '已恢復原文', `已恢復 ${result.restored} 段文字`);
  else showError(result.error);
});

async function initialize() {
  const stored = await chrome.storage.local.get('translationProvider');
  elements.provider.value = stored.translationProvider === 'm365' ? 'm365' : DEFAULT_PROVIDER;
  await checkStatus();
}

initialize().catch((error) => {
  setStatus('error', '初始化失敗', '無法連線 background service worker');
  showError(error.message);
  showConnectionState(false);
});
