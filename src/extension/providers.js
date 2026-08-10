export const DEFAULT_PROVIDER = 'chatgpt';

export const PROVIDERS = Object.freeze({
  chatgpt: Object.freeze({
    id: 'chatgpt',
    name: 'ChatGPT',
    homeUrl: 'https://chatgpt.com/',
    tabPatterns: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
    ownedUrl: /^https:\/\/(?:chatgpt\.com|chat\.openai\.com)(?:\/|$)/u,
    contentScript: 'chatgpt-content.js',
  }),
  m365: Object.freeze({
    id: 'm365',
    name: 'Microsoft 365 Copilot',
    homeUrl: 'https://m365.cloud.microsoft/chat/',
    tabPatterns: ['https://m365.cloud.microsoft/*'],
    ownedUrl: /^https:\/\/m365\.cloud\.microsoft(?:\/|$)/u,
    contentScript: 'm365-content.js',
  }),
});

export function getProvider(id) {
  const provider = PROVIDERS[id];
  if (!provider) throw new Error(`不支援的翻譯服務：${String(id)}`);
  return provider;
}
