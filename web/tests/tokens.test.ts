// tokens.ts mirrors design-export/styles/setpoint.css (the source of truth for values) and
// DESIGN.md's Tokens tables. This parses both and compares. DESIGN.md wins over the export, and
// every place it does is listed in OVERRIDES below; any other difference fails.
import {readFileSync} from 'node:fs';
import {COLOURS} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {
  accountColour, base, calendarColour, colour, cssVariables, evhover, evtint, glide, glyphColour, layout, lightColour, mix, motion, week,
  placement, radius, themeVariables, tintL, type, type Theme, viewport, attTint,
} from '../src/tokens.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../../design-export/styles/setpoint.css');
const design = read('../../DESIGN.md');
const glideJson = JSON.parse(read('../../design-export/motion/glide.json')) as {
  glide: {
    position: {easing: string; duration: {baseMs: number; perPx: string; capMs: number; examples: Record<string, number>}};
    height: {durationMs: number; easing: string};
    oldContent: {fadeOut: string};
    newContent: {fadeIn: string; slidePx: number};
    selection: {newItem: string; oldItem: string};
    edges: string;
  };
  placement: {rule: string; gapPx: number; cardWidthPx: number};
  open: {durationMs: number; scale: [number, number]};
  close: {durationMs: number; scale: [number, number]};
  edit: {durationMs: number; editorSlidePx: number};
  tokens: {durS: number; durM: number; durL: number; ease: string};
};

/**
 * DESIGN.md › Overrides to the export, where they touch a token. `exported` is what setpoint.css
 * says, so a fixed export makes its entry fail until it's removed here.
 */
const OVERRIDES: {theme: Theme; variable: string; exported: string; ours: string; why: string}[] = [
  {theme: 'light', variable: '--page', exported: '#f8f8f6', ours: '#f6f6f4', why: 'Override 5: Light page is #f6f6f4, as darma\'s'},
  {theme: 'night', variable: '--ink3', exported: '#707277', ours: '#7d7f84', why: 'Override 29: Night ink3 reads on cursor rows and in menus'},
  {theme: 'light', variable: '--ink2', exported: '#56585d', ours: '#4b4d52', why: 'Override 29: Light ink2 steps clear of ink3'},
  {theme: 'night', variable: '--panel', exported: '#08090a', ours: '#0b0c0e', why: 'Override 29: Night panel reads as a layer'},
  {theme: 'light', variable: '--cardOn', exported: '#f4f4f2', ours: '#ffffff', why: 'Override 29: Light cardOn floats, white'},
  {theme: 'light', variable: '--evtint', exported: '12%', ours: '14%', why: 'Override 29: Light chips\' tint shows on the grid'},
  {theme: 'night', variable: '--cyan', exported: 'oklch(0.8 0.11 195)', ours: 'oklch(0.86 0.11 182)', why: 'Override 29: Classes\' cyan moves away from Personal\'s cool'},
  {theme: 'light', variable: '--cyan', exported: 'oklch(0.54 0.09 195)', ours: 'oklch(0.58 0.1 182)', why: 'Override 29: Classes\' cyan moves away from Personal\'s cool'},
];
/** Override 4: the done glyph is `good`; the export's `.ring.done` fills with `--comf`. */
const DONE_GLYPH = {exported: 'comf', ours: 'good'};

/** Theme variables tokens.ts adds that the export doesn't define (the polish audit's, DESIGN.md #120–#149, and the scrollbar's). */
const NOT_IN_EXPORT = ['--sub4', '--accent', '--navOn', '--navOnEdge', '--dayOff', '--dayOut', '--evhover', '--scrollbar-thumb', '--tintL', '--attTint'];

const squash = (value: string) => value.replace(/\s+/g, ' ').replace(/\s*([{}:;(),])\s*/g, '$1').trim();

/** The custom properties declared directly in a rule whose selector is exactly `selector`. */
function declarations(selector: string): Record<string, string> {
  const rule = new RegExp(`(?:^|\\n)${selector.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`).exec(css);
  expect(rule, selector).not.toBeNull();
  const body = rule![1]!.replace(/\/\*[\s\S]*?\*\//g, '');
  return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name!, squash(value!)]));
}

const exported: Record<Theme, Record<string, string>> = {
  night: declarations('.sp'),
  light: {...declarations('.sp'), ...declarations('.sp.light')},
};
const ours = (theme: Theme) => ({...cssVariables(), ...themeVariables(theme)});

