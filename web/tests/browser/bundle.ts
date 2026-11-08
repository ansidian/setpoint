// The server a browser run starts, once per check (SV-145): server.ts and the templates' script,
// each in one file with what it imports. Finding and reading a few hundred modules was most of a
// boot: 0.19 s against 0.55, 0.25 s of a core against 0.74, and 168 MB against 351. Only run.ts asks
// for it, for a run it has just bundled, so nothing else can meet a stale one.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

/** Bundles into `outdir`, under the checkout so what stays out of the bundle still resolves, and returns it. */
export async function bundleServer(root: string): Promise<string> {
  const outdir = path.join(root, 'node_modules', '.cache', 'setpoint-server');
  await build({
    absWorkingDir: root, entryPoints: ['server/src/server.ts', 'server/src/dev/template.ts'], outdir,
    bundle: true, platform: 'node', format: 'esm', entryNames: '[name]', outExtension: {'.js': '.mjs'}, logLevel: 'warning',
    // Native code stays in its package.
    external: ['better-sqlite3', 'sharp'],
    // Bundled CommonJS calls require, which an ES module doesn't have.
    banner: {js: 'import {createRequire} from \'node:module\'; const require = createRequire(import.meta.url);'},
    // A module finds its files beside itself (migrations, the default rules), wherever it's bundled.
    plugins: [{
      name: 'own-url',
      setup: bundler => bundler.onLoad({filter: /\/server\/src\/.*\.ts$|\/shared\/.*\.ts$/}, ({path: file}) => ({
        contents: fs.readFileSync(file, 'utf8').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(file).href)),
        loader: 'ts',
      })),
    }],
  });
  return outdir;
}
