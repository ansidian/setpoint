// SV-181: the .ics import review's own behaviour (ImportPane.tsx on importRun.ts, D437): past events
// start unticked, the rows and Tick all tick, the footer counts what's ticked, the calendar picked
// says how many it already holds and marks them, the checkboxes take its colour, and Cancel closes it.
// Sending is the browser check's (icsImport.spec.ts), with the server and Google's stand-in.
import type {CalendarOut, IcsEventOut, IcsReadOut} from '@setpoint/shared';
import {ICS_DROP_REASONS} from '@setpoint/shared';
import {afterEach, expect, test} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import '../../src/app/calendar/calendar.css';
import '../../src/app/settings/settings.css';
import {ImportPane} from '../../src/app/calendar/ImportPane.tsx';
import {closeReview, openReview, useImportReview} from '../../src/app/calendar/importRun.ts';
import {colour} from './colour.ts';

const calendar = (id: number, name: string, colour: CalendarOut['colour']): CalendarOut =>
  ({id, provider: 'google', account_id: 1, name, colour, position: id, visible: true, command: null});
const CALENDARS = [calendar(1, 'Personal', 'cool'), calendar(3, 'Jobs', 'violet')];
const event = (uid: string, title: string, fields: Partial<IcsEventOut> = {}): IcsEventOut => ({
  ical_uid: uid, sequence: 0, title, all_day: false, starts_at: '2026-10-15T16:00:00.000Z', ends_at: '2026-10-15T17:00:00.000Z', start_date: null, end_date: null,
  time_zone: null, place: null, address: null, description: null, url: null, transparency: 'transparent', reminders: [], recurrence: [], changes: [], past: false, existing: [], ...fields,
});
const READ: IcsReadOut = {
  events: [
    event('mixer', 'Welcome mixer', {starts_at: '2026-10-01T01:00:00.000Z', ends_at: '2026-10-01T03:00:00.000Z', past: true}),
    event('keynote', 'Opening keynote'),
    event('fair', 'Career fair', {existing: [3]}),
    event('lab', 'Lab hours', {recurrence: ['RRULE:FREQ=WEEKLY;COUNT=3']}),
  ],
  dropped: {...Object.fromEntries(ICS_DROP_REASONS.map(reason => [reason, 0])) as IcsReadOut['dropped'], cancelled: 1, categories: 4},
};

function Review() {
  const review = useImportReview();
  return review ? <div style={{display: 'flex', height: 640}}><ImportPane review={review} calendars={CALENDARS} fallback={1} timeZone="America/Los_Angeles" /></div> : <p>Closed</p>;
}

async function review() {
  openReview('northwind-devcon.ics', READ);
  await render(<Review />);
  return {
    importButton: page.getByRole('button', {name: /^Import \d+ events?$/}),
    row: (title: string) => page.getByRole('button', {name: new RegExp(`^${title}`)}),
  };
}

/** A row's line under its title, its spaces as typed (clock times have a narrow one before AM and PM). */
function lineOf(row: ReturnType<typeof page.getByRole>) {
  return () => row.element().querySelector('.line')?.textContent?.replace(/\s/g, ' ') ?? null;
}

afterEach(() => closeReview());

test('past events start unticked, and the footer counts what\'s ticked as rows and Tick all change it', async () => {
  const {importButton, row} = await review();
  await expect.element(page.getByText('Import northwind-devcon.ics')).toBeVisible();
  await expect.element(row('Welcome mixer')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(lineOf(row('Welcome mixer'))).toBe('Wed, Sep 30 · 6:00 – 8:00 PM · past');
  await expect.poll(lineOf(row('Lab hours'))).toBe('Thu, Oct 15 · 9:00 – 10:00 AM · repeats');
  await expect.element(importButton).toHaveTextContent('Import 3 events');
  await userEvent.click(row('Opening keynote'));
  await expect.element(row('Opening keynote')).toHaveAttribute('aria-pressed', 'false');
  await expect.element(importButton).toHaveTextContent('Import 2 events');
  await userEvent.click(page.getByRole('button', {name: 'Tick all'}));
  await expect.element(importButton).toHaveTextContent('Import 4 events');
  await userEvent.click(page.getByRole('button', {name: 'Untick all'}));
  await expect.element(importButton).toHaveTextContent('Import 0 events');
  await expect.element(importButton).toBeDisabled();
});

test('the calendar picked says how many of the ticked it already holds, marks them, and colours the checkboxes', async () => {
  const {row} = await review();
  const checkbox = () => row('Opening keynote').element().querySelector('.chk')!;
  await expect.element(page.getByText(/already on/)).not.toBeInTheDocument();
  await expect.poll(() => getComputedStyle(checkbox()).backgroundColor).toBe(colour('var(--cool)'));
  await userEvent.click(page.getByRole('button', {name: 'Calendar'}));
  await userEvent.click(page.getByRole('menuitemradio', {name: 'Jobs'}));
  await expect.element(page.getByText('1 already on Jobs (will update)')).toBeVisible();
  await expect.poll(lineOf(row('Career fair'))).toBe('Thu, Oct 15 · 9:00 – 10:00 AM · will update');
  // It eases to the new colour: polled until it's there.
  await expect.poll(() => getComputedStyle(checkbox()).backgroundColor).toBe(colour('var(--violet)'));
  // Unticked, it isn't counted.
  await userEvent.click(row('Career fair'));
  await expect.element(page.getByText(/already on/)).not.toBeInTheDocument();
});

test('what the file had that an import leaves out closes the list, and Cancel closes the review', async () => {
  await review();
  await expect.element(page.getByText('Left out: 1 event cancelled · categories on 4 events')).toBeVisible();
  await userEvent.click(page.getByRole('button', {name: /^Cancel/}));
  await expect.element(page.getByText('Closed')).toBeVisible();
});
