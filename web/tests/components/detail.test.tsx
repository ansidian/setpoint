// The floating detail's link (DetailContent.tsx; DESIGN.md #245, darma SV-77 and SV-179, D439): an
// event whose place has no link but which has its own (Google's source.url) gets a line of its own,
// `link` and the host with the whole link as its tip, and Open taking it to a new tab. A place that is
// a link keeps SV-77's line and its one Open, and a task or an event with no link has none. `O` and the
// card on the seed's Career fair stay in detail.spec.ts. D447 (amending SV-191's #306): a read-only
// event says so on its calendar's line, with why as its tip, and leaves out what it can't do.
import type {CalendarOut, ItemOut} from '@setpoint/shared';
import {SEED_TIME_ZONE} from '@setpoint/shared';
import {expect, test} from 'vitest';
import {page} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import '../../src/app/calendar/detail/detail.css';
import {DetailContent} from '../../src/app/calendar/detail/DetailContent.tsx';
import {ICONS} from '../../src/ui/glyphs.ts';
import {colour} from './colour.ts';

const CALENDAR: CalendarOut = {id: 2, provider: 'google', account_id: 1, name: 'Jobs', colour: 'good', position: 1, visible: true, listed: true, writable: true, command: null};
const URL_OF_FAIR = 'https://www.careers.example.edu/fair/fall-2026/schedule?track=engineering&day=1';

function event(fields: Partial<ItemOut>): ItemOut {
  return {
    key: '4', id: 4, calendar_id: 2, kind: 'event', title: 'Career fair', time_zone: SEED_TIME_ZONE, recurring: false, recurrence: null, occurrence_start: null,
    place: 'University Student Union', address: null, attendees: [], reminders: [], leave_reminder: false, project: null, done: false, done_at: null, command: null,
    all_day: false, starts_at: '2026-10-15T17:00:00.000Z', ends_at: '2026-10-15T21:00:00.000Z', start_date: null, end_date: null, due_date: null, due_at: null,
    read_only: false, due_string: null, time_to_leave: null, colour: null, labels: [], repeat: null, link: null, transparency: 'opaque', ...fields,
  };
}

/** The card as the floating detail draws it, its width the detail's own. */
async function card(item: ItemOut, calendar: CalendarOut = CALENDAR) {
  return render(
    <div className="fd" role="dialog" aria-label={item.title} style={{position: 'relative'}}>
      <div className="card float"><div className="fd-body"><div className="fd-layer in">
        <DetailContent target={{item, date: '2026-10-15', calendar}} timeZone={SEED_TIME_ZONE} onClose={() => {}} onEdit={() => {}} />
      </div></div></div>
    </div>,
  );
}

const opens = () => page.getByRole('link', {name: 'Open'});
const facts = () => [...document.querySelectorAll('.card-b .fact')].map(fact => fact.className);

test('an event\'s own link, with no link in its place: `link` and its host after the place, the whole link as its tip, and Open to a new tab', async () => {
  await card(event({link: URL_OF_FAIR}));
  const line = page.getByText('careers.example.edu');
  await expect.element(line).toHaveAttribute('data-tip', URL_OF_FAIR);
  await expect.element(page.getByText('University Student Union')).toBeVisible();
  // The place's line first, then the link's, before the calendar.
  expect(facts()).toEqual(['fact', 'fact link own', 'fact cal']);
  expect(document.querySelector('.fact.own .icon path')!.getAttribute('d')).toBe(ICONS.link);
  await expect.element(opens()).toHaveAttribute('href', URL_OF_FAIR);
  await expect.element(opens()).toHaveAttribute('target', '_blank');
  await expect.element(opens()).toHaveAttribute('rel', 'noopener noreferrer');
  expect(document.querySelectorAll('a.fd-open')).toHaveLength(1);
  // Open ends the line inside the card.
  const open = document.querySelector('.fact.own .fd-open')!.getBoundingClientRect();
  expect(open.right).toBeLessThanOrEqual(document.querySelector('.card-b')!.getBoundingClientRect().right);
});

test('a place that is a link keeps its own line and one Open, even beside the event\'s own link', async () => {
  await card(event({place: 'https://meet.example.com/j/81234567890', link: 'https://meet.example.com/j/81234567890'}));
  await expect.element(page.getByText('meet.example.com')).toBeVisible();
  expect(facts()).toEqual(['fact link', 'fact cal']);
  expect(document.querySelectorAll('a.fd-open')).toHaveLength(1);
  await expect.element(opens()).toHaveAttribute('href', 'https://meet.example.com/j/81234567890');
});

test('an event with no link, or a link that isn\'t http or https, has no Open', async () => {
  await card(event({link: null}));
  await expect.element(page.getByText('University Student Union')).toBeVisible();
  expect(document.querySelector('a.fd-open')).toBeNull();
  expect(facts()).toEqual(['fact', 'fact cal']);
});

