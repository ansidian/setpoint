// SV-181: importing an .ics file from Calendar (D436, D437), with Google's stand-in (the dev
// provider, which refuses "Poster session" the first time it's sent). The journey: a conference's
// schedule dropped on the grid, reviewed in the right pane (its past event unticked, the Career fair
// already on Jobs), imported one at a time, a refused event retried, the events on the grid, and
// Undo taking back only the ones the import made. Then one event from the header's Import .ics…,
// opened in the editor and created there; and ⌘K's Import .ics… with files that can't be imported.
// SV-182: the same from an email's .ics tile, Add to calendar reading the stored attachment on the
// server (the dev provider serves src/dev/icsFiles.ts by name): the seed's interview invite into the
// editor, and, linked to that email by SQL, a schedule into the review, one that only cancels, and
// one that can't be read, said in place.
// SV-190: while a file is dragged over the grid it lights and says whether it will import (DESIGN.md
// #305): leaving, Esc or the drop clears it; a PDF or several files are refused before the drop; the
// review takes none; and at 820 wide the pill centres beside the open review.
// The list's own behaviour (ticks, counts, the picker) is the component test's (importPane.test.tsx).
import assert from 'node:assert/strict';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {after} from 'node:test';
import type {ItemsOut} from '@setpoint/shared';
import type {Locator, Page} from 'playwright-core';
import {cleanUp, rested, startSetpoint, test, until} from './harness.ts';
import type {Setpoint} from './harness.ts';

after(cleanUp);

const file = (lines: string[]) => `${['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Example Events//Schedule Export//EN', ...lines, 'END:VCALENDAR'].join('\r\n')}\r\n`;
const session = (uid: string, title: string, start: string, end: string, extra: string[] = []) => [
  'BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20261001T120000Z', `DTSTART:${start}`, `DTEND:${end}`, `SUMMARY:${title}`,
  'LOCATION:Main Hall\\, Northwind Conference Center', 'CATEGORIES:Sessions', 'TRANSP:TRANSPARENT', ...extra, 'END:VEVENT',
];
// Invented: Northwind DevCon on the seed's Oct 15 and 16 (the seed's clock is Oct 7), with the seed's
// Career fair (its iCalUID is the seed's) an hour longer, and a cancelled talk.
const SCHEDULE = file([
  'METHOD:PUBLISH',
  ...session('welcome@devcon.example.com', 'Welcome mixer', '20261001T010000Z', '20261001T030000Z'),
  ...session('keynote@devcon.example.com', 'Opening keynote', '20261015T160000Z', '20261015T170000Z'),
  ...session('poster@devcon.example.com', 'Poster session', '20261015T180000Z', '20261015T190000Z'),
  ...session('career-fair-fall-2026@careers.example.edu', 'Career fair', '20261015T170000Z', '20261015T220000Z'),
  ...session('lab@devcon.example.com', 'Lab hours', '20261016T160000Z', '20261016T170000Z', ['RRULE:FREQ=WEEKLY;COUNT=3']),
  'BEGIN:VEVENT', 'UID:gone@devcon.example.com', 'DTSTAMP:20261001T120000Z', 'DTSTART:20261016T200000Z', 'STATUS:CANCELLED', 'SUMMARY:Cancelled talk', 'END:VEVENT',
]);
const INVITE = file([
  'METHOD:REQUEST',
  'BEGIN:VEVENT', 'UID:interview-7f3a9c@jobs.example.com', 'DTSTAMP:20261004T150000Z', 'SUMMARY:Interview with Contoso',
  'DTSTART:20261020T210000Z', 'DTEND:20261020T213000Z', 'LOCATION:https://meet.example.com/j/482-193-775', 'DESCRIPTION:Your interview is confirmed.',
  'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT30M', 'END:VALARM', 'END:VEVENT',
]);

