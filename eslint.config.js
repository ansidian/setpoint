// One flat config for every workspace, with React's hook rules for web/ and the boundaries
// BUILD-PLAN.md › Stack and layout asks the lint to enforce.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Provider SDKs: only server/src/providers/ may import them.
const providerSdks = {
  group: [
    'googleapis', '@googleapis/*', 'google-auth-library', '@google-cloud/*', '@googlemaps/*',
    'imapflow', 'imap', 'node-imap', 'mailparser', '@doist/*', 'openai', '@anthropic-ai/*',
  ],
  message: 'Provider SDKs belong in server/src/providers/ (BUILD-PLAN.md › Boundaries the lint enforces).',
};
// ntfy is notify()'s delivery: nothing outside server/src/notify/ knows about it.
const ntfy = {
  group: ['**/ntfy', '**/ntfy.ts', '**/ntfy/**', 'ntfy*'],
  message: 'Only server/src/notify/ knows about ntfy; send through notify().',
};
// Rules stay pure: no provider adapters in server/src/domain/.
const providers = {
  group: ['**/providers', '**/providers/**'],
  message: 'Domain rules never import providers; the sync engine and commands call them.',
};
// The web app reaches the server only over HTTP, through web/src/api/.
const serverCode = {
  group: ['@setpoint/server', '@setpoint/server/**', '**/server/src/**'],
  message: 'The web app talks to the server through web/src/api/ and shares types through @setpoint/shared.',
};
const network = ['fetch', 'EventSource', 'XMLHttpRequest', 'WebSocket'].map(name => ({
  name,
  message: 'Only web/src/api/ talks to the server (BUILD-PLAN.md › Boundaries the lint enforces).',
}));
const windowNetwork = ['window', 'globalThis', 'self'].flatMap(object => network.map(({name, message}) => ({object, property: name, message})));

// The browser checks' own rules. A fixed pause says why on the line before it (SV-40): one that
// waits for something to happen should wait for it (`until`, a waiting locator), as a pause long
// enough on an idle machine is too short on a busy one; a "nothing happened" check, or a hover
// fading before a screenshot, keeps its pause and says so. A bound shorter than the 5 s default
// says why too (SV-49): "at once" is proven by holding the server's answer, not by a short limit,
// which only adds a way for a slow machine to fail. A one-shot read of a computed style or box goes
// through `rested` (nothing moving first) or polls with `until`, or says why on the line before it
// (SV-75): an element mid-entrance, mid-fade or mid-slide measures as it passes, not where it rests.
// A named function that reads is a reader, and so is one that uses a reader: each use of one is a
// read, checked where it's used. A read explained on the line before its own statement inside the
// function (at rest already, or meant to catch motion) is settled there; a doc comment on the
// function itself excuses nothing.
const SHORT_BOUND_MS = 5000;
const RESTING = new Set(['rested', 'until']);
const insideResting = node => {
  for (let at = node.parent; at; at = at.parent) if (at.type === 'CallExpression' && at.callee.type === 'Identifier' && RESTING.has(at.callee.name)) return true;
  return false;
};
const explainedOnLineBefore = (context, node) => {
  let statement = node;
  while (statement.parent && !['Program', 'BlockStatement', 'SwitchCase'].includes(statement.parent.type)) statement = statement.parent;
  const comment = context.sourceCode.getCommentsBefore(statement).at(-1);
  return comment?.loc.end.line === statement.loc.start.line - 1;
};
const isShort = node => node?.type === 'Literal' && typeof node.value === 'number' && node.value < SHORT_BOUND_MS;
const browserChecks = {
  rules: {
    'explained-pause': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {unexplained: 'Say why this pause on the line before it, or wait for what it waits for (`until`, a waiting locator) (SV-40).'},
      },
      create(context) {
        return {
          'CallExpression[callee.property.name="waitForTimeout"]'(node) {
            if (!explainedOnLineBefore(context, node)) context.report({node, messageId: 'unexplained'});
          },
        };
      },
    },
    'explained-short-bound': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {unexplained: 'A bound under 5 s says why on the line before it; to show "at once", hold the server\'s answer and use the default bound (SV-49).'},
      },
      create(context) {
        const check = (node, bound) => {
          if (isShort(bound) && !explainedOnLineBefore(context, node)) context.report({node: bound, messageId: 'unexplained'});
        };
        return {
          // until(what, read, check, timeoutMs)
          'CallExpression[callee.name="until"]'(node) { check(node, node.arguments[3]); },
          // {timeout: …} given to any call: waitFor, waitForResponse, expect's matchers, …
          'CallExpression > ObjectExpression > Property[key.name="timeout"]'(property) { check(property.parent.parent, property.value); },
        };
      },
    },
    'rested-read': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {unrested: 'Read a computed style or box through `rested` (nothing moving first) or `until`, or say why on the line before it (SV-75).'},
      },
      create(context) {
        const {sourceCode} = context;
        const reads = [];
        const isFunction = node => ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type);
        // A function's name, for one declared with one: `function fill() {}` or `const fill = () => {}`.
        const nameOf = fn => (fn.type === 'FunctionDeclaration' ? fn.id : fn.parent?.type === 'VariableDeclarator' && fn.parent.id.type === 'Identifier' ? fn.parent.id : null);
        const readerOf = node => {
          for (let at = node.parent; at; at = at.parent) if (isFunction(at) && nameOf(at)) return at;
          return null;
        };
        const report = node => {
          if (explainedOnLineBefore(context, node)) return;
          context.report({node, messageId: 'unrested'});
        };
        // Explained by a comment before a statement of the function's own body, not before the function.
        const settledIn = (read, fn) => {
          let statement = read;
          while (statement.parent && statement.parent !== fn.body && !['Program', 'BlockStatement', 'SwitchCase'].includes(statement.parent.type)) statement = statement.parent;
          return statement.parent === fn.body && explainedOnLineBefore(context, read);
        };
        return {
          'CallExpression[callee.name="getComputedStyle"]'(node) { reads.push(node); },
          'CallExpression[callee.property.name="getBoundingClientRect"]'(node) { reads.push(node); },
          'CallExpression[callee.property.name="boundingBox"]'(node) { reads.push(node); },
          // A named function that reads (`const fill = element => getComputedStyle(element)…`, passed to
          // evaluate, or one that evaluates) is a reader, and so is one that uses a reader: each use of
          // a reader is a read, checked where it's used.
          'Program:exit'() {
            const readers = new Set();
            for (const read of reads) {
              if (insideResting(read)) continue;
              const reader = readerOf(read);
              if (!reader) report(read);
              else if (!settledIn(read, reader)) readers.add(reader);
            }
            const checked = new Set();
            const queue = [...readers];
            while (queue.length) {
              const reader = queue.pop();
              if (checked.has(reader)) continue;
              checked.add(reader);
              const name = nameOf(reader).name;
              const declared = reader.type === 'FunctionDeclaration' ? reader : reader.parent;
              for (const variable of sourceCode.getDeclaredVariables(declared)) {
                if (variable.name !== name) continue;
                for (const reference of variable.references) {
                  if (reference.init || insideResting(reference.identifier)) continue;
                  const outer = readerOf(reference.identifier);
                  if (outer) queue.push(outer);
                  else report(reference.identifier);
                }
              }
            }
          },
        };
      },
    },
  },
};