test('a link the server wouldn\'t send (javascript:) is never drawn as one', async () => {
  await card(event({link: 'javascript:alert(1)'}));
  await expect.element(page.getByText('University Student Union')).toBeVisible();
  expect(document.querySelector('a.fd-open')).toBeNull();
});

test('D447: a read-only event says so on its calendar\'s line, the reason as its tip, and leaves out Edit and the actions, the row going with nothing left', async () => {
  const holidays = {...CALENDAR, name: 'Holidays in United States', writable: false};
  const screen = await card(event({read_only: true}), holidays);
  const line = page.getByText('Read-only · Holidays in United States');
  await expect.element(line).toHaveAttribute('data-tip', 'This calendar is read-only');
  expect(document.querySelector('.fact.cal .icon path')!.getAttribute('d')).toBe(ICONS.lock);
  // The glyph keeps the calendar's colour, as any calendar line's.
  expect(getComputedStyle(document.querySelector('.fact.cal .icon')!).color).toBe(colour('var(--good)'));
  expect(document.querySelector('.card-acts')).toBeNull();
  await screen.unmount();
  // One of Google's own kinds, on a calendar the user can write: Google's reason.
  await card(event({read_only: true}));
  await expect.element(page.getByText('Read-only · Jobs')).toHaveAttribute('data-tip', 'Google doesn\'t let this kind of event change');
  expect(document.querySelector('.card-acts')).toBeNull();
});

test('D447: off Calendar, a read-only event\'s card keeps Open in Calendar and nothing it can\'t do; a writable one keeps its calendar line and Edit', async () => {
  const screen = await render(
    <div className="fd" role="dialog" aria-label="Veterans Day" style={{position: 'relative'}}>
      <div className="card float"><div className="fd-body"><div className="fd-layer in">
        <DetailContent target={{item: event({read_only: true}), date: '2026-10-15', calendar: {...CALENDAR, writable: false}}} timeZone={SEED_TIME_ZONE}
          actions={{complete: () => {}, open: () => {}, remove: () => {}}} onClose={() => {}} onEdit={() => {}} />
      </div></div></div>
    </div>,
  );
  await expect.element(page.getByRole('button', {name: 'Open in Calendar'})).toBeVisible();
  expect([...document.querySelectorAll('.card-acts button')].map(button => button.getAttribute('aria-label'))).toEqual(['Open in Calendar']);
  await screen.unmount();
  await card(event({}));
  await expect.element(page.getByRole('button', {name: /^Edit/})).toBeVisible();
  expect(document.querySelector('.fact.cal .icon path')!.getAttribute('d')).toBe(ICONS.calendar_today);
  expect(page.getByText(/Read-only/).query()).toBeNull();
});

// SV-197 (#308): the title wraps, up to 3 lines, on the 360 px card, the dot and Close on its first line.
const LONG = 'Interview with the hiring committee for Associate Software Engineer at Contoso, round two, with the team leads and a short tour of the office afterwards';
const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
const lines = () => Math.round((box('.fd-title').height - 4) / 22);

test('SV-197: a title wraps rather than being cut, and stops at 3 lines with an ellipsis, the whole title its tip', async () => {
  const screen = await card(event({title: 'Daylight Saving Time ends in the United States today'}));
  const title = page.getByText('Daylight Saving Time ends in the United States today');
  await expect.element(title).toBeVisible();
  expect(lines()).toBe(2);
  const whole = document.querySelector<HTMLElement>('.fd-title')!;
  expect(whole.scrollHeight).toBeLessThanOrEqual(whole.clientHeight);
  await screen.unmount();
  await card(event({title: LONG}));
  await expect.element(page.getByText(LONG)).toHaveAttribute('data-tip', LONG);
  expect(lines()).toBe(3);
  const cut = document.querySelector<HTMLElement>('.fd-title')!;
  expect(cut.scrollHeight).toBeGreaterThan(cut.clientHeight);
});

test('SV-197: the dot and Close sit on the title\'s first line, wrapped or not', async () => {
  for (const title of ['Career fair', LONG]) {
    const screen = await card(event({title}));
    await expect.element(page.getByText(title)).toBeVisible();
    const first = box('.fd-title').top + 2 + 11;
    const middle = (rect: DOMRect) => rect.top + rect.height / 2;
    expect(Math.abs(middle(box('.fd-mark .dot')) - first)).toBeLessThanOrEqual(1);
    expect(Math.abs(middle(box('.card-h [aria-label="Close"]')) - first)).toBeLessThanOrEqual(1);
    await screen.unmount();
  }
});

test('SV-197: on the 360 px card a read-only holiday\'s calendar line fits on one line', async () => {
  await card(event({read_only: true}), {...CALENDAR, name: 'Holidays in United States', writable: false});
  const line = page.getByText('Read-only · Holidays in United States');
  await expect.element(line).toBeVisible();
  expect(box('.fact.cal > span').height).toBeLessThanOrEqual(box('.fact.cal .icon').height + 4);
});
