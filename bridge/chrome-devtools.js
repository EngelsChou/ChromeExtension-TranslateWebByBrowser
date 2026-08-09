import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliEntry = path.join(projectRoot, 'node_modules', 'chrome-devtools-mcp', 'build', 'src', 'bin', 'chrome-devtools.js');

export async function runChromeDevtools(args, { timeout = 30_000, allowFailure = false } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliEntry, ...args], {
      cwd: projectRoot,
      timeout,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      env: {
        ...process.env,
        CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: '1',
        CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1',
      },
    });
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 };
  } catch (error) {
    if (allowFailure) {
      return {
        stdout: String(error.stdout ?? '').trim(),
        stderr: String(error.stderr ?? error.message).trim(),
        exitCode: error.code ?? 1,
      };
    }
    const detail = String(error.stderr ?? error.stdout ?? error.message).trim();
    throw new Error(`chrome-devtools CLI 失敗：${detail}`);
  }
}

export function contentText(output) {
  if (!output) return '';
  try {
    const parsed = JSON.parse(output);
    if (typeof parsed === 'string') return parsed;
    if (Array.isArray(parsed)) {
      const textItems = parsed.filter((item) => item?.type === 'text').map((item) => item.text);
      return textItems.length ? textItems.join('\n') : JSON.stringify(parsed);
    }
    if (typeof parsed?.message === 'string') return parsed.message;
    if (Array.isArray(parsed?.content)) {
      return parsed.content.filter((item) => item.type === 'text').map((item) => item.text).join('\n');
    }
    return JSON.stringify(parsed);
  } catch {
    return output;
  }
}

export function extractReturnedJson(output) {
  const text = contentText(output);
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)].map((match) => match[1].trim());
  for (const candidate of [...fenced, text]) {
    try {
      return JSON.parse(candidate);
    } catch {
      const start = Math.min(...['{', '['].map((token) => {
        const index = candidate.indexOf(token);
        return index < 0 ? Number.POSITIVE_INFINITY : index;
      }));
      if (!Number.isFinite(start)) continue;
      const fragment = balancedJson(candidate, start);
      if (!fragment) continue;
      try { return JSON.parse(fragment); } catch { /* try the next candidate */ }
    }
  }
  throw new Error('chrome-devtools 回傳內容不含可解析的 JSON。');
}

function balancedJson(text, start) {
  const opening = text[start];
  const closing = opening === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === opening) depth += 1;
    else if (char === closing && --depth === 0) return text.slice(start, index + 1);
  }
  return null;
}

export { projectRoot };
