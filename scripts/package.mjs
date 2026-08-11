import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import archiver from 'archiver';

const root = process.cwd();
const extensionDir = path.join(root, 'dist', 'extension');
const releaseDir = path.join(root, 'dist', 'release');
const manifest = JSON.parse(await readFile(path.join(extensionDir, 'manifest.json'), 'utf8'));
const referencedFiles = [
  manifest.background.service_worker,
  manifest.action.default_popup,
  'popup.css',
  'popup.js',
  'content.js',
  ...manifest.content_scripts.flatMap(({ js }) => js),
];
await Promise.all([...new Set(referencedFiles)].map((file) => access(path.join(extensionDir, file))));
const zipPath = path.join(releaseDir, `translate-web-by-browser-ai-v${manifest.version}.zip`);
await mkdir(releaseDir, { recursive: true });
await rm(zipPath, { force: true });

await new Promise((resolve, reject) => {
  const output = createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  output.on('close', resolve);
  output.on('error', reject);
  archive.on('warning', reject);
  archive.on('error', reject);
  archive.pipe(output);
  archive.directory(extensionDir, false);
  archive.finalize();
});

console.log(`Created Chrome Extension ZIP: ${zipPath}`);