/** A day's items as the API has them: "Career fair 10:00 AM – 3:00 PM", with any change still on its way. */
async function day(setpoint: Setpoint, date: string) {
  const next = new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const {items} = await setpoint.api<ItemsOut>('GET', `/items?from=${date}&to=${next}`);
  const time = (at: string) => new Date(at).toLocaleTimeString('en-US', {timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit'}).replace(/\s/g, ' ');
  return items.map(item => ({
    line: `${item.title}${item.starts_at ? ` ${time(item.starts_at)} – ${time(item.ends_at!)}` : ''}`, state: item.command?.state ?? null, reminders: item.reminders,
  }));
}
const lines = async (setpoint: Setpoint, date: string) => (await day(setpoint, date)).map(item => item.line);

async function openCalendar(page: Page, base: string) {
  await page.goto(`${base}/calendar`);
  await page.locator('.ag-item', {hasText: 'Dentist'}).waitFor();
}

/** A file as a drag carries it: its name, its text and the type the browser gives it. */
interface Dragged {
  name: string;
  text: string;
  type: string;
}
const ics = (name: string, text: string): Dragged => ({name, text, type: 'text/calendar'});

/**
 * One drag event on `target` carrying `files`, as the browser hands it over (a real drag shows only
 * each file's kind and type before the drop, which is all the page reads then). `to` is where a
 * dragleave goes; null is out of the window, or Esc. Says what the page answered: the drop effect,
 * and whether it took the event.
 */
async function dragEvent(target: Locator, type: 'dragenter' | 'dragover' | 'dragleave' | 'drop', files: Dragged[], to: Locator | null = null) {
  const related = to && await to.elementHandle();
  return target.evaluate((element, {type, files, related}) => {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(new File([file.text], file.name, {type: file.type}));
    // Chromium keeps a drop effect only on a real drag's transfer, so this one records what the page sets.
    let effect = 'unset';
    Object.defineProperty(transfer, 'dropEffect', {get: () => effect, set: (value: string) => effect = value});
    const event = new DragEvent(type, {dataTransfer: transfer, bubbles: true, cancelable: true, relatedTarget: related});
    element.dispatchEvent(event);
    return {effect, taken: event.defaultPrevented};
  }, {type, files, related});
}

/** Files dragged onto `target`, as they come in: an enter, then an over, whose answer it returns. */
async function enter(target: Locator, files: Dragged[]) {
  await dragEvent(target, 'dragenter', files);
  return dragEvent(target, 'dragover', files);
}

/** Files dragged off `target`, to `to` (null: out of the window, or Esc). */
const leave = (target: Locator, files: Dragged[], to: Locator | null = null) => dragEvent(target, 'dragleave', files, to);

/** A file dropped on the month grid, as the browser hands one over. */
async function drop(page: Page, name: string, text: string) {
  const grid = page.locator('.cal-month');
  await enter(grid, [ics(name, text)]);
  await dragEvent(grid, 'drop', [ics(name, text)]);
}

/** The pill at the grid's centre while a file is over it. */
const dropTip = (page: Page, line: string) => page.getByRole('status').filter({hasText: line});

const row = (page: Page, title: string) => page.locator('.cal-import .imp-item', {has: page.locator('.title', {hasText: title})});

test('SV-181: a schedule dropped on the grid is reviewed, imported one at a time, a refused event retried, and Undo takes back only what it made', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await drop(page, 'northwind-devcon.ics', SCHEDULE);
    const pane = page.getByRole('region', {name: 'Import events'});
    await pane.getByText('Import northwind-devcon.ics').waitFor();
    // The past mixer starts unticked; nothing went to Google.
    assert.equal(await row(page, 'Welcome mixer').locator('.imp-row').getAttribute('aria-pressed'), 'false');
    await row(page, 'Welcome mixer').getByText('Wed, Sep 30 · 6:00 – 8:00 PM · past').waitFor();
    await pane.getByText('Left out: 1 event cancelled · categories on 5 events').waitFor();
    assert.deepEqual(await lines(setpoint, '2026-10-15'), ['Career fair 10:00 AM – 2:00 PM', 'CS 101 lecture 6:00 PM – 7:15 PM']);
    // Into Jobs, which already holds the Career fair: it will be updated, not made twice.
    await pane.getByRole('button', {name: 'Calendar'}).click();
    await page.getByRole('menuitemradio', {name: 'Jobs'}).click();
    await pane.getByText('1 already on Jobs (will update)').waitFor();

    await pane.getByRole('button', {name: 'Import 4 events'}).click();
    // Google refuses the poster session: it stays, with Google's words and Retry, and the rest go in.
    await row(page, 'Poster session').getByText('Invalid start time. (400 Bad Request)').waitFor({timeout: 20_000});
    await pane.getByRole('status').filter({hasText: '1 event wasn\'t imported'}).waitFor();
    await page.locator('.toast', {hasText: 'Imported 3 events to Jobs'}).waitFor();
    // The review is the one place to retry it while it's open: the grid's failed card waits.
    assert.equal(await page.locator('.failed-card').count(), 0);
    await row(page, 'Poster session').getByRole('button', {name: 'Retry'}).click();
    await page.locator('.toast', {hasText: 'Imported 4 events to Jobs'}).waitFor({timeout: 10_000});
    await pane.waitFor({state: 'detached'});

    await until('the import on Oct 15', () => day(setpoint, '2026-10-15'), items => items.every(item => item.state === null) && items.length === 4);
    assert.deepEqual(await lines(setpoint, '2026-10-15'), [
      'Opening keynote 9:00 AM – 10:00 AM', 'Career fair 10:00 AM – 3:00 PM', 'Poster session 11:00 AM – 12:00 PM', 'CS 101 lecture 6:00 PM – 7:15 PM',
    ]);
    await page.locator('.cell[data-date="2026-10-16"] .ev', {hasText: 'Lab hours'}).waitFor();
    await page.locator('.cell[data-date="2026-10-23"] .ev', {hasText: 'Lab hours'}).waitFor();
    // The past mixer, unticked, wasn't sent.
    assert.ok(!(await lines(setpoint, '2026-09-30')).some(line => line.startsWith('Welcome mixer')));

    // Undo: the three it made go; the Career fair it updated stays as it now is.
    await page.locator('.toast').getByRole('button', {name: 'Undo'}).click();
    await until('Undo on Oct 15', () => lines(setpoint, '2026-10-15'), now => now.length === 2);
    assert.deepEqual(await lines(setpoint, '2026-10-15'), ['Career fair 10:00 AM – 3:00 PM', 'CS 101 lecture 6:00 PM – 7:15 PM']);
    await until('Undo on Oct 16', () => lines(setpoint, '2026-10-16'), now => !now.some(line => line.startsWith('Lab hours')));
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-181: one event, picked with Import .ics…, opens the editor filled in, and Create imports it with its own reminder', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', {name: 'Import .ics…'}).click();
    await (await chooser).setFiles({name: 'invite.ics', mimeType: 'text/calendar', buffer: Buffer.from(INVITE)});
    const editor = page.locator('.editor');
    await editor.getByText('Create event').waitFor();
    assert.deepEqual([await page.getByLabel('Date', {exact: true}).inputValue(), await page.getByLabel('Start', {exact: true}).inputValue(), await page.getByLabel('End', {exact: true}).inputValue(), await page.getByLabel('Place', {exact: true}).inputValue()],
      ['Tue, Oct 20', '2:00 PM', '2:30 PM', 'https://meet.example.com/j/482-193-775']);
    // The file's own reminder, not Settings' default.
    await editor.locator('.qchip', {hasText: '30 min before'}).waitFor();
    await page.locator('.cell[data-date="2026-10-20"] .ev.ghost', {hasText: 'Interview with Contoso'}).waitFor();
    await editor.getByRole('button', {name: /^Create event/}).click();
    await page.locator('.toast', {hasText: 'Imported Interview with Contoso to Personal'}).waitFor({timeout: 10_000});
    const imported = await until('the interview on Oct 20', () => day(setpoint, '2026-10-20'), items => items.some(item => item.line.startsWith('Interview') && item.state === null));
    assert.deepEqual(imported.filter(item => item.line.startsWith('Interview')), [{line: 'Interview with Contoso 2:00 PM – 2:30 PM', state: null, reminders: [30]}]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-181: ⌘K\'s Import .ics… with a file that can\'t be read, or has nothing to import, says so and sends nothing', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    const pick = async (name: string, text: string) => {
      const chooser = page.waitForEvent('filechooser');
      await page.keyboard.press('Meta+k');
      await page.locator('.palette input').fill('import');
      await page.locator('.palette .item', {hasText: 'Import .ics…'}).click();
      await (await chooser).setFiles({name, mimeType: 'text/calendar', buffer: Buffer.from(text)});
    };
    await pick('notes.ics', 'not a calendar at all');
    await page.locator('.toast', {hasText: 'This file can\'t be read, it isn\'t an .ics calendar'}).waitFor();
    await pick('cancelled.ics', file([
      'METHOD:CANCEL', 'BEGIN:VEVENT', 'UID:interview-7f3a9c@jobs.example.com', 'DTSTAMP:20261005T150000Z', 'DTSTART:20261020T210000Z', 'SUMMARY:Interview with Contoso', 'END:VEVENT',
    ]));
    await page.locator('.toast', {hasText: 'Nothing to import, the file has 1 event cancelled'}).waitFor();
    assert.equal(await page.locator('.cal-import, .editor').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-190: a file dragged over the grid says it will import, leaving or Esc clears it, and a file that isn\'t an .ics is refused before the drop', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    const grid = page.locator('.cal-month');
    const cell = grid.locator('.cell[data-date="2026-10-15"]');
    const invite = [ics('invite.ics', INVITE)];
    assert.deepEqual(await enter(grid, invite), {effect: 'copy', taken: true});
    await dropTip(page, 'Drop to import .ics').waitFor();
    await page.locator('.cal-month[data-file-drop="ics"]').waitFor();
    // Crossing into a day keeps it: the day's enter comes before the grid's leave.
    await dragEvent(cell, 'dragenter', invite);
    await leave(grid, invite, cell);
    // Nothing should clear: a pause for it to have done so.
    await page.waitForTimeout(150);
    await setpoint.idle();
    assert.equal(await grid.getAttribute('data-file-drop'), 'ics');
    // Out of the window, or Esc: a leave with nothing after it.
    await leave(cell, invite);
    await page.locator('.cal-month[data-file-drop]').waitFor({state: 'detached'});
    await dropTip(page, 'Drop to import .ics').waitFor({state: 'detached'});

    // A PDF is refused before the drop: the pill alone, and the drop does nothing.
    const agenda = [{name: 'agenda.pdf', text: '%PDF-1.7', type: 'application/pdf'}];
    assert.deepEqual(await enter(grid, agenda), {effect: 'none', taken: true});
    await dropTip(page, 'Only an .ics file imports').waitFor();
    assert.equal(await grid.getAttribute('data-file-drop'), 'other');
    // A browser sends no drop after "none"; one sent anyway imports nothing and says nothing.
    await dragEvent(grid, 'drop', agenda);
    await dropTip(page, 'Only an .ics file imports').waitFor({state: 'detached'});
    // Nothing should open or be said: a pause for it to have done so.
    await page.waitForTimeout(150);
    await setpoint.idle();
    assert.equal(await page.locator('.toast', {hasText: 'agenda.pdf'}).count(), 0);
    assert.equal(await page.locator('.cal-import, .editor').count(), 0);

    // Two files at once, on the week: refused the same way.
    await page.keyboard.press('w');
    const week = page.locator('.cal-week');
    await week.waitFor();
    const two = [ics('invite.ics', INVITE), ics('northwind-devcon.ics', SCHEDULE)];
    assert.deepEqual(await enter(week, two), {effect: 'none', taken: true});
    await dropTip(page, 'One .ics file at a time').waitFor();
    assert.equal(await week.getAttribute('data-file-drop'), 'several');
    await leave(week, two);
    await dropTip(page, 'One .ics file at a time').waitFor({state: 'detached'});
    assert.deepEqual(await enter(week, invite), {effect: 'copy', taken: true});
    await page.locator('.cal-week[data-file-drop="ics"]').waitFor();
    await leave(week, invite);
    await page.locator('.cal-week[data-file-drop]').waitFor({state: 'detached'});
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-190: at 820 wide the pill centres beside the open review, and the review takes no file', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page({width: 820, height: 760});
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.cell[data-date="2026-10-07"] .ev', {hasText: 'Dentist'}).waitFor();
    await drop(page, 'northwind-devcon.ics', SCHEDULE);
    const pane = page.getByRole('region', {name: 'Import events'});
    await pane.getByText('Import northwind-devcon.ics').waitFor();
    const invite = [ics('invite.ics', INVITE)];
    // Over the review, a file is refused and nothing lights.
    assert.deepEqual(await enter(pane, invite), {effect: 'none', taken: true});
    await leave(pane, invite);
    assert.equal(await page.locator('[data-file-drop]').count(), 0);

    const grid = page.locator('.cal-month');
    await enter(grid, invite);
    const tip = dropTip(page, 'Drop to import .ics');
    await tip.waitFor();
    const box = (locator: Locator) => locator.evaluate(element => element.getBoundingClientRect().toJSON() as {left: number; right: number});
    const [tipBox, paneBox, gridBox] = await rested(() => Promise.all([box(tip), box(pane), box(grid)]));
    assert.ok(tipBox.right <= paneBox.left, `the pill (${tipBox.left}–${tipBox.right}) lies left of the pane (${paneBox.left})`);
    // At the centre of the grid the pane leaves uncovered.
    assert.ok(Math.abs((tipBox.left + tipBox.right) / 2 - (gridBox.left + paneBox.left) / 2) <= 1);
    await leave(grid, invite);
    await tip.waitFor({state: 'detached'});
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

/** The seed's interview confirmation (Done, so in All mail), with any more .ics files linked to it. */
function interviewEmail(setpoint: Setpoint, more: string[] = []) {
  const database = new DatabaseSync(path.join(setpoint.dataDir, 'setpoint.sqlite'));
  try {
    database.exec('PRAGMA busy_timeout = 5000');
    const {id} = database.prepare('SELECT id FROM messages WHERE subject = ?').get('Interview confirmed: Data Engineer I') as {id: number};
    const insert = database.prepare('INSERT INTO attachments (message_id, provider_id, filename, mime_type, size_bytes) VALUES (?, ?, ?, ?, 900)');
    more.forEach((filename, index) => insert.run(id, `sv182-${index}`, filename, 'text/calendar'));
    return id;
  } finally {
    database.close();
  }
}

async function openEmail(page: Page, base: string, id: number) {
  await page.goto(`${base}/inbox/${id}`);
  await page.locator('.rd-subj', {hasText: 'Interview confirmed: Data Engineer I'}).waitFor();
}

const invitation = (page: Page, filename: string) => page.locator('.attach[data-type="calendar"]', {hasText: filename});

test('SV-182: an email\'s invite has Add to calendar, which opens Calendar on its day with the editor filled in, and Create imports it', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await openEmail(page, setpoint.base, interviewEmail(setpoint));
    await invitation(page, 'invite.ics').getByRole('button', {name: 'Add to calendar'}).click();
    const editor = page.locator('.editor');
    await editor.getByText('Create event').waitFor();
    assert.equal(new URL(page.url()).pathname, '/calendar/2026-10-20');
    assert.deepEqual([await page.getByLabel('Date', {exact: true}).inputValue(), await page.getByLabel('Start', {exact: true}).inputValue(), await page.getByLabel('End', {exact: true}).inputValue(), await page.getByLabel('Place', {exact: true}).inputValue()],
      ['Tue, Oct 20', '2:00 PM', '2:45 PM', 'https://meet.example.com/j/615-204-883']);
    await editor.locator('.qchip', {hasText: '30 min before'}).waitFor();
    await page.locator('.cell[data-date="2026-10-20"] .ev.ghost', {hasText: 'Interview with Trey Research'}).waitFor();
    await editor.getByRole('button', {name: /^Create event/}).click();
    await page.locator('.toast', {hasText: 'Imported Interview with Trey Research: Data Engineer I to Personal'}).waitFor({timeout: 10_000});
    const imported = await until('the interview on Oct 20', () => day(setpoint, '2026-10-20'), items => items.some(item => item.line.startsWith('Interview') && item.state === null));
    assert.deepEqual(imported.filter(item => item.line.startsWith('Interview')), [{line: 'Interview with Trey Research: Data Engineer I 2:00 PM – 2:45 PM', state: null, reminders: [30]}]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-182: an email\'s schedule opens the review on its first day, one that only cancels says so in the toast, and one that can\'t be read says so on its tile', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await openEmail(page, setpoint.base, interviewEmail(setpoint, ['notes.ics', 'cancelled.ics', 'northwind-devcon.ics']));

    // The parser's line, in place of the file's size; nothing else moves.
    await invitation(page, 'notes.ics').getByRole('button', {name: 'Add to calendar'}).click();
    await invitation(page, 'notes.ics').getByRole('alert').filter({hasText: 'This file can\'t be read, it isn\'t an .ics calendar'}).waitFor();
    await invitation(page, 'cancelled.ics').getByRole('button', {name: 'Add to calendar'}).click();
    await page.locator('.toast', {hasText: 'Nothing to import, the file has 1 event cancelled'}).waitFor();
    assert.equal(new URL(page.url()).pathname.startsWith('/inbox/'), true);

    await invitation(page, 'northwind-devcon.ics').getByRole('button', {name: 'Add to calendar'}).click();
    const pane = page.getByRole('region', {name: 'Import events'});
    await pane.getByText('Import northwind-devcon.ics').waitFor();
    assert.equal(new URL(page.url()).pathname, '/calendar/2026-10-15');
    assert.deepEqual(await pane.locator('.imp-item .title').allTextContents(), ['Opening keynote', 'Hiring panel', 'Closing remarks']);
    await pane.getByRole('button', {name: 'Import 3 events'}).click();
    await page.locator('.toast', {hasText: 'Imported 3 events to Personal'}).waitFor({timeout: 20_000});
    await until('the schedule on Oct 15', () => day(setpoint, '2026-10-15'), items => items.length === 4 && items.every(item => item.state === null));
    assert.deepEqual(await lines(setpoint, '2026-10-15'), ['Opening keynote 9:00 AM – 10:00 AM', 'Career fair 10:00 AM – 2:00 PM', 'Hiring panel 1:00 PM – 2:00 PM', 'CS 101 lecture 6:00 PM – 7:15 PM']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
