// tokens.ts against DESIGN.md's Colour and Shape tables and its accounts and calendars, and the
// shell's sizes against design-export/styles/setpoint.css.
import {readFileSync} from 'node:fs';
import {COLOURS} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {accountColour, calendarColour, colour, layout, lightColour, radius} from '../src/tokens.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../../design-export/styles/setpoint.css');
const design = read('../../DESIGN.md');

const squash = (value: string) => value.replace(/\s+/g, ' ').replace(/\s*([{}:;(),])\s*/g, '$1').trim();

describe('tokens.ts against setpoint.css', () => {
  test('the shell\'s sizes match the export', () => {
    const flat = squash(css);
    expect(flat).toContain(`grid-template-columns:${layout.sidebar}px minmax(0,1fr)`);
    expect(flat).toContain(`.sp .hd{height:${layout.header}px;`);
    expect(flat).toContain(`.sp .pane{width:${layout.readingPane}px;`);
    expect(flat).toContain(`.sp .rpane{width:${layout.rightPane}px;`);
  });
});

/** Rows of the first Markdown table at or after a heading. */
function table(heading: string): string[][] {
  const start = design.indexOf(heading);
  expect(start, heading).toBeGreaterThan(-1);
  const lines = design.slice(start).split('\n').map(line => line.trim());
  const first = lines.findIndex(line => line.startsWith('|'));
  const rows = [];
  for (const line of lines.slice(first + 2)) {
    if (!line.startsWith('|')) break;
    rows.push(line.split('|').slice(1, -1).map(cell => cell.trim()));
  }
  return rows;
}

/** "`a` / `b`" → ['a', 'b']; ".12" after an rgba() means that rgba with alpha .12. */
function cells(cell: string): string[] {
  const parts = cell.split(' / ').map(part => part.trim().replace(/^`|`$/g, ''));
  return parts.map(part => part.startsWith('.') ? parts[0]!.replace(/,[^,]*\)$/, `,${part})`) : part);
}

describe('tokens.ts against DESIGN.md', () => {
  test('every row of the Colour table has the same Night and Light values', () => {
    const rows = table('### Colour');
    const night: Record<string, string> = {};
    const light: Record<string, string> = {};
    for (const [names, n, l] of rows) {
      const keys = cells(names!);
      cells(n!).forEach((value, at) => night[keys[at]!] = value);
      cells(l!).forEach((value, at) => light[keys[at]!] = value);
    }
    expect(Object.keys(night).length).toBeGreaterThan(25);
    for (const [name, value] of Object.entries(night)) expect(colour[name as keyof typeof colour], name).toBe(value);
    for (const [name, value] of Object.entries(light)) expect(lightColour[name as keyof typeof lightColour], name).toBe(value);
  });

  test('accounts and calendars take the colours DESIGN.md names, from the shared swatches', () => {
    const flat = design.replace(/\n\s*/g, ' ');
    expect(flat).toContain(`**Accounts** (\`--a-*\`): Business \`${accountColour.business}\`, Personal \`${accountColour.personal}\`, Work \`${accountColour.work}\`, Jobs \`${accountColour.jobs}\`, iCloud \`${accountColour.icloud}\`.`);
    expect(flat).toContain(`**Calendars** (\`--c-*\`): Personal \`${calendarColour.personal}\`, Classes \`${calendarColour.classes}\`, Jobs \`${calendarColour.jobs}\`.`);
    for (const swatch of [...Object.values(accountColour), ...Object.values(calendarColour)]) {
      expect(COLOURS).toContain(swatch);
    }
  });

  test('radii match the Shape table, in order', () => {
    expect(table('### Shape').map(([value]) => Number(value))).toEqual(Object.values(radius));
  });
});
