// The phone's reader at 390 × 844 (board 21): Done, Trash with Undo, Mark unread and read, Copy,
// and the actions each email gets; Mark all as read from the top.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {InboxOut} from '@setpoint/shared';
import {cleanUp, startSetpoint, test, until} from './harness.ts';
import {counts, email, inbox} from './phoneHelpers.ts';

after(cleanUp);

test('Done, Trash with Undo, Mark unread and Mark read from the reader; Mark all as read from the top', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await inbox(setpoint);
    const exams = await email(setpoint, 'Final exam');

    // Mark unread keeps the email open and offers Mark read.
    await page.locator('.list .row', {hasText: 'Your recovery email was changed'}).tap();
    await page.locator('.rd-subj', {hasText: 'Your recovery email was changed'}).waitFor();
    await until('read', () => counts(setpoint), value => value.unread === 18);
    await page.locator('.ph-acts button', {hasText: 'Mark unread'}).tap();
    await page.locator('.ph-acts button', {hasText: 'Mark read'}).waitFor();
    await until('unread again', () => counts(setpoint), value => value.unread === 19);
    await page.locator('.ph-acts button', {hasText: 'Mark read'}).tap();
    await until('read again', () => counts(setpoint), value => value.unread === 18);

    // Done: out of Attention, with Undo in the toast. Back to the list, with nothing else opened or
    // read.
    await page.locator('.ph-acts button', {hasText: 'Done'}).tap();
    await page.locator('.toast', {hasText: 'Marked Done'}).waitFor();
    await page.locator('.rd-subj').waitFor({state: 'detached'});
    await page.locator('.list .row.unread:has(b[data-tip^="Interview availability"])').waitFor();
    await until('the pill drops', () => counts(setpoint), value => value.attention === 2);
    await setpoint.idle();
    assert.equal((await counts(setpoint)).unread, 18);

    // Trash on Contoso University, then Undo brings it back into the reader.
    await page.locator('.list .row:has(b[data-tip^="Final exam schedule"])').tap();
    await page.locator('.rd-subj', {hasText: 'Final exam schedule'}).waitFor();
    await page.locator('.ph-acts button', {hasText: 'Trash'}).tap();
    // Undo while the toast offers it: a wait on the server first could outlast its 6 seconds.
    await page.locator('.toast', {hasText: 'Moved to Trash'}).waitFor();
    await page.locator('.toast button', {hasText: 'Undo'}).tap();
    await page.locator('.rd-subj', {hasText: 'Final exam schedule'}).waitFor();
    await until('it came back', () => setpoint.api<InboxOut>('GET', '/mail/inbox'), value => value.groups.some(group => group.rows.some(row => row.id === exams)));

    // Mark all as read: everything outside Attention (where Northwind, never opened, stays unread)
    // and Security, whose three stay unread.
    await page.locator('.ph-back').tap();
    assert.ok((await counts(setpoint)).unread_fyi > 3);
    await page.locator('.hd button[aria-label="Mark all as read"]').tap();
    await until('all but Security read', () => counts(setpoint), value => value.unread_fyi === 3 && value.unread === 4, 5000);
    // Every row stays where it is: Northwind, left unread, in Attention, and Security's three in their day.
    await until('the rest read', () => page.locator('.list .row.unread:not(.done)').count(), count => count === 4, 5000);
    await page.locator('.list .row.unread[data-key^="attention:"]:has(b[data-tip^="Interview availability"])').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the reader\'s Copy on an email marked unread reads it again, and offers Mark unread', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {origin: setpoint.base});
    const before = await counts(setpoint);
    await page.locator('.list .row', {has: page.locator('.code-line')}).tap();
    await page.locator('.rd-subj', {hasText: 'Your code is 482913'}).waitFor();
    await until('read', () => counts(setpoint), value => value.unread === before.unread - 1);
    await page.locator('.ph-acts button', {hasText: 'Mark unread'}).tap();
    await page.locator('.ph-acts button', {hasText: 'Mark read'}).waitFor();
    await until('unread again', () => counts(setpoint), value => value.unread === before.unread);

    await page.locator('.code-card button', {hasText: 'Copy'}).tap();
    await page.locator('.code-card button', {hasText: 'Copied'}).waitFor();
    await page.locator('.ph-acts button', {hasText: 'Mark unread'}).waitFor();
    await until('read again', () => counts(setpoint), value => value.unread === before.unread - 1);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the reader\'s actions follow the email: Attention mail has Done, other Gmail mail leads with Trash, and iCloud mail has no Open in Gmail', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    const actions = () => page.locator('.ph-acts button').allTextContents();
    for (const [row, subject, labels] of [
      ['.list .row:has(b[data-tip^="Final exam schedule"])', 'Final exam schedule', 'Done,Trash,Mark unread,Open in Gmail'],
      ['.row:has-text("Woodgrove Bank")', 'Statement ready', 'Trash,Mark unread,Open in Gmail'],
      ['.row:has-text("Proseware")', 'Bill is ready', 'Trash,Mark unread'],
    ] as const) {
      await page.locator(row).first().tap();
      await page.locator('.rd-subj', {hasText: subject}).waitFor();
      await until(`${subject}'s actions`, actions, shown => shown.join() === labels);
      await page.locator('.ph-back').tap();
      await until('the reader closes', () => page.locator('.pane').count(), count => count === 0);
    }
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