// Jobs (after News) is a module that can be removed whole (D303): nothing outside its three folders
// imports them but its wiring points, the files server/src/jobs/README.md lists. Relative imports are
// resolved, so `../jobs/…` from mail is refused wherever it's written.
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const JOBS_FOLDERS = ['server/src/jobs/', 'web/src/app/jobs/', 'shared/src/jobs/'];
const JOBS_WIRING = ['server/src/server.ts', 'server/src/dev/sample.ts', 'shared/src/index.ts', 'shared/src/api/live.ts'];
const moduleBoundary = {
  rules: {
    jobs: {
      meta: {
        type: 'problem',
        schema: [],
        messages: {outside: 'Only Jobs\'s wiring points import it (server/src/jobs/README.md); mail never imports Jobs (D303).'},
      },
      create(context) {
        const check = (node, source) => {
          if (typeof source !== 'string') return;
          let target = null;
          if (source.startsWith('.')) target = path.relative(ROOT, path.resolve(path.dirname(context.filename), source)).split(path.sep).join('/');
          else if (/^@setpoint\/(server|web|shared)\//.test(source)) target = source.replace(/^@setpoint\//, '');
          if (target !== null && JOBS_FOLDERS.some(folder => `${target}/`.startsWith(folder))) context.report({node, messageId: 'outside'});
        };
        return {
          ImportDeclaration(node) { check(node, node.source.value); },
          ExportAllDeclaration(node) { check(node, node.source.value); },
          ExportNamedDeclaration(node) { if (node.source) check(node, node.source.value); },
          ImportExpression(node) { if (node.source.type === 'Literal') check(node, node.source.value); },
        };
      },
    },
  },
};

export default tseslint.config(
  {ignores: ['**/node_modules/', '**/dist/', '**/data/', 'server/drizzle/meta/', 'design-export/', 'reviews/', '.claude/', 'shared/compose/compose.js']},
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {argsIgnorePattern: '^_', ignoreRestSiblings: true}],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['server/**', 'shared/**', '*.js', '*.ts', 'web/*.ts', 'web/tests/**'],
    languageOptions: {globals: globals.node},
  },
  {
    files: ['web/src/**/*.{ts,tsx}'],
    plugins: {'react-hooks': reactHooks},
    rules: reactHooks.configs.recommended.rules,
    languageOptions: {globals: globals.browser},
  },

  // Boundaries. ESLint replaces a rule's options per matching block rather than merging them, so
  // each block lists every pattern that applies to its files.
  {
    files: ['server/src/**/*.ts'],
    ignores: ['server/src/providers/**', 'server/src/notify/**', 'server/src/domain/**'],
    rules: {'no-restricted-imports': ['error', {patterns: [providerSdks, ntfy]}]},
  },
  {
    files: ['server/src/notify/**/*.ts'],
    rules: {'no-restricted-imports': ['error', {patterns: [providerSdks]}]},
  },
  {
    files: ['server/src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {patterns: [providerSdks, ntfy, providers]}],
      'no-restricted-globals': ['error', ...network.map(({name}) => ({name, message: 'Domain rules are pure: no network.'}))],
    },
  },
  {
    files: ['web/src/**/*.{ts,tsx}'],
    ignores: ['web/src/api/**'],
    rules: {
      'no-restricted-globals': ['error', ...network],
      'no-restricted-properties': ['error', ...windowNetwork],
      'no-restricted-imports': ['error', {patterns: [serverCode]}],
    },
  },
  {
    files: ['web/src/api/**/*.{ts,tsx}'],
    rules: {'no-restricted-imports': ['error', {patterns: [serverCode]}]},
  },
  {
    files: ['**/*.{js,ts,tsx}'],
    ignores: [...JOBS_FOLDERS.map(folder => `${folder}**`), ...JOBS_WIRING],
    plugins: {'module-boundary': moduleBoundary},
    rules: {'module-boundary/jobs': 'error'},
  },
  {
    files: ['web/tests/browser/**/*.ts'],
    plugins: {'browser-checks': browserChecks},
    rules: {'browser-checks/explained-pause': 'error', 'browser-checks/explained-short-bound': 'error', 'browser-checks/rested-read': 'error'},
  },
);
