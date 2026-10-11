// The bundled glyphs are the export's: generated, current, and covering every icon the boards use.
import {readFileSync} from 'node:fs';
import {expect, test} from 'vitest';
import {OUTPUT, renderGlyphs} from '../generateGlyphs.ts';
import {ICONS} from '../src/ui/glyphs.ts';

test('src/ui/glyphs.ts is current with design-export/glyphs/ (run `npm run glyphs`)', () => {
  expect(readFileSync(OUTPUT, 'utf8')).toBe(renderGlyphs());
});

test('every icon the boards use is bundled', () => {
  const used = readFileSync(new URL('../../design-export/glyphs/material-symbols-used.txt', import.meta.url), 'utf8')
    .split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  expect(used.length).toBeGreaterThan(70);
  expect(used.filter(name => !(name in ICONS))).toEqual([]);
});

test('the sources load nothing from the network', () => {
  const sources = ['../src/main.tsx', '../src/styles.css', '../index.html', '../src/ui/glyphs.ts'].map(path => readFileSync(new URL(path, import.meta.url), 'utf8'));
  for (const source of sources) expect(source).not.toMatch(/https?:\/\//);
});