describe('tokens.ts against setpoint.css', () => {
  for (const theme of ['night', 'light'] as const) {
    test(`${theme}: every custom property the export defines has the same value, overrides aside`, () => {
      const mine = ours(theme);
      const expected = {...exported[theme]};
      for (const override of OVERRIDES.filter(entry => entry.theme === theme)) {
        expect(expected[override.variable], `${override.variable} in the export (${override.why})`).toBe(override.exported);
        expected[override.variable] = override.ours;
      }
      const actual = Object.fromEntries(Object.keys(expected).map(name => [name, mine[name] === undefined ? undefined : squash(mine[name]!)]));
      expect(actual).toEqual(expected);
    });

    test(`${theme}: tokens.ts adds no theme variable the export lacks, except those named`, () => {
      const extra = Object.keys(themeVariables(theme)).filter(name => !(name in exported[theme]));
      expect(extra).toEqual(NOT_IN_EXPORT);
    });
  }

  test('the export defines the same variables for both themes', () => {
    expect(Object.keys(exported.light).sort()).toEqual(Object.keys(exported.night).sort());
    expect(Object.keys(themeVariables('light'))).toEqual(Object.keys(themeVariables('night')));
  });

  test('the done glyph is good, where the export says comf (override 4)', () => {
    const rule = /\.sp \.ring\.done,[^{]*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(/background:\s*var\(--(\w+)\)/.exec(rule![1]!)?.[1]).toBe(DONE_GLYPH.exported);
    expect(glyphColour.taskDone).toBe(DONE_GLYPH.ours);
  });

  test('the tag, reconnect bar and highlight mixes match the export', () => {
    const flat = squash(css);
    for (const {colour: c, fill, on, ...rest} of Object.values(mix)) {
      expect(flat).toContain(`color-mix(in oklch,var(--${c})${fill}%,${on === 'transparent' ? 'transparent' : `var(--${on})`})`);
      if ('edge' in rest) expect(flat).toContain(`color-mix(in oklch,var(--${c})${rest.edge}%,transparent)`);
    }
  });

  test('glyph colours on the grid match the export', () => {
    const flat = squash(css);
    expect(flat).toContain(`.sp .wx.sun{color:var(--${glyphColour.sun});}`);
    expect(flat).toContain(`.sp .wx.cloud{color:var(--${glyphColour.cloud});}`);
    expect(flat).toContain(`.sp .wx.rain{color:var(--${glyphColour.rain});}`);
    expect(flat).toContain(`border:1.5px solid var(--${glyphColour.taskOpen})`);
    expect(flat).toContain(`.sp .tk .ring{width:12px;height:12px;border-color:var(--${glyphColour.taskOpenOnGrid});`);
  });

  test('the shell\'s sizes match the export', () => {
    const flat = squash(css);
    expect(flat).toContain(`grid-template-columns:${layout.sidebar}px minmax(0,1fr)`);
    expect(flat).toContain(`.sp .hd{height:${layout.header}px;`);
    expect(flat).toContain(`.sp .pane{width:${layout.readingPane}px;`);
    expect(flat).toContain(`.sp .rpane{width:${layout.rightPane}px;`);
    expect(flat).toContain(`.sp .row{display:flex;align-items:center;gap:10px;height:${layout.row}px;`);
    expect(flat).toContain(`.sp .gh{height:${layout.groupHeader}px;`);
    expect(flat).toContain(`.sp .nav{height:${layout.sidebarItem}px;`);
    expect(flat).toContain(`.sp .search{width:${layout.mailSearch}px;height:${layout.search}px;`);
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

const minus = (value: string) => value.replace('-', '−');

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
    for (const swatch of [...Object.values(accountColour), ...Object.values(calendarColour), ...Object.values(glyphColour)]) {
      expect(COLOURS).toContain(swatch);
    }
  });

  test('mixes and tints match the Colour notes', () => {
    const flat = design.replace(/\n\s*/g, ' ');
    expect(flat).toContain(`tags (\`alert\` ${mix.tagAlert.fill}% on \`chip\` with a ${mix.tagAlert.edge}% edge; \`caution\` ${mix.tagCaution.fill}% with a ${mix.tagCaution.edge}% edge)`);
    expect(flat).toContain(`the needs-reconnect bar (\`caution\` ${mix.reconnectBar.fill}% on \`page\`, ${mix.reconnectBar.edge}% bottom edge)`);
    expect(flat).toContain(`calendar tint \`--evtint\` (Night ${evtint.night}%, Light ${evtint.light}%)`);
    expect(flat).toContain(`deepening under the pointer by \`--evhover\` (Night ${evhover.night}%, Light ${evhover.light}%)`);
    expect(flat).toContain(`coloured text on its own tint caps its lightness at \`--tintL\` (Night ${tintL.night}, Light ${String(tintL.light).replace(/^0/, '')})`);
    expect(flat).toContain(`Attention's band (\`caution\` ${attTint.night}% on \`panel\` in srgb, Light ${attTint.light}%)`);
    expect(flat).toContain(`search highlight (${mix.searchHighlight.fill}% mix)`);
  });

  test('type roles match the Type table', () => {
    const rows = Object.fromEntries(table('### Type'));
    expect(design).toContain(`Base **${base.size} / ${base.lineHeight}**`);
    expect(rows['Reader subject']).toBe(`${type.readerSubject.size} / ${type.readerSubject.weight} / ${minus(type.readerSubject.tracking)}, line height ${type.readerSubject.lineHeight}`);
    expect(rows['Header title']).toBe(`${type.headerTitle.size} / ${type.headerTitle.weight} / ${minus(type.headerTitle.tracking)}`);
    expect(rows['Setpoint\'s name']).toBe(`${type.name.size} / ${type.name.weight} / ${minus(type.name.tracking)}`);
    expect(rows['Email body (plain text)']).toBe(`${type.emailBody.size}, line height ${type.emailBody.lineHeight}, max ${type.emailBody.maxWidth} px`);
    expect(rows['Rows, nav, menus, buttons, facts']).toBe(`${type.row.size} (unread sender and subject ${type.row.unreadWeight})`);
    expect(rows['Segmented control, reader tools, small buttons, summaries in Attention']).toBe(`${type.control.size}`);
    expect(rows['Ages, counts, account labels, calendar chips']).toBe(`${type.small.size} (chips ${type.small.chipWeight})`);
    expect(rows['Group headers, section labels, weekday names']).toBe(`${type.label.size} / uppercase / ${type.label.tracking}`);
    expect(rows['Keyboard hints']).toBe(`${type.hint.size} / ${type.hint.weight}`);
    expect(rows['Verification codes']).toBe(`Geist Mono ${type.code.size} / ${type.code.weight} / ${type.code.tracking}`);
  });

  test('radii match the Shape table, in order', () => {
    expect(table('### Shape').map(([value]) => Number(value))).toEqual(Object.values(radius));
  });

  test('motion matches the Motion section', () => {
    const flat = design.replace(/\n\s*/g, ' ');
    expect(flat).toContain(`**${motion.fast} ms** hover and fills, **${motion.medium} ms** popovers and panes, **${motion.slow} ms** modals, all \`${motion.ease}\``);
    expect(flat).toContain(`A lifted calendar chip tilts ${minus(String(motion.liftTilt))}° and scales ${motion.liftScale}.`);
    expect(flat).toContain(`Theme switches fade every colour over ${motion.themeFade} ms`);
    expect(flat).toContain(`A press goes in over **${motion.press} ms** and lets go over ${motion.fast} ms`);
  });

  test('the layout constants match DESIGN.md', () => {
    const flat = design.replace(/\n\s*/g, ' ');
    expect(flat).toContain(`**Sidebar** ${layout.sidebar} px`);
    expect(flat).toContain(`the sidebar is a ${layout.rail} px rail`);
    expect(flat).toContain(`### Compact (${viewport.phoneBelow} to ${viewport.compactBelow - 1} px)`);
    expect(flat).toContain(`**Header** ${layout.header} px`);
    expect(flat).toContain(`the **reading pane** ${layout.readingPane} px, Calendar's **right pane** ${layout.rightPane} px`);
    expect(flat).toContain(`**Card:** ${layout.floatingDetail} px wide`);
    expect(flat).toContain(`**Columns** ${layout.monthColumn} px at the design target, **rows** ${layout.monthRow}`);
    expect(flat).toContain(`A **${layout.settingsWidth} × ${layout.settingsHeight} modal**`);
    expect(flat).toContain(`**${layout.settingsNav} px nav**`);
    expect(flat).toContain(`**Placement:** ${placement.gapPx} px off its item, on the side (right, left, above, below; right first)`);
  });

  test('the week view\'s constants match DESIGN.md › Week view', () => {
    const flat = design.replace(/\n\s*/g, ' ');
    expect(flat).toContain(`a ${week.gutterPx} px gutter`);
    expect(flat).toContain(`The **day heads** (${week.headPx} px)`);
    expect(flat).toContain(`${week.linePx} px lines ${week.lineGapPx} px apart, at least two lines and at most three`);
    expect(flat).toContain(`**Hours:** all 24, ${week.hourPx} px each`);
    expect(flat).toContain(`in ${week.snapMinutes}-minute steps`);
    expect(flat).toContain(`never under ${week.minMinutes} minutes`);
    expect(flat).toContain(`under ${week.shortMinutes} minutes`);
    expect(flat).toContain(`up to three equal lanes`);
    expect(week.lanes).toBe(3);
    expect(flat).toContain(`the grid slides ${week.pageSlidePx} px and fades over ${week.pageMs} ms`);
    expect(flat).toContain(`blocks fade in (${week.fadeMs} ms)`);
  });
});

describe('the glide against motion/glide.json', () => {
  const g = glideJson.glide;
  const duration = (px: number) => Math.round(Math.min(glide.capMs, glide.baseMs + glide.perStepMs * px / glide.stepPx));

  test('position: curve and duration', () => {
    expect(squash(g.position.easing)).toBe(glide.easing);
    expect(g.position.duration.baseMs).toBe(glide.baseMs);
    expect(g.position.duration.capMs).toBe(glide.capMs);
    expect(g.position.duration.perPx).toBe(`${glide.perStepMs} ms per ${glide.stepPx} px of travel`);
    for (const [px, ms] of Object.entries(g.position.duration.examples)) expect(duration(parseInt(px)), px).toBe(ms);
    expect(duration(454)).toBe(325);
  });

  test('height, content, selection, open, close and edit', () => {
    expect(g.height.durationMs).toBe(glide.heightMs);
    expect(squash(g.height.easing)).toBe(motion.ease);
    // Override 30: the contents crossfade with a 50 ms overlap, where glide.json leaves a gap at 90 ms.
    expect(g.oldContent.fadeOut).toBe('0–90 ms');
    expect(g.newContent.fadeIn).toMatch(/^90–220 ms/);
    expect([glide.oldContentOutMs, glide.newContentInFromMs, glide.newContentInToMs]).toEqual([120, 70, 220]);
    expect(design.replace(/\n\s*/g, ' ')).toContain(`**The glide's contents crossfade**: old content fades out 0–${glide.oldContentOutMs} ms and new content in ${glide.newContentInFromMs}–${glide.newContentInToMs} ms`);
    expect(g.newContent.slidePx).toBe(glide.newContentSlidePx);
    expect(g.selection.newItem).toContain(`at ${glide.selectionSolidAtMs} ms`);
    expect(g.selection.oldItem).toContain(`at ${glide.selectionOldAtMs} ms`);
    expect([glideJson.open.durationMs, glideJson.open.scale[0]]).toEqual([glide.openMs, glide.openScale]);
    expect([glideJson.close.durationMs, glideJson.close.scale[1]]).toEqual([glide.closeMs, glide.closeScale]);
    expect([glideJson.edit.durationMs, glideJson.edit.editorSlidePx]).toEqual([glide.editMs, glide.editorSlidePx]);
    expect([glideJson.placement.gapPx, glideJson.placement.cardWidthPx]).toEqual([placement.gapPx, layout.floatingDetail]);
    expect(glideJson.placement.rule).toContain(placement.sides.join(', '));
    expect([glideJson.tokens.durS, glideJson.tokens.durM, glideJson.tokens.durL, squash(glideJson.tokens.ease)])
      .toEqual([motion.fast, motion.medium, motion.slow, motion.ease]);
  });

  test('the overshoot clamps at the grid\'s edges, where glide.json says it may cross (override 1)', () => {
    expect(g.edges).toMatch(/may pass the month's edge/);
    expect(glide.clampOvershootAtEdges).toBe(true);
    expect(design).toContain('**The overshoot clamps at the grid\'s edges** (decision 47)');
  });
});
