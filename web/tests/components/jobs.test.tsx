// Jobs's widgets (J5, J6; DESIGN.md › Jobs): Per week's chart, the status filter and the full posting
// unfolding in place (board 33); J6's menus with their keys and submenus, the candidate picker and the
// title's field (boards 34a, 35a, 35b); J7's JD chip with its popover and Applied before, as mail's
// slots draw them (boards 37a–37c); and J8's words, as tables: the history pass's and the AI down's
// lines (38a, 38b), Settings › Jobs's (39a) and Usage this month's Jobs row (39b); a JD's long facts
// wrapping in their boxes (SV-129); the area that takes a pasted posting and a candidate Jobs can't
// read (SV-140); an item's subject, which opens its email (D401); Setpoint on LinkedIn's chip saying an
// application's standing as mail does (SV-174); the empty pane's rows of recent movement and their words,
// and a row's menu condensed for them (SV-220, D470). What they do with the props and the pointer or keys they're
// given; the page around them, its keys and the server are jobs.spec.ts's and jobsStates.spec.ts's.
// This file imports Jobs's folder, so it's one of Jobs's wiring points (server/src/jobs/README.md).
import type {
  ApplicationOut, ApplicationRowOut, JdCandidateOut, JobMoveOut, JobCountsOut, JobsHistoryOut, JobsMailApplicationOut, JobsMailMessageOut, JobsReadingOut, JobStatus, JobWeekOut, NeedsYouItemOut, PostingOut,
} from '@setpoint/shared';
import {MAX_PASTED_CHARS, PASTED_TOO_LONG} from '@setpoint/shared';
import {createRef, useRef, useState} from 'react';
import {describe, expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {ApiFailure} from '../../src/api/client.ts';
import '../../src/app/jobs/jobs.css';
import {CandidatePicker} from '../../src/app/jobs/CandidatePicker.tsx';
import {JdFacts} from '../../src/app/jobs/Detail.tsx';
import {EditField} from '../../src/app/jobs/EditField.tsx';
import {PastePosting} from '../../src/app/jobs/PastePosting.tsx';
import {FullPosting} from '../../src/app/jobs/FullPosting.tsx';
import {AppliedBefore, JdChip} from '../../src/app/jobs/InMail.tsx';
import {readsWith} from '../../src/app/jobs/JobsSettings.tsx';
import {JobsMenu} from '../../src/app/jobs/Menu.tsx';
import type {MenuSpec} from '../../src/app/jobs/Menu.tsx';
import {chooseMenu, rowMenu} from '../../src/app/jobs/menus.ts';
import {MoveRow} from '../../src/app/jobs/JobsDay.tsx';
import type {FullPostingHandle} from '../../src/app/jobs/FullPosting.tsx';
import {NeedsYou} from '../../src/app/jobs/NeedsYou.tsx';
import {PerWeek} from '../../src/app/jobs/PerWeek.tsx';
import {StatusFilter} from '../../src/app/jobs/StatusFilter.tsx';
import type {Filter} from '../../src/app/jobs/words.ts';
import {moveDay, movementFoot, moveSide} from '../../src/app/jobs/words.ts';
import {shelfAndTable} from '../../src/app/jobs/words.ts';
import type {Sort} from '../../src/app/jobs/words.ts';
import {appliedStanding, foundBy, foundShort, fromHistorySetting, hasReading, historyLine, historySetting, historyShare, jdCell, pickWords, readingLine, recedes} from '../../src/app/jobs/words.ts';
import {appliedStanding as chipStanding, closes as chipCloses} from '../../../extension/src/words.ts';
import {colour} from './colour.ts';
import {contrastOf, still} from './contrast.ts';
import {applyTheme} from '../../src/tokens.ts';

const ZONE = 'America/Los_Angeles';
const TODAY = '2026-10-07';

// The seed's 12 weeks (D318): 3 5 4 6 2 4 7 5 3 6 8, and 3 so far this week; one emptied to show its stub.
const COUNTS = [3, 5, 4, 6, 0, 4, 7, 5, 3, 6, 8, 3];
const WEEKS: JobWeekOut[] = COUNTS.map((count, index) => {
  const start = new Date(Date.parse('2026-07-19T12:00:00Z') + index * 7 * 86_400_000).toISOString().slice(0, 10);
  const end = new Date(Date.parse(`${start}T12:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
  return {start, end, count, current: index === COUNTS.length - 1};
});

const bars = () => [...document.querySelectorAll<HTMLElement>('.jb-week .bars > i')];
const heightOf = (bar: HTMLElement) => bar.getBoundingClientRect().height;

test('Per week: twelve bars oldest first, the busiest tallest, a week with none a stub, this week an outline, then its count', async () => {
  await render(<PerWeek weeks={WEEKS} today={TODAY} />);
  await expect.element(page.getByRole('img', {name: /Applications per week, the last 12/})).toHaveTextContent('Per week3 this week');
  const all = bars();
  expect(all).toHaveLength(12);
  const heights = all.map(heightOf);
  // The busiest week (Sep 27 – Oct 3, 8) is the tallest, and the rest in proportion.
  expect(heights.indexOf(Math.max(...heights))).toBe(10);
  expect(heights[3]! / heights[10]!).toBeCloseTo(6 / 8, 1);
  // The empty week is shorter than any week with applications.
  expect(heights[4]).toBeLessThan(Math.min(...heights.filter((_, index) => index !== 4)));
  // This week's isn't over: an outline, not a fill.
  const now = getComputedStyle(all[11]!);
  expect(now.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(now.boxShadow).toContain(colour('var(--ink3)'));
  expect(getComputedStyle(all[10]!).backgroundColor).toBe(colour('var(--ink3)'));
});

test('a bar under the pointer turns ink and names its week in a tip; it has no press', async () => {
  await render(<PerWeek weeks={WEEKS} today={TODAY} />);
  const busiest = bars()[10]!;
  await userEvent.hover(busiest);
  await expect.element(page.getByRole('tooltip')).toHaveTextContent('Sep 27 – Oct 3 · 8 applications');
  await expect.poll(() => getComputedStyle(busiest).backgroundColor).toBe(colour('var(--ink)'));
  await userEvent.hover(bars()[4]!);
  await expect.element(page.getByRole('tooltip')).toHaveTextContent('Aug 16 – Aug 22 · 0 applications');
  // Information only: nothing on the chart is a control.
  expect(document.querySelectorAll('.jb-week button, .jb-week a, .jb-week [tabindex]')).toHaveLength(0);
  await userEvent.unhover(bars()[4]!);
  await expect.element(page.getByRole('tooltip')).not.toBeInTheDocument();
});

const COUNTS_OUT: JobCountsOut = {all: 62, ghosted: 18, by_status: {applied: 31, in_process: 3, offer: 1, rejected: 25, withdrawn: 2}};

function Filtered({onChange}: {onChange: (filter: Filter) => void}) {
  const [value, setValue] = useState<Filter>('all');
  return <StatusFilter counts={COUNTS_OUT} value={value} onChange={next => {
    setValue(next);
    onChange(next);
  }} />;
}

test('the status filter holds the counts by status, so a count is also the filter; the one on reads its count in ink2', async () => {
  const onChange = vi.fn();
  await render(<Filtered onChange={onChange} />);
  const segments = page.getByRole('group', {name: 'Status'}).getByRole('button');
  expect(segments.all().map(segment => segment.element().textContent)).toEqual(['All62', 'Applied31', 'In process3', 'Offer1', 'Rejected25', 'Withdrawn2']);
  await expect.element(page.getByRole('button', {name: 'All 62'})).toHaveAttribute('aria-pressed', 'true');
  const count = (name: string) => getComputedStyle(page.getByRole('button', {name}).element().querySelector('.n')!).color;
  await expect.poll(() => count('All 62')).toBe(colour('var(--ink2)'));
  expect(count('In process 3')).toBe(colour('var(--ink3)'));

  await page.getByRole('button', {name: 'In process 3'}).click();
  await expect.element(page.getByRole('button', {name: 'In process 3'})).toHaveAttribute('aria-pressed', 'true');
  await expect.element(page.getByRole('button', {name: 'All 62'})).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => count('In process 3')).toBe(colour('var(--ink2)'));
  expect(onChange.mock.calls).toEqual([['in_process']]);
  // A segment never wraps: each stays one line.
  for (const segment of segments.all()) expect(segment.element().getBoundingClientRect().height).toBeLessThan(30);
});

const POSTING: PostingOut = {
  summary: 'A new-grad engineer for the hiring-platform team.', location: 'Irvine, CA', location_set_at: null, workplace: 'hybrid', workplace_detail: '3 days', salary: '$95,000–$115,000',
  must_haves: ['TypeScript and React'], nice_to_haves: ['Tests in CI'],
  full_text: '## About the team\n\nNorthwind Talent builds hiring software\nfor mid-sized companies.\n\n## What you\'ll do\n\n- Build features end to end\n- Write the tests that run in CI',
  link: 'https://greenhouse.example/northwindtalent/jobs/4471029', source: 'platform', platform: 'Greenhouse', found_at: '2026-10-01T17:41:00.000Z',
};

/** The posting in a pane that scrolls, under a tall summary, as the detail has it. */
async function posting() {
  const handle = createRef<FullPostingHandle>();
  await render(
    <div className="rd-scroll" style={{height: 400, overflowY: 'auto'}}>
      <div style={{height: 600, flex: 'none'}}>What they want, the facts and the lists</div>
      <FullPosting ref={handle} posting={POSTING} title="Software Engineer I" company="Northwind Talent" timeZone={ZONE} today={TODAY} />
      <div style={{height: 800, flex: 'none'}}>The timeline</div>
    </div>,
  );
  const scroller = document.querySelector<HTMLElement>('.rd-scroll')!;
  return {handle, scroller};
}

test('the full posting is a row: how it was found, the link\'s host, and Show; Show unfolds the text in place under a sticky head, the pane scrolling it up', async () => {
  const {scroller} = await posting();
  const row = page.getByRole('group', {name: 'Full posting'});
  await expect.element(row).toHaveTextContent('Full postingFound on Greenhouse · Oct 1, 10:41 AMgreenhouse.exampleShow');
  await expect.element(row.getByRole('link', {name: 'greenhouse.example'})).toHaveAttribute('href', POSTING.link);
  await row.getByRole('button', {name: 'Show'}).click();

  await expect.element(page.getByRole('button', {name: 'Collapse'})).toHaveAttribute('aria-expanded', 'true');
  await expect.element(page.getByText('Software Engineer I · Northwind Talent', {exact: true})).toBeInTheDocument();
  await expect.element(page.getByText('Kept as it was on Oct 1')).toBeInTheDocument();
  await expect.element(page.getByRole('link', {name: 'greenhouse.example/northwindtalent/jobs/4471029'})).toBeInTheDocument();
  // The posting's own words, its markdown as headings, paragraphs and lists.
  expect([...document.querySelectorAll('.jb-full > *')].map(block => `${block.tagName}: ${block.textContent}`)).toEqual([
    'H3: About the team', 'P: Northwind Talent builds hiring software for mid-sized companies.', 'H3: What you\'ll do', 'UL: Build features end to endWrite the tests that run in CI',
  ]);
  // The pane brings the head up to its top as the text unfolds.
  const head = () => document.querySelector('.jb-fullhead')!.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  await expect.poll(head).toBeLessThan(1);
  expect(scroller.scrollTop).toBeGreaterThan(500);
});

test('Collapse folds it back to its row and the pane back to where it was; Space on the row unfolds it, and Esc (the page asks the handle) folds it', async () => {
  const {handle, scroller} = await posting();
  // The row in view near the pane's foot, where it was before it unfolded.
  document.querySelector('.jb-src')!.scrollIntoView({block: 'end'});
  const where = scroller.scrollTop;
  await page.getByRole('button', {name: 'Show'}).click();
  await expect.poll(() => scroller.scrollTop).toBeGreaterThan(where + 100);
  await page.getByRole('button', {name: 'Collapse'}).click();
  await expect.element(page.getByRole('group', {name: 'Full posting'})).toBeInTheDocument();
  await expect.poll(() => Math.round(scroller.scrollTop)).toBe(Math.round(where));
  expect(document.querySelector('.jb-full')).toBeNull();

  // Folded, Esc is the page's own.
  expect(handle.current!.escape()).toBe(false);
  (document.querySelector('.jb-src') as HTMLElement).focus();
  await userEvent.keyboard(' ');
  await expect.element(page.getByRole('button', {name: 'Collapse'})).toBeInTheDocument();
  expect(handle.current!.escape()).toBe(true);
  await expect.element(page.getByRole('group', {name: 'Full posting'})).toBeInTheDocument();
});

// ---- J6's menus (34a, 35a, 35b): ↑ ↓, Enter, Esc, and submenus ----

/** A button that opens `spec` under it, as Assign to… and More do, with what reaches the page past it. */
function Opener({spec, onKey}: {spec: MenuSpec; onKey: (key: string) => void}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <div onKeyDown={event => onKey(event.key)} style={{paddingLeft: 700}}>
      <button ref={button} type="button" onClick={() => setOpen(!open)}>Assign to…</button>
      {open && <JobsMenu spec={spec} anchor={{element: button.current!, corner: 'left'}} onClose={() => setOpen(false)} />}
    </div>
  );
}

const cursorOf = () => document.querySelector('.jb-menu:last-of-type .menu-i.cur')?.textContent ?? null;

function menuSpec(run: (what: string) => void): MenuSpec {
  const item = (id: string, label: string, more: object = {}) => ({kind: 'item' as const, id, label, icon: 'work' as const, run: () => run(label), ...more});
  return {
    label: 'Assign to', width: 312,
    entries: [
      {kind: 'label', label: 'Humongous Insurance'},
      item('claims', 'Software Engineer II, Claims', {sub: 'Applied Sep 30 · Applied'}),
      item('java', 'Software Engineer II (Java)', {sub: 'Applied Sep 28 · Applied'}),
      item('closed', 'Claims Analyst', {disabled: true}),
      {kind: 'sep'},
      {kind: 'item', id: 'another', icon: 'search', label: 'Another application…', submenu: () => ({
        label: 'Another application', width: 330, entries: [],
        search: {placeholder: 'Search applications', entries: query => ['Fabrikam · Data Analyst', 'Relecloud · Support Engineer', 'Trey Research · Data Engineer I']
          .filter(label => label.toLowerCase().includes(query.toLowerCase())).map(label => item(label, label))},
      })},
      item('not-a-job', 'Not about a job', {icon: 'block'}),
    ],
  };
}

async function menu() {
  const run = vi.fn();
  const onKey = vi.fn();
  await render(<Opener spec={menuSpec(run)} onKey={onKey} />);
  await page.getByRole('button', {name: 'Assign to…'}).click();
  await expect.element(page.getByRole('menu', {name: 'Assign to'})).toBeInTheDocument();
  return {run, onKey};
}

test('a menu opens on its first item; ↑ ↓ move the cursor past what can\'t be picked, Enter picks and closes it, and no key reaches the page', async () => {
  const {run, onKey} = await menu();
  expect(cursorOf()).toContain('Software Engineer II, Claims');
  // Its label and two lines: "Software Engineer II, Claims" over "Applied Sep 30 · Applied".
  expect(page.getByRole('menuitem', {name: /II, Claims/}).element().querySelector('.s')?.textContent).toBe('Applied Sep 30 · Applied');
  await userEvent.keyboard('{ArrowDown}');
  expect(cursorOf()).toContain('Java');
  // The one that can't be picked is passed over.
  await userEvent.keyboard('{ArrowDown}');
  expect(cursorOf()).toBe('Another application…');
  await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
  // Round from the first to the last.
  expect(cursorOf()).toBe('Not about a job');
  await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
  expect(run.mock.calls).toEqual([['Software Engineer II (Java)']]);
  await expect.element(page.getByRole('menu', {name: 'Assign to'})).not.toBeInTheDocument();
  expect(onKey).not.toHaveBeenCalled();
});

test('Esc closes the menu and gives focus back to its button; a press outside closes it too; the pointer moves the cursor', async () => {
  await menu();
  await userEvent.keyboard('{Escape}');
  await expect.element(page.getByRole('menu', {name: 'Assign to'})).not.toBeInTheDocument();
  expect(document.activeElement?.textContent).toBe('Assign to…');
  await page.getByRole('button', {name: 'Assign to…'}).click();
  await userEvent.hover(page.getByRole('menuitem', {name: 'Not about a job'}));
  expect(cursorOf()).toBe('Not about a job');
  await userEvent.click(document.body, {position: {x: 600, y: 600}});
  await expect.element(page.getByRole('menu', {name: 'Assign to'})).not.toBeInTheDocument();
});

test('→ opens a submenu to the left of its item, its search field taking the keys; typing narrows it, ← or Esc goes back, and Enter picks', async () => {
  const {run} = await menu();
  await userEvent.keyboard('{ArrowDown}{ArrowDown}');
  await userEvent.keyboard('{ArrowRight}');
  const field = page.getByRole('textbox', {name: 'Search applications'});
  await expect.element(field).toHaveFocus();
  // Beside its item: to the menu's left, its top at the item's height.
  const [outer, inner] = [...document.querySelectorAll<HTMLElement>('.jb-menu')].map(element => element.getBoundingClientRect());
  const item = page.getByRole('menuitem', {name: 'Another application…'}).element().getBoundingClientRect();
  expect(inner!.right).toBeLessThanOrEqual(outer!.left);
  expect(Math.abs(inner!.top - item.top)).toBeLessThan(item.height);
  expect(page.getByRole('menuitem', {name: 'Another application…'}).element().getAttribute('aria-expanded')).toBe('true');
  // Esc goes back a step: the submenu goes, the menu stays with its cursor.
  await userEvent.keyboard('{Escape}');
  await expect.element(field).not.toBeInTheDocument();
  expect(cursorOf()).toBe('Another application…');
  await userEvent.keyboard('{Enter}');
  await expect.element(page.getByRole('textbox', {name: 'Search applications'})).toHaveFocus();
  await userEvent.keyboard('trey');
  expect(page.getByRole('menu', {name: 'Another application'}).element().textContent).toBe('Trey Research · Data Engineer I');
  await userEvent.keyboard('{Enter}');
  expect(run.mock.calls).toEqual([['Trey Research · Data Engineer I']]);
  await expect.element(page.getByRole('menu', {name: 'Assign to'})).not.toBeInTheDocument();
});

test('← in a submenu without a field goes back to its item', async () => {
  const run = vi.fn();
  const spec: MenuSpec = {label: 'More', width: 300, entries: [
    {kind: 'item', id: 'status', label: 'Set status', icon: 'radio_button_checked', submenu: () => ({label: 'Set status', width: 220, entries: [
      {kind: 'item', id: 'applied', label: 'Applied', mark: 'applied', checked: true, run: () => run('applied')},
      {kind: 'item', id: 'rejected', label: 'Rejected', mark: 'rej', run: () => run('rejected')},
    ]})},
  ]};
  await render(<Opener spec={spec} onKey={() => {}} />);
  await page.getByRole('button', {name: 'Assign to…'}).click();
  await userEvent.keyboard('{ArrowRight}');
  await expect.element(page.getByRole('menu', {name: 'Set status'})).toBeInTheDocument();
  // The current status checked, each in the table's colours.
  expect(page.getByRole('menuitem', {name: 'Applied'}).element().getAttribute('aria-checked')).toBe('true');
  expect(getComputedStyle(page.getByRole('menuitem', {name: 'Rejected'}).element().querySelector('.sd')!).backgroundColor).toBe(colour('var(--alert)'));
  await userEvent.keyboard('{ArrowLeft}');
  await expect.element(page.getByRole('menu', {name: 'Set status'})).not.toBeInTheDocument();
  await userEvent.keyboard('{Enter}{ArrowDown}{Enter}');
  expect(run.mock.calls).toEqual([['rejected']]);
});

// ---- A JD to confirm's candidates (34a) ----

const CANDIDATES: JdCandidateOut[] = [
  {id: 1, title: 'Junior Developer', location: 'New York, NY', platform: 'Greenhouse', link: 'https://greenhouse.example/lucernepublishing/jobs/5520391', unreadable: false},
  {id: 2, title: 'Junior Developer, Digital', location: 'Remote', platform: 'LinkedIn', link: 'https://linkedin.example/jobs/view/3981204417', unreadable: false},
];

function Picked({active, onPick, onNone}: {active: boolean; onPick: (candidate: JdCandidateOut) => void; onNone: () => void}) {
  const [picked, setPicked] = useState<number | 'none' | null>(null);
  return <CandidatePicker candidates={CANDIDATES} active={active} picked={picked} onPick={candidate => {
    setPicked(candidate.id);
    onPick(candidate);
  }} onNone={() => {
    setPicked('none');
    onNone();
  }} />;
}

test('the candidates are radios, the last None of these; ↑ ↓ choose and Enter picks, and picked the group takes good', async () => {
  const onPick = vi.fn();
  const onNone = vi.fn();
  await render(<Picked active={false} onPick={onPick} onNone={onNone} />);
  const group = page.getByRole('radiogroup', {name: 'Is this the posting?'});
  expect(group.getByRole('radio').all().map(radio => radio.element().textContent)).toEqual(['Junior Developer · New York, NY · Greenhouse', 'Junior Developer, Digital · Remote · LinkedIn', 'None of these']);
  // A hairline between them, inside each row, as boards 32 and 34a draw.
  const rows = group.getByRole('radio').all().map(radio => radio.element().parentElement!);
  expect(rows.map(row => getComputedStyle(row).boxShadow.includes(colour('var(--hair)')))).toEqual([false, true, true]);
  // Each arrow opens its posting without picking it.
  await expect.element(group.getByRole('link', {name: 'Look at Junior Developer, Digital'})).toHaveAttribute('href', CANDIDATES[1]!.link);
  await group.getByRole('radio').first().element().focus();
  await userEvent.keyboard('{ArrowDown}');
  await expect.element(group.getByRole('radio').nth(1)).toHaveFocus();
  await expect.poll(() => getComputedStyle(group.getByRole('radio').nth(1).element().parentElement!).backgroundColor).toBe(colour('var(--sub2)'));
  await userEvent.keyboard('{Enter}');
  expect(onPick.mock.calls.map(([candidate]) => candidate.id)).toEqual([2]);
  expect(group.getByRole('radio').nth(1).element().getAttribute('aria-checked')).toBe('true');
  await expect.poll(() => getComputedStyle(group.element()).backgroundColor).toBe(colour('color-mix(in oklch, var(--good) 10%, transparent)'));
  // Picked, it answers nothing more.
  await userEvent.keyboard('{ArrowDown}{Enter}');
  expect(onPick).toHaveBeenCalledTimes(1);
  expect(onNone).not.toHaveBeenCalled();
});

const UNREADABLE: JdCandidateOut = {id: 3, title: 'Junior Developer', location: 'New York, NY', platform: 'Glassdoor', link: 'https://www.glassdoor.example/job-listing/2291', unreadable: true};

test('a candidate Jobs can\'t read says so, however long its title, and its arrow still opens it (SV-140)', async () => {
  const long = {...UNREADABLE, title: 'Junior Developer, Reading Apps and the Services Behind Them, New York or Remote'};
  await render(<div style={{width: 420}}><CandidatePicker candidates={[CANDIDATES[0]!, long]} active={false} picked={null} onPick={() => {}} onNone={() => {}} /></div>);
  const group = page.getByRole('radiogroup', {name: 'Is this the posting?'});
  expect(group.getByRole('radio').first().element().textContent).toBe('Junior Developer · New York, NY · Greenhouse');
  const note = group.getByText('Jobs can\'t read this one', {exact: true});
  await expect.element(note).toBeVisible();
  expect(note.element().closest('[role="radio"]')).toBe(group.getByRole('radio').nth(1).element());
  // The title gives way, never the note.
  expect(note.element().getBoundingClientRect().right).toBeLessThanOrEqual(group.getByRole('radio').nth(1).element().getBoundingClientRect().right);
  expect(note.element().scrollWidth).toBeLessThanOrEqual(note.element().clientWidth);
  await expect.element(group.getByRole('link', {name: `Look at ${long.title}`})).toHaveAttribute('href', UNREADABLE.link);
});

test('a pick\'s toast says "Link kept" of a candidate Jobs can\'t read, never "JD saved" (SV-140)', () => {
  expect(pickWords(UNREADABLE, 'Lucerne Publishing')).toEqual({done: 'Link kept for Lucerne Publishing', failed: 'Couldn\'t keep the link'});
  expect(pickWords(CANDIDATES[0]!, 'Lucerne Publishing')).toEqual({done: 'JD saved for Lucerne Publishing', failed: 'Couldn\'t save the JD'});
});

test('Choose… says the same of a candidate Jobs can\'t read, its arrow still there (SV-140)', () => {
  const entries = chooseMenu([CANDIDATES[0]!, UNREADABLE], {pick: () => {}, none: () => {}}).entries;
  expect(entries.map(entry => (entry.kind === 'item' ? [entry.sub, entry.peek] : entry.kind))).toEqual([
    ['New York, NY · Greenhouse', CANDIDATES[0]!.link],
    ['New York, NY · Glassdoor · Jobs can\'t read this one', UNREADABLE.link],
    'sep',
    [undefined, undefined],
  ]);
});

test('while its item has the page\'s cursor, ↑ ↓ and Enter reach it from the page: up from the top is None of these', async () => {
  const onNone = vi.fn();
  await render(<Picked active onPick={() => {}} onNone={onNone} />);
  await userEvent.keyboard('{ArrowUp}');
  expect(document.querySelector('.jb-cand.cur')?.textContent).toBe('None of these');
  await userEvent.keyboard('{Enter}');
  expect(onNone).toHaveBeenCalledTimes(1);
});

// ---- Paste the posting (SV-140) ----

test('the area takes the focus as it opens; ⌘Enter saves what\'s typed and Esc cancels, each going no further', async () => {
  const onSave = vi.fn(() => Promise.resolve());
  const onCancel = vi.fn();
  const onKey = vi.fn();
  await render(<div onKeyDown={event => onKey(event.key)}><PastePosting onSave={onSave} onCancel={onCancel} /></div>);
  const area = page.getByRole('textbox', {name: 'The posting\'s text'});
  await expect.element(area).toHaveFocus();
  // Enter alone is a new line.
  await userEvent.keyboard('A role{Enter}at Fabrikam');
  expect(onSave).not.toHaveBeenCalled();
  expect((area.element() as HTMLTextAreaElement).value).toBe('A role\nat Fabrikam');
  await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
  expect(onSave.mock.calls).toEqual([['A role\nat Fabrikam']]);
  await userEvent.keyboard('{Escape}');
  expect(onCancel).toHaveBeenCalledTimes(1);
  // Neither reaches the page (Esc would close the pane).
  expect(onKey.mock.calls.filter(([key]) => key === 'Escape')).toEqual([]);
  expect(onKey.mock.calls.filter(([key]) => key === 'Enter')).toHaveLength(1);
});

test('Save and Cancel do the same, Save once while it\'s on its way', async () => {
  let saved = () => {};
  const onSave = vi.fn(() => new Promise<void>(resolve => {
    saved = resolve;
  }));
  const onCancel = vi.fn();
  await render(<PastePosting onSave={onSave} onCancel={onCancel} />);
  await userEvent.keyboard('A role at Fabrikam');
  await page.getByRole('button', {name: 'Save'}).click();
  await expect.element(page.getByRole('button', {name: 'Save'})).toBeDisabled();
  await page.getByRole('textbox', {name: 'The posting\'s text'}).click();
  await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
  expect(onSave).toHaveBeenCalledTimes(1);
  saved();
  await page.getByRole('button', {name: 'Cancel'}).click();
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test('a refusal stays in place in alert with the text kept, the field marked and focused, and goes on the next try', async () => {
  const onSave = vi.fn<(text: string) => Promise<void>>()
    .mockRejectedValueOnce(new ApiFailure(400, 'invalid', 'That\'s too short to be a posting, paste its whole text.'))
    .mockResolvedValueOnce(undefined);
  await render(<PastePosting onSave={onSave} onCancel={() => {}} />);
  const area = page.getByRole('textbox', {name: 'The posting\'s text'});
  await userEvent.keyboard('A role.{Meta>}{Enter}{/Meta}');
  const alert = page.getByRole('alert');
  await expect.element(alert).toHaveTextContent('That\'s too short to be a posting, paste its whole text.');
  await expect.element(area).toHaveAttribute('aria-invalid', 'true');
  await expect.element(area).toHaveValue('A role.');
  await expect.element(area).toHaveFocus();
  await expect.element(page.getByRole('button', {name: 'Save'})).toBeEnabled();
  await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
  await expect.element(alert).not.toBeInTheDocument();
});

test('too long is said here, without sending it', async () => {
  const onSave = vi.fn(() => Promise.resolve());
  await render(<PastePosting onSave={onSave} onCancel={() => {}} />);
  const area = page.getByRole('textbox', {name: 'The posting\'s text'});
  await area.fill('a'.repeat(MAX_PASTED_CHARS + 1));
  await page.getByRole('button', {name: 'Save'}).click();
  await expect.element(page.getByRole('alert')).toHaveTextContent(PASTED_TOO_LONG);
  expect(onSave).not.toHaveBeenCalled();
});

const PASTED: PostingOut = {summary: '', location: null, location_set_at: null, workplace: null, workplace_detail: null, salary: null, must_haves: [], nice_to_haves: [], full_text: '## The role\n\nWeekly reports.', link: null, source: 'pasted', platform: null, found_at: '2026-10-07T16:12:00.000Z'};

test('a JD pasted says so in the full posting and the column, and shows no link it hasn\'t got', async () => {
  await render(<FullPosting posting={PASTED} title="Data Analyst" company="Fabrikam" timeZone={ZONE} today={TODAY} />);
  const row = page.getByRole('group', {name: 'Full posting'});
  await expect.element(row).toHaveTextContent('Full postingPasted by you · Oct 7, 9:12 AMShow');
  expect(row.element().querySelector('a')).toBeNull();
  expect(foundShort(PASTED, ZONE, TODAY)).toBe('Pasted by you · Oct 7');
  expect(foundBy(PASTED)).toBe('Pasted');
  const jd = {state: 'found', source: 'pasted', platform: null, found_at: PASTED.found_at, candidates: 0, looked_at: null, link: null, stopped: false} as const;
  expect(jdCell(jd, Date.parse('2026-10-07T18:12:00.000Z'), ZONE)).toMatchObject({text: 'Pasted', title: 'Pasted by you · 2h ago'});
  expect(jdCell({...jd, state: 'not_found', source: null, stopped: true}, Date.parse('2026-10-07T18:12:00.000Z'), ZONE)).toMatchObject({text: 'Stopped', title: 'You stopped the lookup'});
});

test('a JD not read yet has no reading to show: the popover says nothing of a salary', async () => {
  const {button} = await chip(NORTHWIND, detailOf(PASTED));
  await button.click();
  const popover = page.getByRole('dialog', {name: 'Job description'});
  await expect.element(popover.getByRole('button', {name: 'Full posting'})).toBeInTheDocument();
  expect(popover.element().textContent).toBe('Northwind Talent· via GreenhouseSoftware Engineer IIn process· Applied Oct 1Pasted by you · Oct 7Full postingOpen in Jobs');
});

test('what it has read shows as any JD\'s does', async () => {
  const {button} = await chip(NORTHWIND, detailOf({...PASTED, summary: 'Weekly reports for the whole company.', location: 'Atlanta, GA'}));
  await button.click();
  const popover = page.getByRole('dialog', {name: 'Job description'});
  await expect.element(popover.getByRole('button', {name: 'Full posting'})).toBeInTheDocument();
  expect(popover.element().textContent).toContain('What they wantWeekly reports for the whole company.Atlanta, GASalary not stated');
  expect([PASTED, {...PASTED, nice_to_haves: ['Python']}, {...PASTED, salary: '$70,000'}].map(hasReading)).toEqual([false, true, true]);
});

// ---- The location in place (SV-170) ----

/** The detail's facts, the location editable as Jd holds it. */
function Facts({posting, reading = true, onSave = () => {}}: {posting: PostingOut; reading?: boolean; onSave?: (value: string) => void}) {
  const [editing, setEditing] = useState(false);
  return (
    <div style={{width: 600}}>
      <JdFacts posting={posting} reading={reading} location={{
        editing, today: TODAY, timeZone: ZONE, onEdit: () => setEditing(true), onSave: value => {
          setEditing(false);
          onSave(value);
        }, onCancel: () => setEditing(false),
      }} />
    </div>
  );
}

test('a JD not read yet offers Add location and claims nothing else; one read shows the location the user set with when', async () => {
  const {rerender} = await render(<Facts posting={PASTED} reading={false} />);
  const add = page.getByRole('button', {name: 'Add location'});
  await expect.element(add).toBeInTheDocument();
  expect(document.querySelector('.jb-facts')!.textContent).toBe('Add location');
  rerender(<Facts posting={{...POSTING, location: 'Austin, TX', location_set_at: '2026-10-07T16:12:00.000Z'}} />);
  const place = page.getByRole('button', {name: 'Austin, TX'});
  await expect.element(place).toHaveAttribute('data-tip', 'Set by you on Oct 7');
  expect(document.querySelector('.jb-facts')!.textContent).toBe('Austin, TXHybrid, 3 days$95,000–$115,000');
  // A location the user set isn't a reading: a pasted JD with only that still claims no salary.
  expect(hasReading({...PASTED, location: 'Austin, TX', location_set_at: '2026-10-07T16:12:00.000Z'})).toBe(false);
});

test('the location\'s field: Enter saves what\'s typed, and an emptied one saves empty, taking it away', async () => {
  const onSave = vi.fn();
  await render(<Facts posting={POSTING} onSave={onSave} />);
  await page.getByRole('button', {name: 'Irvine, CA'}).click();
  const field = page.getByRole('textbox', {name: 'Location'});
  await expect.element(field).toHaveFocus();
  await userEvent.keyboard('Remote, US{Enter}');
  await page.getByRole('button', {name: 'Irvine, CA'}).click();
  await userEvent.keyboard('{Backspace}{Enter}');
  expect(onSave.mock.calls).toEqual([['Remote, US'], ['']]);
});

// ---- The title in place (35a) ----

test('the title\'s field: its words selected, Enter saves what\'s typed and Esc cancels, both at once and going no further', async () => {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const onKey = vi.fn();
  const {rerender} = await render(<div onKeyDown={event => onKey(event.key)}><EditField label="Title" value="Software Engineer II, Claims" onSave={onSave} onCancel={onCancel} /></div>);
  const field = page.getByRole('textbox', {name: 'Title'});
  await expect.element(field).toHaveFocus();
  const input = field.element() as HTMLInputElement;
  expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
  await userEvent.keyboard('  Claims Platform Engineer {Enter}');
  expect(onSave.mock.calls).toEqual([['Claims Platform Engineer']]);
  expect(onCancel).not.toHaveBeenCalled();

  rerender(<div onKeyDown={event => onKey(event.key)}><EditField key="again" label="Title" value="Software Engineer II, Claims" onSave={onSave} onCancel={onCancel} /></div>);
  await userEvent.keyboard('Something else{Escape}');
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onSave).toHaveBeenCalledTimes(1);
  // Neither Enter nor Esc reaches the page (Esc would close the pane).
  expect(onKey.mock.calls.filter(([key]) => key === 'Escape' || key === 'Enter')).toEqual([]);
});

test('an empty or unchanged title saves nothing', async () => {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  await render(<EditField label="Title" value="Data Analyst" onSave={onSave} onCancel={onCancel} />);
  await userEvent.keyboard('{Enter}');
  expect([onSave.mock.calls.length, onCancel.mock.calls.length]).toEqual([0, 1]);
});

// ---- In mail (J7, boards 37a–37c): the JD chip, its popover, and Applied before ----

const NORTHWIND: JobsMailApplicationOut = {id: 7, company: 'Northwind Talent', title: 'Software Engineer I', applied_on: '2026-10-01', status: 'in_process', status_on: '2026-10-07', ghosted: false};

/** Northwind's detail, as GET /api/jobs/applications/7 answers it, with its JD or where the JD stands. */
const detailOf = (posting: PostingOut | null, jd: Partial<ApplicationOut['jd']> = {}): ApplicationOut => ({
  ...NORTHWIND, platform: 'Greenhouse', account_id: 4, applied_at: '2026-10-01T18:26:00.000Z', status_set_by: 'email', status_set_at: '2026-10-07T14:12:00.000Z',
  step: 'Pick a 30-minute interview slot this week', step_at: '2026-10-07T14:12:00.000Z', days_without_email: 0, reapplied_from: null, first_seen_in_email: false, pinned_at: null,
  jd: {state: posting ? 'found' : 'none', source: posting?.source ?? null, platform: posting?.platform ?? null, found_at: posting?.found_at ?? null, candidates: 0, looked_at: null, link: posting?.link ?? null, stopped: false, ...jd},
  posting, candidates: [], timeline: [], applied_before: [], also_at: [], hand_set: [],
});

/** The chip as the reader's head draws it, inside something that takes the page's keys and clicks. */
async function chip(application = NORTHWIND, detail: ApplicationOut | undefined = detailOf({...POSTING, must_haves: ['TypeScript and React', 'An API you built', 'SQL'], nice_to_haves: ['Node.js on the server', 'Tests in CI']})) {
  const onKey = vi.fn();
  await render(
    <div style={{display: 'flex', flexDirection: 'column', gap: 12, padding: 28, height: 800}} onKeyDown={event => onKey(event.key)} tabIndex={-1}>
      <JdChip application={application} detail={detail} today={TODAY} timeZone={ZONE} />
      <p>The email&apos;s body</p>
    </div>,
  );
  return {onKey, button: page.getByRole('button', {name: /Software Engineer I|Northwind Talent/})};
}

test('the JD chip (37a): work, the role, "· Applied Oct 1 · In process" and its chevron, its tip saying what it is', async () => {
  const {button} = await chip();
  await expect.element(button).toHaveTextContent('Software Engineer I· Applied Oct 1 · In process');
  await expect.element(button).toHaveAttribute('data-tip', 'The job description you applied to');
  await expect.element(button).toHaveAttribute('aria-expanded', 'false');
});

test.each<[string, Partial<JobsMailApplicationOut>, string]>([
  ['Rejected, with its day', {status: 'rejected', status_on: '2026-10-05'}, 'Software Engineer I· Applied Oct 1 · Rejected Oct 5'],
  ['Offer, with its day', {status: 'offer', status_on: '2026-10-06'}, 'Software Engineer I· Applied Oct 1 · Offer Oct 6'],
  ['Applied, which the date already says', {status: 'applied'}, 'Software Engineer I· Applied Oct 1'],
  ['Ghosted, a flag on Applied', {status: 'applied', ghosted: true}, 'Software Engineer I· Applied Oct 1 · Ghosted'],
  ['an application naming no role: its company', {title: '  '}, 'Northwind Talent· Applied Oct 1 · In process'],
  ['applied today', {applied_on: TODAY}, 'Software Engineer I· Applied Today · In process'],
])('the chip for %s', async (_, change, words) => {
  const {button} = await chip({...NORTHWIND, ...change});
  await expect.element(button).toHaveTextContent(words);
});

test('its popover (37b): the head, What they want, the facts and both lists, and the foot; the chip lit while it\'s open, and again closes it', async () => {
  const {button} = await chip();
  await button.click();
  const popover = page.getByRole('dialog', {name: 'Job description'});
  await expect.element(popover).toBeInTheDocument();
  await expect.element(button).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => getComputedStyle(button.element()).backgroundColor).toBe(colour('var(--sub2)'));
  const parts = (selector: string) => [...popover.element().querySelectorAll(selector)].map(part => part.textContent);
  expect(parts('.ph-head > *')).toEqual(['Northwind Talent· via Greenhouse', 'Software Engineer I', 'In process· Applied Oct 1']);
  expect(parts('.bd .jb-label')).toEqual(['What they want', 'Must-haves 3', 'Nice-to-haves 2']);
  expect(parts('.bd .jb-facts > span')).toEqual(['Irvine, CA', 'Hybrid, 3 days', '$95,000–$115,000']);
  await expect.element(popover.getByText('Found on Greenhouse · Oct 1', {exact: true})).toHaveAttribute('data-tip', 'Found on Greenhouse · Oct 1, 10:41 AM');
  expect([...popover.element().querySelectorAll('.ft button')].map(each => each.textContent)).toEqual(['Full posting', 'Open in Jobs']);
  // Under the chip, at its left edge, 460 wide, once it has grown in.
  await expect.poll(() => popover.element().getBoundingClientRect().width).toBe(460);
  expect(popover.element().getBoundingClientRect().left).toBe(button.element().getBoundingClientRect().left);
  await button.click();
  await expect.element(popover).not.toBeInTheDocument();
  await expect.element(button).toHaveAttribute('aria-expanded', 'false');
});

const LONG_SALARY = '$3,900.00 - $6,500.00 per month (grades A, B, C, D, E, F; varies by grade, by office and by bargaining unit)';
const UNBROKEN_PLACES = 'Fresno/Sacramento/Oakland/Riverside/Redding/Bakersfield/Stockton/Modesto/Visalia/Eureka/Salinas';

const factOf = (root: Element, words: string) => [...root.querySelectorAll<HTMLElement>('.jb-facts > span')].find(fact => fact.textContent === words)!;
/** The lines a fact's text is drawn on, top to bottom. */
function textLines(fact: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(fact);
  const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.x > fact.querySelector('.icon')!.getBoundingClientRect().right);
  return [...new Set(rects.map(rect => rect.top))].map(top => rects.filter(rect => rect.top === top));
}

/** The fact wraps within its box and the row's, its glyph level with the first line. */
function expectWrappedInside(fact: HTMLElement) {
  const box = fact.getBoundingClientRect();
  const row = fact.closest('.jb-facts')!.getBoundingClientRect();
  const lines = textLines(fact);
  expect(lines.length).toBeGreaterThan(1);
  expect(box.right).toBeLessThanOrEqual(row.right);
  expect(Math.max(...lines.flat().map(rect => rect.right))).toBeLessThanOrEqual(box.right);
  const icon = fact.querySelector('.icon')!.getBoundingClientRect();
  const first = lines[0]![0]!;
  expect(Math.abs((icon.top + icon.bottom) / 2 - (first.top + first.bottom) / 2)).toBeLessThan(1);
}

test.each([
  ['a long salary', {salary: LONG_SALARY}, LONG_SALARY, 'Irvine, CA'],
  ['a long location with no spaces', {location: UNBROKEN_PLACES}, UNBROKEN_PLACES, '$95,000–$115,000'],
])('a JD\'s facts: %s wraps inside its box, and the short ones stay on one line, side by side', async (_, change, long, beside) => {
  const {container} = await render(<div style={{width: 340}}><JdFacts posting={{...POSTING, ...change}} /></div>);
  expectWrappedInside(factOf(container, long));
  const place = factOf(container, 'Hybrid, 3 days');
  expect(textLines(place)).toHaveLength(1);
  expect(place.getBoundingClientRect().top).toBe(factOf(container, beside).getBoundingClientRect().top);
});

test('a long fact wraps inside mail\'s popover too', async () => {
  const {button} = await chip(NORTHWIND, detailOf({...POSTING, salary: `${LONG_SALARY}; ${LONG_SALARY}`}));
  await button.click();
  const popover = page.getByRole('dialog', {name: 'Job description'});
  await expect.poll(() => popover.element().getBoundingClientRect().width).toBe(460);
  expectWrappedInside(factOf(popover.element(), `${LONG_SALARY}; ${LONG_SALARY}`));
});

test('the unfolded posting\'s source facts hold one line each, a long link cut by its ellipsis', async () => {
  await render(
    <div style={{width: 300}}>
      <FullPosting posting={{...POSTING, link: 'https://careers.a-very-long-hiring-platform-name-for-northwind-talent.example/jobs/4471029'}} title="Software Engineer I" company="Northwind Talent" timeZone={ZONE} today={TODAY} />
    </div>,
  );
  await page.getByRole('group', {name: 'Full posting'}).getByRole('button', {name: 'Show'}).click();
  const facts = await vi.waitFor(() => {
    const found = document.querySelector<HTMLElement>('.jb-unfold .jb-facts');
    expect(found).not.toBeNull();
    return found!;
  });
  const link = facts.querySelector('a')!;
  const words = link.querySelector<HTMLElement>('span')!;
  expect(words.scrollWidth).toBeGreaterThan(words.clientWidth);
  expect(link.getBoundingClientRect().height).toBe(facts.querySelector('span')!.getBoundingClientRect().height);
  expect(link.getBoundingClientRect().right).toBeLessThanOrEqual(facts.getBoundingClientRect().right);
});

test('Esc closes the popover at once, and goes no further (it would close the reader); a click away closes it too', async () => {
  const {onKey, button} = await chip();
  await button.click();
  const popover = page.getByRole('dialog', {name: 'Job description'});
  await expect.element(popover).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  await expect.element(popover).not.toBeInTheDocument();
  expect(onKey.mock.calls.filter(([key]) => key === 'Escape')).toEqual([]);
  // A second Esc, with nothing open, is the page's.
  await userEvent.keyboard('{Escape}');
  expect(onKey.mock.calls.filter(([key]) => key === 'Escape')).toHaveLength(1);

  await button.click();
  await expect.element(popover).toBeInTheDocument();
  // A click inside it keeps it.
  await popover.getByText('What they want').click();
  await expect.element(popover).toBeInTheDocument();
  await page.getByText('The email\'s body').click();
  await expect.element(popover).not.toBeInTheDocument();
});

test.each<[string, ApplicationOut, string]>([
  ['No JD found', detailOf(null, {state: 'not_found', looked_at: '2026-10-01T18:33:00.000Z'}), 'No JD found · Greenhouse and a web search had nothing for it on Oct 1'],
  ['Couldn\'t read the posting you picked', detailOf(null, {state: 'not_found', looked_at: '2026-10-01T18:33:00.000Z', link: 'https://www.glassdoor.example/job-listing/2291'}), 'Couldn\'t read the posting you picked · glassdoor.example gave Jobs no text on Oct 1'],
  ['Looking for the posting…', detailOf(null, {state: 'looking', looked_at: '2026-10-07T16:00:00.000Z'}), 'Looking for the posting… · the email\'s link, then the platforms, then search'],
  ['Lookup stopped', detailOf(null, {state: 'not_found', stopped: true, looked_at: '2026-10-07T16:00:00.000Z'}), 'Lookup stopped · You stopped it on Oct 7'],
  ['Is this the posting?', detailOf(null, {state: 'candidates', candidates: 2}), 'Is this the posting? · 2 candidates in Needs you'],
])('without a JD the popover says so: %s, with Open in Jobs and no Full posting', async (_, detail, words) => {
  const {button} = await chip(NORTHWIND, detail);
  await button.click();
  const popover = page.getByRole('dialog', {name: 'Job description'});
  await expect.element(popover.getByText(words.split(' · ')[0]!, {exact: true})).toBeInTheDocument();
  expect(popover.element().querySelector('.bd')!.textContent).toBe(words);
  expect([...popover.element().querySelectorAll('.ft button')].map(each => each.textContent)).toEqual(['Open in Jobs']);
});

const CONTOSO: NonNullable<JobsMailMessageOut['applied_before']> = {
  query: 'contoso pharmaceuticals', count: 1,
  latest: {id: 12, company: 'Contoso Pharmaceuticals', title: 'Associate Software Engineer', applied_on: '2026-09-16', status: 'rejected', status_on: '2026-10-05', ghosted: false},
};

test('Applied before (37c): on the row and in the reader, each with its tip; a click opens Jobs searched for the company, never the row under it', async () => {
  const onRow = vi.fn();
  const was = `${window.location.pathname}${window.location.search}`;
  try {
    await render(
      <div className="row" style={{display: 'flex', width: 900}} onClick={onRow}>
        <AppliedBefore before={CONTOSO} today={TODAY} />
        <AppliedBefore before={CONTOSO} today={TODAY} large />
      </div>,
    );
    const [row, reader] = [page.getByRole('button').nth(0), page.getByRole('button').nth(1)];
    await expect.element(row).toHaveAttribute('data-tip', 'Open Jobs searched for Contoso Pharmaceuticals');
    await expect.element(reader).toHaveAttribute('data-tip', 'Open in Jobs · every application at Contoso Pharmaceuticals');
    await expect.element(row).toHaveTextContent('Applied Sep 16 · Rejected Oct 5');
    await expect.element(reader).toHaveTextContent('Applied Sep 16 · Rejected Oct 5');
    await userEvent.hover(row);
    await expect.poll(() => getComputedStyle(row.element()).backgroundColor).toBe(colour('var(--sub)'));
    await row.click();
    expect(`${window.location.pathname}${window.location.search}`).toBe('/jobs?q=contoso%20pharmaceuticals');
    expect(onRow).not.toHaveBeenCalled();
  } finally {
    window.history.replaceState(null, '', was);
  }
});

// ---- J8's words (38a, 38b, 39a, 39b) ----

const NOW = Date.parse('2026-10-07T16:12:00.000Z');
const HEALTHY: JobsReadingOut = {waiting: 0, state: 'healthy', since: null, reason: null, cause: null, retrying: false};
const DONE: JobsHistoryOut = {state: 'done', read: 330, total: 330, started_at: '2026-10-02T01:02:00.000Z', finished_at: '2026-10-02T03:14:00.000Z'};
const down = (cause: JobsReadingOut['cause'], waiting = 5, retrying = cause === 'unreachable' || cause === 'rate_limited', since = '2026-10-07T15:52:00.000Z'): JobsReadingOut =>
  ({waiting, state: 'down', since, reason: 'Anthropic: Overloaded (529)', cause, retrying});

test.each<[string, JobsReadingOut, JobsHistoryOut, string | null]>([
  ['healthy: no line', HEALTHY, DONE, null],
  ['unreachable (38b)', down('unreachable'), DONE, '5 emails not read yet, Anthropic unreachable since 8:52 AM, retrying'],
  ['one email', down('unreachable', 1), DONE, '1 email not read yet, Anthropic unreachable since 8:52 AM, retrying'],
  ['rate limited', down('rate_limited'), DONE, '5 emails not read yet, Anthropic rate limited since 8:52 AM, retrying'],
  ['its key refused: no retrying', down('refused'), DONE, '5 emails not read yet, Anthropic refused its key in Settings › AI'],
  ['no key', down('no_key'), DONE, '5 emails not read yet, Jobs needs an Anthropic key in Settings › AI'],
  ['down since yesterday: the day too', down('unreachable', 5, true, '2026-10-06T15:52:00.000Z'), DONE, '5 emails not read yet, Anthropic unreachable since Oct 6, 8:52 AM, retrying'],
  ['the history pass held: what it has left counts too', down('unreachable', 2), {...DONE, state: 'waiting', read: 140, finished_at: null}, '192 emails not read yet, Anthropic unreachable since 8:52 AM, retrying'],
  ['nothing waiting: the reason alone', down('unreachable', 0), DONE, 'Anthropic unreachable since 8:52 AM, retrying'],
])('the AI down\'s line, %s', (_, reading, history, line) => {
  expect(readingLine(reading, history, NOW, ZONE)).toBe(line);
});

test('the history pass\'s line (38a): its counts in place and how far it has come; Settings › Jobs\'s row as it runs, once done and before', () => {
  const running: JobsHistoryOut = {...DONE, state: 'running', read: 140, finished_at: null};
  expect(historyLine(running)).toBe('Reading history · 140 of 330 emails · showing what’s read so far');
  expect(historyLine({read: 1200, total: 1310})).toBe('Reading history · 1,200 of 1,310 emails · showing what’s read so far');
  expect([historyShare(running), historyShare({read: 0, total: 0}), historyShare({read: 12, total: 10})]).toEqual([140 / 330, 0, 1]);
  expect(historySetting(running, NOW, ZONE)).toBe('Reading history · 140 of 330 emails');
  expect(historySetting(DONE, NOW, ZONE)).toBe('Read 330 emails once, when Jobs was turned on · finished Oct 1, 8:14 PM');
  expect(historySetting({state: 'not_started', read: 0, total: 0, started_at: null, finished_at: null}, NOW, ZONE)).toBe('Runs once when Jobs is turned on, over the mail from before then');
  expect([fromHistorySetting(6), fromHistorySetting(0)]).toEqual(['6 waiting in Needs you, what the pass wasn\'t sure of', 'None waiting in Needs you']);
});

test('Reads (#273, D383): an account changed in place, added at the end, or taken out by Off', () => {
  const listed = [{account_id: 4, reads: 'every' as const}, {account_id: 1, reads: 'career' as const}];
  expect(readsWith(listed, 1, 'every')).toEqual([{account_id: 4, reads: 'every'}, {account_id: 1, reads: 'every'}]);
  expect(readsWith(listed, 2, 'career')).toEqual([...listed, {account_id: 2, reads: 'career'}]);
  expect(readsWith(listed, 4, 'off')).toEqual([{account_id: 1, reads: 'career'}]);
  expect(readsWith(listed, 3, 'off')).toEqual(listed);
});

const ITEM: NeedsYouItemOut = {
  id: 1, kind: 'update_to_assign', reason: 'matches_several', from_history: false, company: 'Humongous Insurance', title: null, platform: 'iCIMS',
  subject: 'Thank you for your interest', sender: 'Humongous Insurance', event_kind: 'rejection', line: null, account_id: null, at: '2026-10-06T12:00:00.000Z',
  message_id: 40, application_id: null, candidates: [],
};

function needsYou(items: NeedsYouItemOut[], history: NeedsYouItemOut[], reading: number | null, onRead: (item: NeedsYouItemOut) => void) {
  return render(<NeedsYou items={items} history={history} rows={[]} accounts={new Map()} cursor={null} folded={false} now={Date.parse('2026-10-07T12:00:00Z')} timeZone={ZONE}
    unfoldHistory={1} reading={reading === null ? null : {item: reading, of: null}} onPoint={() => {}} onOpen={() => {}} onRead={onRead} onLook={() => {}} />);
}

test('D401: a subject with an email is a button that says so, on an item and on a From history row; one with no email isn\'t', async () => {
  const onRead = vi.fn();
  const gone = {...ITEM, id: 2, subject: 'Its email is gone', message_id: null};
  const jd = {...ITEM, id: 3, kind: 'jd_to_confirm' as const, title: 'Junior Developer', subject: null, message_id: null};
  const old = {...ITEM, id: 4, from_history: true, subject: 'From the history pass', message_id: 41};
  await needsYou([ITEM, gone, jd], [old], null, onRead);
  await page.getByRole('button', {name: 'Thank you for your interest'}).click();
  expect(onRead).toHaveBeenCalledExactlyOnceWith(ITEM);
  await page.getByRole('button', {name: 'From the history pass'}).click();
  expect(onRead).toHaveBeenLastCalledWith(old);
  await expect.element(page.getByText('Its email is gone')).toBeVisible();
  expect(page.getByRole('button', {name: 'Its email is gone'}).elements()).toHaveLength(0);
  expect(page.getByRole('button', {name: /Humongous Insurance · Junior Developer/}).elements()).toHaveLength(0);
});

test('D401: the item whose email is open shows as pressed, its fill the open row\'s, and its line of actions stays', async () => {
  await needsYou([ITEM, {...ITEM, id: 2, subject: 'Another'}], [], 1, () => {});
  const open = page.getByRole('button', {name: 'Thank you for your interest'});
  await expect.element(open).toHaveAttribute('aria-pressed', 'true');
  await expect.element(page.getByRole('button', {name: 'Another'})).toHaveAttribute('aria-pressed', 'false');
  const item = open.element().closest<HTMLElement>('.jb-need')!;
  await expect.poll(() => getComputedStyle(item).backgroundColor).toBe(colour('var(--sub3)'));
  expect(page.getByRole('button', {name: 'Assign to…'}).elements()).toHaveLength(2);
});

test('D401: a long subject stays inside its line', async () => {
  const long = {...ITEM, subject: 'A subject long enough to need an ellipsis '.repeat(4)};
  await needsYou([long], [], null, () => {});
  const line = page.getByText(/^A subject long enough/);
  await expect.element(line).toBeInTheDocument();
  const subject = line.element() as HTMLElement;
  expect(subject.tagName).toBe('BUTTON');
  const box = subject.closest('.l1')!.getBoundingClientRect();
  expect(subject.getBoundingClientRect().right).toBeLessThanOrEqual(box.right);
});

test('D402: an application\'s email button, and → on it, run its look and leave the menu open; Enter still picks it', async () => {
  const look = vi.fn();
  const run = vi.fn();
  const spec: MenuSpec = {label: 'Assign to', width: 312, entries: [
    {kind: 'item', id: 'a1', label: 'Claims', sub: 'Applied Sep 30', look, run},
    {kind: 'item', id: 'not', label: 'Not about a job', run: () => {}},
  ]};
  const anchor = document.body.appendChild(document.createElement('button'));
  const onClose = vi.fn();
  await render(<JobsMenu spec={spec} anchor={{element: anchor, corner: 'left'}} onClose={onClose} />);
  const email = page.getByRole('menuitem', {name: 'Read its email'});
  await email.click();
  expect(look).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
  await expect.poll(() => email.element().className).toContain('on');
  (document.querySelector('.jb-menu') as HTMLElement).focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(look).toHaveBeenCalledTimes(2);
  expect(run).not.toHaveBeenCalled();
  await userEvent.keyboard('{Enter}');
  expect(run).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
  anchor.remove();
});

test('D402: a press in what keeps the menu leaves it open, and Esc with the focus there closes it before the page sees the key', async () => {
  const beside = document.body.appendChild(document.createElement('div'));
  beside.dataset.keepsMenu = '';
  beside.textContent = 'The email';
  const pageKey = vi.fn();
  document.addEventListener('keydown', pageKey);
  const anchor = document.body.appendChild(document.createElement('button'));
  const onClose = vi.fn();
  await render(<JobsMenu spec={{label: 'Assign to', width: 312, entries: [{kind: 'item', id: 'a', label: 'Claims', run: () => {}}]}} anchor={{element: anchor, corner: 'left'}} onClose={onClose} />);
  await expect.element(page.getByRole('menu', {name: 'Assign to'})).toBeVisible();
  await userEvent.click(beside);
  expect(onClose).not.toHaveBeenCalled();
  (document.activeElement as HTMLElement | null)?.blur();
  await userEvent.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(pageKey).not.toHaveBeenCalled();
  document.removeEventListener('keydown', pageKey);
  beside.remove();
  anchor.remove();
});

test('SV-174: Setpoint on LinkedIn\'s chip says an application\'s standing, and steps a closed one down, as mail\'s Applied before does', () => {
  const today = '2026-11-03';
  const applications: Pick<JobsMailApplicationOut, 'applied_on' | 'status' | 'status_on' | 'ghosted'>[] = [
    {applied_on: '2026-10-28', status: 'applied', status_on: '2026-10-28', ghosted: false},
    {applied_on: today, status: 'applied', status_on: today, ghosted: false},
    {applied_on: '2026-08-02', status: 'applied', status_on: '2026-08-02', ghosted: true},
    {applied_on: '2026-10-20', status: 'in_process', status_on: '2026-11-01', ghosted: false},
    {applied_on: '2026-09-16', status: 'rejected', status_on: '2026-10-05', ghosted: false},
    {applied_on: '2025-12-12', status: 'offer', status_on: '2026-01-09', ghosted: false},
    {applied_on: '2026-09-02', status: 'withdrawn', status_on: '2026-09-30', ghosted: false},
  ];
  for (const application of applications) {
    expect(chipStanding(application, today)).toBe(appliedStanding(application, today));
    expect(chipCloses(application)).toBe(recedes(application));
  }
});

// ---- The empty pane's recent movement (SV-220, D467, D470) ----

test('SV-220: a move\'s sides are the table\'s labels and marks, Ghosted its own', () => {
  expect((['applied', 'in_process', 'offer', 'rejected', 'withdrawn', 'ghosted'] as const).map(moveSide)).toEqual([
    {label: 'Applied', mark: 'applied'}, {label: 'In process', mark: 'proc'}, {label: 'Offer', mark: 'offer'}, {label: 'Rejected', mark: 'rej'},
    {label: 'Withdrawn', mark: 'wd'}, {label: 'Ghosted', mark: 'ghost'},
  ]);
});

test.each([
  ['2026-10-07T19:00:00.000Z', 'Today'],
  ['2026-10-07T07:30:00.000Z', 'Today'],
  ['2026-10-07T06:30:00.000Z', 'Yesterday'],
  ['2026-10-02T17:00:00.000Z', 'Fri'],
  ['2026-09-30T17:00:00.000Z', 'Sep 30'],
  ['2025-12-12T17:00:00.000Z', 'Dec 12, 2025'],
])('SV-220: a move at %s is dated %s', (at, word) => {
  expect(moveDay(at, ZONE, TODAY)).toBe(word);
});

test('SV-220: the quiet line names the accounts Jobs reads and its earliest month, never a number of applications (D314)', () => {
  expect(movementFoot(['Jobs', 'Personal'], '2026-03-02T09:00:00.000Z', ZONE)).toBe('Reading Jobs and Personal, since Mar 2026');
  expect(movementFoot(['Jobs', 'Personal', 'Work'], null, ZONE)).toBe('Reading Jobs, Personal and Work');
  expect(movementFoot(['Jobs'], '2026-03-01T03:00:00.000Z', ZONE)).toBe('Reading Jobs, since Feb 2026');
  expect(movementFoot([], null, ZONE)).toBe('Reading no accounts');
});

const MOVE: JobMoveOut = {application_id: 7, company: 'Northwind Talent', title: 'Software Engineer I', from: 'applied', to: 'rejected', by_hand: false, at: '2026-10-06T17:00:00.000Z'};

test('SV-220: a row reads the company, "Applied → Rejected", the day and the role; a press opens it and a right-click asks for the menu', async () => {
  const onOpen = vi.fn();
  const onMenu = vi.fn((event: {preventDefault: () => void}) => event.preventDefault());
  const moves: JobMoveOut[] = [MOVE, {...MOVE, application_id: 8, company: 'Contoso', to: 'ghosted'}, {...MOVE, application_id: 9, company: 'Fabrikam', from: null, to: 'applied'},
    {...MOVE, application_id: 10, company: 'Woodgrove Bank', from: 'offer', to: 'withdrawn', by_hand: true}];
  await render(<ol className="nd-list" style={{width: 460}}>{moves.map(move => <li key={move.application_id}><MoveRow move={move} timeZone={ZONE} today={TODAY} onOpen={onOpen} onMenu={onMenu} /></li>)}</ol>);
  const rows = [...document.querySelectorAll<HTMLElement>('.jd-move')];
  expect(rows.map(row => row.textContent)).toEqual([
    'Northwind TalentApplied→RejectedYesterdaySoftware Engineer I',
    'ContosoApplied→GhostedYesterdaySoftware Engineer I',
    'FabrikamAppliedYesterdaySoftware Engineer I',
    'Woodgrove BankOffer→WithdrawnYesterdaySoftware Engineer I',
  ]);
  expect(rows[2]!.querySelector('.jd-arrow')).toBeNull();
  await expect.element(page.getByRole('img', {name: 'Set by you'})).toBeVisible();
  expect(rows[3]!.contains(page.getByRole('img', {name: 'Set by you'}).element())).toBe(true);
  await userEvent.click(rows[0]!);
  expect(onOpen).toHaveBeenCalledOnce();
  rows[0]!.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true}));
  expect(onMenu).toHaveBeenCalledOnce();
});

test('SV-220: the menu a pane row gets is the table row\'s without Not this posting and Look up the JD again', () => {
  const row = detailOf(null);
  const on = {
    pin: () => {}, editCompany: () => {}, editTitle: () => {}, setStatus: () => {}, merge: () => {}, notThisPosting: () => {}, lookUpAgain: () => {}, notAnApplication: () => {}, remove: () => {},
    open: () => {}, openPosting: () => {}, copy: () => {},
  };
  const ids = (spec: MenuSpec) => spec.entries.map(entry => (entry.kind === 'item' ? entry.id : entry.kind));
  const full = ids(rowMenu(row, [row], TODAY, on));
  expect(full).toEqual(['open', 'sep', 'pin', 'sep', 'company', 'title', 'status', 'merge', 'sep', 'not-this-posting', 'look-up', 'sep', 'not-an-application', 'delete', 'sep', 'copy']);
  expect(ids(rowMenu(row, [row], TODAY, on, true))).toEqual(full.filter((id, index) => !['not-this-posting', 'look-up'].includes(id) && index !== full.indexOf('look-up') + 1));
});

test('SV-220: every status a row can name reads at 4.5:1 on the list\'s panel, in Night and in Light (the sweep caught Light\'s Offer)', async () => {
  const sides = (['applied', 'in_process', 'offer', 'rejected', 'withdrawn', 'ghosted'] as const);
  const moving = still();
  await render(<div style={{background: 'var(--panel)'}}><ol className="nd-list">{sides.map((to, index) => <li key={to}><MoveRow move={{...MOVE, application_id: index + 1, from: null, to}} timeZone={ZONE} today={TODAY} onOpen={() => {}} onMenu={() => {}} /></li>)}</ol></div>);
  try {
    for (const theme of ['night', 'light'] as const) {
      applyTheme(document.documentElement, theme);
      const ratios = [...document.querySelectorAll<HTMLElement>('.jd-change > .sl')].map(side => contrastOf(side));
      expect(ratios.filter(ratio => ratio < 4.5), theme).toEqual([]);
    }
  } finally {
    applyTheme(document.documentElement, 'night');
    moving();
  }
});

test('SV-220: the table\'s Offer reads at 4.5:1 on an open row, in Night and in Light', async () => {
  const moving = still();
  await render(<div style={{background: 'var(--page)'}}><div style={{background: 'var(--sub3)'}}><span className="st"><span className="sl offer" data-text>Offer</span></span></div></div>);
  try {
    for (const theme of ['night', 'light'] as const) {
      applyTheme(document.documentElement, theme);
      expect(contrastOf(document.querySelector<HTMLElement>('[data-text]')!), theme).toBeGreaterThanOrEqual(4.5);
    }
  } finally {
    applyTheme(document.documentElement, 'night');
    moving();
  }
});

// ---- The Pinned shelf (SV-243, D504, #355): what's on it and in what order, and what's left to the table ----

/** A row as the table reads it: its company, applied day, status and pin; the rest doesn't matter here. */
const shelfRow = (id: number, company: string, applied: string, status: JobStatus, pinned: string | null = null) => ({
  id, company, title: 'Developer', applied_at: `2026-${applied}T12:00:00.000Z`, applied_on: `2026-${applied}`, status, ghosted: false,
  jd: {state: 'found'}, pinned_at: pinned === null ? null : `2026-10-07T${pinned}:00.000Z`,
}) as unknown as ApplicationRowOut;

const ROWS = [
  shelfRow(1, 'Alpine Ski House', '10-01', 'applied', '09:00'),
  shelfRow(2, 'Fabrikam', '10-05', 'applied'),
  shelfRow(3, 'Litware', '09-20', 'rejected', '11:00'),
  shelfRow(4, 'Contoso', '09-28', 'offer'),
  shelfRow(5, 'Northwind', '10-03', 'in_process', '10:00'),
  shelfRow(6, 'Trey Research', '09-25', 'rejected'),
];

const shelfNames = (rows: ApplicationRowOut[]) => rows.map(each => each.company);
const NEWEST: Sort = {key: 'applied', down: true};

describe('the shelf: every pinned row, newest pin first, whatever the filter and the sort', () => {
  test.each<[string, (each: ApplicationRowOut) => boolean, Sort]>([
    ['All, newest first', () => true, NEWEST],
    ['Offer, which holds none of them', each => each.status === 'offer', NEWEST],
    ['Rejected, by company', each => each.status === 'rejected', {key: 'company', down: false}],
    ['Applied, by status', each => each.status === 'applied', {key: 'status', down: true}],
  ])('%s', (_, filter, sort) => {
    expect(shelfNames(shelfAndTable(ROWS, ROWS.filter(filter), sort).shelf)).toEqual(['Litware', 'Northwind', 'Alpine Ski House']);
  });

  test('pinned at the same moment, the later id first, so the order never shuffles', () => {
    const same = [shelfRow(7, 'Coho Winery', '10-01', 'applied', '09:00'), shelfRow(8, 'Wingtip Toys', '10-02', 'applied', '09:00')];
    expect(shelfNames(shelfAndTable(same, same, NEWEST).shelf)).toEqual(['Wingtip Toys', 'Coho Winery']);
  });

  test('nothing pinned: no shelf', () => {
    const none = ROWS.map(each => ({...each, pinned_at: null}));
    expect(shelfAndTable(none, none, NEWEST).shelf).toEqual([]);
  });
});

describe('the table: the filter\'s rows by the sort, a pinned row on the shelf only', () => {
  test.each<[string, (each: ApplicationRowOut) => boolean, Sort, string[]]>([
    ['All, newest first', () => true, NEWEST, ['Fabrikam', 'Contoso', 'Trey Research']],
    ['All, by company', () => true, {key: 'company', down: false}, ['Contoso', 'Fabrikam', 'Trey Research']],
    ['Rejected', each => each.status === 'rejected', NEWEST, ['Trey Research']],
    ['In process, its one row pinned', each => each.status === 'in_process', NEWEST, []],
  ])('%s', (_, filter, sort, table) => {
    expect(shelfNames(shelfAndTable(ROWS, ROWS.filter(filter), sort).table)).toEqual(table);
  });
});
