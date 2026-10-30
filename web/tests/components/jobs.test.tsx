// Jobs's widgets (J5, J6; DESIGN.md › Jobs): Per week's chart, the status filter and the full posting
// unfolding in place (board 33); J6's menus with their keys and submenus, the candidate picker and the
// title's field (boards 34a, 35a, 35b). What they do with the props and the pointer or keys they're given; the
// page around them, its keys and the server are jobs.spec.ts's. This file imports Jobs's folder, so
// it's one of Jobs's wiring points (server/src/jobs/README.md).
import type {JdCandidateOut, JobCountsOut, JobWeekOut, PostingOut} from '@setpoint/shared';
import {createRef, useRef, useState} from 'react';
import {expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import '../../src/app/jobs/jobs.css';
import {CandidatePicker} from '../../src/app/jobs/CandidatePicker.tsx';
import {EditField} from '../../src/app/jobs/EditField.tsx';
import {FullPosting} from '../../src/app/jobs/FullPosting.tsx';
import {JobsMenu} from '../../src/app/jobs/Menu.tsx';
import type {MenuSpec} from '../../src/app/jobs/Menu.tsx';
import type {FullPostingHandle} from '../../src/app/jobs/FullPosting.tsx';
import {PerWeek} from '../../src/app/jobs/PerWeek.tsx';
import {StatusFilter} from '../../src/app/jobs/StatusFilter.tsx';
import type {Filter} from '../../src/app/jobs/words.ts';
import {colour} from './colour.ts';

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
  summary: 'A new-grad engineer for the hiring-platform team.', location: 'Irvine, CA', workplace: 'hybrid', workplace_detail: '3 days', salary: '$95,000–$115,000',
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
  {id: 1, title: 'Junior Developer', location: 'New York, NY', platform: 'Greenhouse', link: 'https://greenhouse.example/lucernepublishing/jobs/5520391'},
  {id: 2, title: 'Junior Developer, Digital', location: 'Remote', platform: 'LinkedIn', link: 'https://linkedin.example/jobs/view/3981204417'},
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

test('the candidates are radios, the last None of these; ↑ ↓ choose and Enter picks, and picked the group takes good with "JD saved"', async () => {
  const onPick = vi.fn();
  const onNone = vi.fn();
  await render(<Picked active={false} onPick={onPick} onNone={onNone} />);
  const group = page.getByRole('radiogroup', {name: 'Is this the posting?'});
  expect(group.getByRole('radio').all().map(radio => radio.element().textContent)).toEqual(['Junior Developer · New York, NY · Greenhouse', 'Junior Developer, Digital · Remote · LinkedIn', 'None of these']);
  // Each arrow opens its posting without picking it.
  await expect.element(group.getByRole('link', {name: 'Look at Junior Developer, Digital'})).toHaveAttribute('href', CANDIDATES[1]!.link);
  await group.getByRole('radio').first().element().focus();
  await userEvent.keyboard('{ArrowDown}');
  await expect.element(group.getByRole('radio').nth(1)).toHaveFocus();
  await expect.poll(() => getComputedStyle(group.getByRole('radio').nth(1).element().parentElement!).backgroundColor).toBe(colour('var(--sub2)'));
  await userEvent.keyboard('{Enter}');
  expect(onPick.mock.calls.map(([candidate]) => candidate.id)).toEqual([2]);
  await expect.element(group.getByRole('radio').nth(1)).toHaveTextContent('Junior Developer, Digital · JD saved');
  expect(group.getByRole('radio').nth(1).element().getAttribute('aria-checked')).toBe('true');
  await expect.poll(() => getComputedStyle(group.element()).backgroundColor).toBe(colour('color-mix(in oklch, var(--good) 10%, transparent)'));
  // Picked, it answers nothing more.
  await userEvent.keyboard('{ArrowDown}{Enter}');
  expect(onPick).toHaveBeenCalledTimes(1);
  expect(onNone).not.toHaveBeenCalled();
});

test('while its item has the page\'s cursor, ↑ ↓ and Enter reach it from the page: up from the top is None of these', async () => {
  const onNone = vi.fn();
  await render(<Picked active onPick={() => {}} onNone={onNone} />);
  await userEvent.keyboard('{ArrowUp}');
  expect(document.querySelector('.jb-cand.cur')?.textContent).toBe('None of these');
  await userEvent.keyboard('{Enter}');
  expect(onNone).toHaveBeenCalledTimes(1);
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
