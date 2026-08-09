const elements = {
  dot: document.querySelector('#status-dot'),
  title: document.querySelector('#status-title'),
  detail: document.querySelector('#status-detail'),
  translate: document.querySelector('#translate'),
  restore: document.querySelector('#restore'),
  error: document.querySelector('#error'),
  progress: document.querySelector('#progress'),
  progressBar: document.querySelector('#progress-bar'),
};

function setStatus(kind, title, detail) {
  elements.dot.className = `dot ${kind}`;
  elements.title.textContent = title;
  elements.detail.textContent = detail;
}

function showError(message) {
  elements.error.textContent = message;
  elements.error.hidden = !message;
}

async function checkStatus() {
  const result = await chrome.runtime.sendMessage({ type: 'GET_BRIDGE_STATUS' });
  if (result.ok && result.chatgptReady) {
    setStatus('ok', '已連線', 'ChatGPT 分頁已登入並可接收翻譯');
    elements.translate.disabled = false;
  } else if (result.ok) {
    setStatus('pending', 'Bridge 已啟動', result.message || '請先開啟並登入 ChatGPT');
  } else {
    setStatus('error', '尚未連線', result.error || '請先執行 npm run bridge');
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'TRANSLATION_PROGRESS') return;
  elements.progress.hidden = false;
  elements.progressBar.style.width = `${Math.round((message.completed / message.total) * 100)}%`;
  setStatus('pending', '翻譯中…', `批次 ${message.completed}/${message.total}，已替換 ${message.translated}/${message.nodes} 段`);
});

elements.translate.addEventListener('click', async () => {
  showError('');
  elements.translate.disabled = true;
  elements.progress.hidden = false;
  elements.progressBar.style.width = '0%';
  setStatus('pending', '擷取可見文字…', '只會送出英文 Text Nodes');
  const result = await chrome.runtime.sendMessage({ type: 'TRANSLATE_PAGE' });
  if (result.ok) {
    elements.progressBar.style.width = '100%';
    setStatus('ok', '翻譯完成', result.message || `已翻譯 ${result.translated}/${result.total} 段文字`);
  } else {
    setStatus('error', '翻譯失敗', '頁面未變更的批次可重新嘗試');
    showError(result.error);
  }
  elements.translate.disabled = false;
});

elements.restore.addEventListener('click', async () => {
  showError('');
  const result = await chrome.runtime.sendMessage({ type: 'RESTORE_PAGE' });
  if (result.ok) setStatus('ok', '已恢復原文', `已恢復 ${result.restored} 段文字`);
  else showError(result.error);
});

checkStatus().catch((error) => {
  setStatus('error', '狀態檢查失敗', '無法存取 background service worker');
  showError(error.message);
});
