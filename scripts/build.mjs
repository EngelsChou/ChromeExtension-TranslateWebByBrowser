import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

const root = process.cwd();
const output = path.join(root, 'dist', 'extension');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

await Promise.all([
  cp(path.join(root, 'extension', 'manifest.json'), path.join(output, 'manifest.json')),
  cp(path.join(root, 'extension', 'popup.html'), path.join(output, 'popup.html')),
  cp(path.join(root, 'extension', 'popup.css'), path.join(output, 'popup.css')),
  build({
    entryPoints: [path.join(root, 'src', 'extension', 'background.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    outfile: path.join(output, 'background.js'),
    legalComments: 'none',
  }),
  build({
    entryPoints: [path.join(root, 'src', 'extension', 'content-entry.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    outfile: path.join(output, 'content.js'),
    legalComments: 'none',
  }),
  build({
    entryPoints: [path.join(root, 'src', 'extension', 'chatgpt-content-entry.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    outfile: path.join(output, 'chatgpt-content.js'),
    legalComments: 'none',
  }),
  build({
    entryPoints: [path.join(root, 'src', 'extension', 'm365-content-entry.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    outfile: path.join(output, 'm365-content.js'),
    legalComments: 'none',
  }),
  build({
    entryPoints: [path.join(root, 'src', 'extension', 'popup.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    outfile: path.join(output, 'popup.js'),
    legalComments: 'none',
  }),
]);

const manifestPath = path.join(output, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('Built manifest is not Manifest V3.');
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built unpacked extension: ${output}`);
