import path from 'node:path';
import { projectRoot, runChromeDevtools } from './chrome-devtools.js';

const command = process.argv[2];
if (!['start', 'stop', 'status'].includes(command)) {
  console.error('Usage: node bridge/cli.js <start|stop|status>');
  process.exitCode = 2;
} else {
  const args = command === 'start'
    ? [
        'start',
        `--userDataDir=${path.join(projectRoot, '.chatgpt-profile')}`,
        '--headless=false',
        '--performanceCrux=false',
        '--usageStatistics=false',
      ]
    : [command];
  const result = await runChromeDevtools(args, { timeout: 60_000, allowFailure: command === 'status' });
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
  if (result.exitCode !== 0) process.exitCode = 1;
  if (command === 'start' && result.exitCode === 0) {
    const listed = await runChromeDevtools(['list_pages', '--output-format=json'], { timeout: 30_000 });
    const pages = JSON.parse(listed.stdout).pages ?? [];
    if (!pages.some((page) => /^https:\/\/(?:chatgpt\.com|chat\.openai\.com)/u.test(page.url))) {
      const opened = await runChromeDevtools(['new_page', 'https://chatgpt.com/', '--output-format=json'], { timeout: 60_000 });
      if (opened.stdout) console.log(opened.stdout);
    }
    console.log('ChatGPT is open in the dedicated Chrome profile. Sign in there, then keep the window open.');
  }
}
