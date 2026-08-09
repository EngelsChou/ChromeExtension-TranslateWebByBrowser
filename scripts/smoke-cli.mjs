import { extractReturnedJson, runChromeDevtools } from '../bridge/chrome-devtools.js';
import { parsePages } from '../bridge/chatgpt.js';

const listed = await runChromeDevtools(['list_pages', '--output-format=json'], { timeout: 20_000 });
const pages = parsePages(listed.stdout);
const chatgpt = pages.find((page) => /^https:\/\/(?:chatgpt\.com|chat\.openai\.com)/u.test(page.url));
if (!chatgpt) throw new Error('No ChatGPT page found in the chrome-devtools daemon.');
if (!chatgpt.selected) await runChromeDevtools(['select_page', String(chatgpt.id), '--output-format=json'], { timeout: 20_000 });
await runChromeDevtools(['take_snapshot', '--output-format=json'], { timeout: 20_000 });
const evaluated = await runChromeDevtools([
  'evaluate_script',
  `() => ({
    url: location.href,
    title: document.title,
    hasComposer: Boolean(document.querySelector('#prompt-textarea, textarea[data-testid="prompt-textarea"]')),
    signedOut: [...document.querySelectorAll('button, a')].some((node) => /^(?:Log in|登入)$/iu.test(node.textContent.trim()))
  })`,
  '--output-format=json',
], { timeout: 20_000 });
const state = extractReturnedJson(evaluated.stdout);
console.log(JSON.stringify({ daemon: true, page: chatgpt, ...state }, null, 2));
if (!state.hasComposer) throw new Error('ChatGPT composer was not detected.');
