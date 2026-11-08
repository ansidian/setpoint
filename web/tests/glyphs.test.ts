// The bundled glyphs are the export's, generated and current, and nothing loads from the network.
import {readFileSync} from 'node:fs';
import {expect, test} from 'vitest';
import {OUTPUT, renderGlyphs} from '../generateGlyphs.ts';

test('src/ui/glyphs.ts is current with design-export/glyphs/ (run `npm run glyphs`)', () => {
  expect(readFileSync(OUTPUT, 'utf8')).toBe(renderGlyphs());
});

test('the sources load nothing from the network', () => {
  const sources = ['../src/main.tsx', '../src/styles.css', '../index.html', '../src/ui/glyphs.ts'].map(path => readFileSync(new URL(path, import.meta.url), 'utf8'));
  for (const source of sources) expect(source).not.toMatch(/https?:\/\//);
});
