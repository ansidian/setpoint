// Jobs's widgets (J5; DESIGN.md › Jobs): Per week's chart, the status filter and the full posting
// unfolding in place (board 33). What they do with the props and the pointer or keys they're given; the
// page around them, its keys and the server are jobs.spec.ts's. This file imports Jobs's folder, so
// it's one of Jobs's wiring points (server/src/jobs/README.md).
import type {JobCountsOut, JobWeekOut, PostingOut} from '@setpoint/shared';
import {createRef, useState} from 'react';
import {expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import '../../src/app/jobs/jobs.css';
import {FullPosting} from '../../src/app/jobs/FullPosting.tsx';
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
  await expect.element(row).toHaveTextContent('Full posting· Found on Greenhouse · Oct 1, 10:41 AMgreenhouse.exampleShow');
  await expect.element(row.getByRole('link', {name: 'greenhouse.example'})).toHaveAttribute('href', POSTING.link);
  await row.getByRole('button', {name: 'Show'}).click();

  await expect.element(page.getByRole('button', {name: 'Collapse'})).toHaveAttribute('aria-expanded', 'true');
  await expect.element(page.getByText('· Software Engineer I · Northwind Talent')).toBeInTheDocument();
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
