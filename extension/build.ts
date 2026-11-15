// `npm run extension:build`: esbuild bundles Setpoint on job boards' TypeScript into
// extension/dist/, with its manifest and options page beside it. Chrome loads dist/ unpacked
// (README.md › Building and loading it). dist/ stays out of git.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, 'src');
const DIST = path.join(HERE, 'dist');

fs.rmSync(DIST, {recursive: true, force: true});
await build({
  entryPoints: ['content', 'background', 'options'].map(name => path.join(SRC, `${name}.ts`)),
  outdir: DIST,
  bundle: true,
  // The content script is a classic script, and the service worker and the options page are kept the same.
  format: 'iife',
  target: 'chrome120',
  // Zod's `z` brings every locale, about 770 KB of the service worker's 790 unminified. The maps keep
  // DevTools readable.
  minify: true,
  sourcemap: 'linked',
  logLevel: 'info',
});
for (const file of ['manifest.json', 'options.html']) fs.copyFileSync(path.join(SRC, file), path.join(DIST, file));
console.log(`Load ${path.relative(process.cwd(), DIST) || '.'} unpacked in chrome://extensions (README.md › Building and loading it).`);
