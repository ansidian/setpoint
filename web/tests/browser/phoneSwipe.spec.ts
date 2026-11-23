// The phone Inbox's swipes and Select at 390 × 844, driven by the pointer events a finger sends:
// right marks read and unread, left rests open on Pin, Done and Trash or, swiped all the way,
// trashes with Undo, a press at the screen's edge is Safari's; Select's circles, its bar in the tab
// bar's place, and a batch's one toast whose Undo puts every email back.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {AllOut, InboxOut} from '@setpoint/shared';
import {cleanUp, holdToast, startSetpoint, test, until} from './harness.ts';
import type {Setpoint} from './harness.ts';
import {counts, email, inbox, swipe} from './phoneHelpers.ts';

after(cleanUp);

const allRows = async (setpoint: Setpoint) => (await setpoint.api<AllOut>('GET', '/mail/all?limit=500')).days.flatMap(day => day.rows);
const idFrom = async (setpoint: Setpoint, sender: string) => (await allRows(setpoint)).find(row => row.from_name === sender)!.id;
const inAll = async (setpoint: Setpoint, ids: number[]) => {
  const shown = new Set((await allRows(setpoint)).map(row => row.id));
  return ids.filter(id => shown.has(id)).length;
};

test('on the phone a row swipes: right reads and unreads it, left rests on Pin, Done and Trash, and all the way trashes it with Undo', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await inbox(setpoint);
    const recovery = page.locator('.list .row[data-key^="attention:"]', {hasText: 'Your recovery email was changed'});
    // Right, all the way: read in place, and nothing opens.
    await swipe(recovery, 60, 330);
    await until('read', () => counts(setpoint), value => value.unread === 18);
    await page.locator('.list .row[data-key^="attention:"]:not(.unread)', {hasText: 'Your recovery email was changed'}).waitFor();
    assert.equal(await page.locator('.rd-subj').count(), 0);
    // And again: unread.
    await swipe(recovery, 60, 330);
    await until('unread again', () => counts(setpoint), value => value.unread === 19);

    // A press at the screen's left edge is Safari's Back: the row stays put.
    await swipe(recovery, 6, 330, false);
    await setpoint.idle();
    assert.equal(await recovery.getAttribute('data-swipe'), null);
    assert.equal((await counts(setpoint)).unread, 19);

    // Left, part way: it rests open on Pin, Done and Trash (Trash at the edge), and Done runs.
    const exams = page.locator('.list .row[data-key^="attention:"]:has(b[data-tip^="Final exam schedule"])');
    await swipe(exams, 300, 180);
    await exams.locator('.sw-b', {hasText: 'Trash'}).waitFor();
    assert.deepEqual(await exams.locator('.sw-b').allTextContents(), ['Trash', 'Done', 'Pin']);
    assert.equal(await page.locator('.rd-subj').count(), 0);
    await exams.locator('.sw-b', {hasText: 'Done'}).tap();
    await page.locator('.toast', {hasText: 'Marked Done'}).waitFor();
    await until('out of Attention', () => counts(setpoint), value => value.attention === 2);

    // All the way left, as a finger does it (no click after): Trash, with Undo bringing it back.
    const interview = await email(setpoint, 'Interview availability');
    await swipe(page.locator('.list .row[data-key^="attention:"]:has(b[data-tip^="Interview availability"])'), 340, 30, false);
    await holdToast(page);
    const toast = page.locator('.toast', {hasText: 'Moved to Trash'});
    await toast.waitFor();
    await until('trashed', () => inAll(setpoint, [interview]), shown => shown === 0);
    assert.equal(await page.locator('.rd-subj').count(), 0);
    await toast.locator('button', {hasText: 'Undo'}).tap();
    await until('back', () => setpoint.api<InboxOut>('GET', '/mail/inbox'), value => value.groups.some(group => group.rows.some(row => row.id === interview)));
    await page.locator('.list .row[data-key^="attention:"]:has(b[data-tip^="Interview availability"])').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('on the phone Select puts circles on the rows and the tab bar\'s place to Done, Pin, Read and Trash; a batch takes one toast whose Undo puts every email back', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await inbox(setpoint);
    const senders = ['Woodgrove Bank', 'Proseware', 'Consolidated Messenger'];
    const ids = await Promise.all(senders.map(sender => idFrom(setpoint, sender)));
    await page.locator('.hd button', {hasText: 'Select'}).tap();
    await page.locator('.hd .hd-title', {hasText: 'Select emails'}).waitFor();
    assert.equal(await page.locator('.ph-tabs').count(), 0);
    const bar = page.locator('.ph-selbar');
    assert.deepEqual(await bar.locator('button').allTextContents(), ['Done', 'Pin', 'Read', 'Trash']);
    assert.equal(await bar.locator('button:enabled').count(), 0);

    // A tap selects and opens nothing; no swipes meanwhile.
    for (const sender of senders) await page.locator('.list .row', {hasText: sender}).first().tap();
    await page.locator('.hd .hd-title', {hasText: '3 selected'}).waitFor();
    assert.equal(await page.locator('.list .row.sel .pick[aria-checked="true"]').count(), 3);
    assert.equal(await page.locator('.rd-subj').count(), 0);
    const woodgrove = page.locator('.list .row', {hasText: 'Woodgrove Bank'}).first();
    await swipe(woodgrove, 340, 30);
    assert.equal(await woodgrove.getAttribute('data-swipe'), null);
    // The swipe's click was a tap: it took Woodgrove out, and a tap puts it back.
    await page.locator('.hd .hd-title', {hasText: '2 selected'}).waitFor();
    await woodgrove.tap();
    await page.locator('.hd .hd-title', {hasText: '3 selected'}).waitFor();

    // Pin ends the mode, as every batch does, and the three go on the shelf.
    await bar.locator('button', {hasText: 'Pin'}).tap();
    await page.locator('.ph-tabs').waitFor();
    assert.equal(await page.locator('.list .pick').count(), 0);
    await until('pinned', () => allRows(setpoint), rows => ids.every(id => rows.find(row => row.id === id)?.pinned));
    // Selected again, every one pinned: Unpin, and the mode ends again.
    await page.locator('.hd button', {hasText: 'Select'}).tap();
    for (const sender of senders) await page.locator('.list .row', {hasText: sender}).first().tap();
    await page.locator('.hd .hd-title', {hasText: '3 selected'}).waitFor();
    await bar.locator('button', {hasText: 'Unpin'}).tap();
    await page.locator('.ph-tabs').waitFor();
    await until('unpinned', () => allRows(setpoint), rows => ids.every(id => !rows.find(row => row.id === id)?.pinned));

    // Read ends it too.
    await page.locator('.hd button', {hasText: 'Select'}).tap();
    await page.locator('.list .row', {hasText: 'Proseware'}).first().tap();
    await page.locator('.hd .hd-title', {hasText: '1 selected'}).waitFor();
    await bar.locator('button', {hasText: /^(Read|Unread)$/}).tap();
    await page.locator('.ph-tabs').waitFor();
    assert.equal(await page.locator('.list .pick').count(), 0);

    // Trash: one toast for the three, and the mode ends; Undo puts every one back.
    await page.locator('.hd button', {hasText: 'Select'}).tap();
    for (const sender of senders) await page.locator('.list .row', {hasText: sender}).first().tap();
    await page.locator('.hd .hd-title', {hasText: '3 selected'}).waitFor();
    await bar.locator('button', {hasText: 'Trash'}).tap();
    await holdToast(page);
    const toast = page.locator('.toast', {hasText: 'Moved 3 to Trash'});
    await toast.waitFor();
    await page.locator('.ph-tabs').waitFor();
    await until('all three trashed', () => inAll(setpoint, ids), shown => shown === 0);
    await toast.locator('button', {hasText: 'Undo'}).tap();
    await until('all three back', () => inAll(setpoint, ids), shown => shown === 3);
    for (const sender of senders) await page.locator('.list .row', {hasText: sender}).first().waitFor();

    // Cancel ends the mode with nothing done.
    await page.locator('.hd button', {hasText: 'Select'}).tap();
    await page.locator('.list .row', {hasText: 'Proseware'}).first().tap();
    await page.locator('.hd .hd-title', {hasText: '1 selected'}).waitFor();
    await page.locator('.hd button', {hasText: 'Cancel'}).tap();
    await page.locator('.ph-tabs').waitFor();
    assert.equal(await page.locator('.list .pick').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
