import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

const root = process.cwd();
const extension = path.join(root, 'extension');
const output = path.join(root, 'dist', 'extension');

await Promise.all([
  build({
    entryPoints: [path.join(root, 'src', 'extension', 'background.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    outfile: path.join(extension, 'background.js'),
    legalComments: 'none',
  }),
  build({
    entryPoints: [path.join(root, 'src', 'extension', 'content-entry.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    outfile: path.join(extension, 'content.js'),
    legalComments: 'none',
  }),
  build({
    entryPoints: [path.join(root, 'src', 'extension', 'chatgpt-content-entry.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    outfile: path.join(extension, 'chatgpt-content.js'),
    legalComments: 'none',
  }),
  build({
    entryPoints: [path.join(root, 'src', 'extension', 'm365-content-entry.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    outfile: path.join(extension, 'm365-content.js'),
    legalComments: 'none',
  }),
  build({
    entryPoints: [path.join(root, 'src', 'extension', 'popup.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    outfile: path.join(extension, 'popup.js'),
    legalComments: 'none',
  }),
]);

const manifestPath = path.join(extension, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('Built manifest is not Manifest V3.');

await rm(output, { recursive: true, force: true });
await mkdir(path.dirname(output), { recursive: true });
await cp(extension, output, { recursive: true });
console.log(`Built loadable extension: ${extension}`);
console.log(`Copied release staging extension: ${output}`);
