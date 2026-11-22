// An email's and a selection's Snooze in their action lists (app/emailActions.ts), as tables: the
// right-click menu's Snooze holds Tomorrow and Next weekday (and Unsnooze on a snoozed email), ⌘K's is
// one Snooze S that opens the snooze menu, and sent mail has none. The rest of the lists are the
// browser checks'. It runs here, in a browser, as the app's modules want a window.
import type {MessageRowOut} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import type {MenuAction} from '../../src/app/ContextMenu.tsx';
import {emailActions, selectionActions, snoozeItems} from '../../src/app/emailActions.ts';
import type {EmailHandlers, SelectionHandlers} from '../../src/app/emailActions.ts';

const ZONE = 'America/Los_Angeles';
// A Friday evening in Pacific time: Tomorrow is Saturday, and Next weekday Monday.
const FRIDAY = Date.parse('2026-10-10T02:00:00.000Z');
const none = () => {};

function row(fields: Partial<MessageRowOut> = {}): MessageRowOut {
  return {
    id: 1, account_id: 1, from_name: 'Sender', from_address: 'sender@example.com', organisation: null, via: null, subject: 'Subject',
    summary: null, received_at: '2026-10-07T15:00:00.000Z', unread: false, lane: 'fyi', kind: 'other', type: null, protected: false,
    pinned: false, done: false, fact: null, code: null, trash_due_at: null, attachment_count: 0, command: null, ...fields,
  };
}

const handlers = (more: Partial<EmailHandlers> = {}): EmailHandlers => ({
  done: none, trash: none, pin: none, openInGmail: none, propose: none, ask: none, markUnread: none, ...more,
});

/** Snooze as the list offers it: its label, hint and its items' labels, or null. */
function snoozeOf(actions: MenuAction[]) {
  const snooze = actions.find(action => action.id === 'snooze');
  return snooze ? {label: snooze.label, hint: snooze.hint ?? null, items: snooze.items?.map(item => item.label) ?? null} : null;
}

const times = snoozeItems(FRIDAY, null, ZONE, none);
const snoozedTimes = snoozeItems(FRIDAY, null, ZONE, none, none);
const SNOOZED = {snoozed_until: '2026-10-12T16:00:00.000Z'};

describe('Snooze in an email\'s actions', () => {
  test.each<[string, MessageRowOut, Partial<EmailHandlers>, 'menu' | 'palette', ReturnType<typeof snoozeOf>]>([
    ['the menu on a received email: Tomorrow and Next weekday, no Pick', row(), {snoozeTimes: times}, 'menu',
      {label: 'Snooze', hint: null, items: ['Tomorrow · Sat 9:00 AM', 'Next weekday · Mon 9:00 AM']}],
    ['the menu on a snoozed email: its new times and Unsnooze', row(SNOOZED), {snoozeTimes: snoozedTimes}, 'menu',
      {label: 'Snooze', hint: null, items: ['Tomorrow · Sat 9:00 AM', 'Next weekday · Mon 9:00 AM', 'Unsnooze']}],
    ['the menu where nothing snoozes (the phone)', row(), {}, 'menu', null],
    ['the menu on sent mail', row({sent_only: true}), {snoozeTimes: times}, 'menu', null],
    ['⌘K, where the reader has a snooze menu: one Snooze with its key', row(), {snoozeMenu: true}, 'palette', {label: 'Snooze', hint: 'S', items: null}],
    ['⌘K on a snoozed email with its menu', row(SNOOZED), {snoozeMenu: true}, 'palette', {label: 'Snooze', hint: 'S', items: null}],
    ['⌘K where the reader has none (Sent, the phone)', row(), {}, 'palette', null],
    ['⌘K on sent mail', row({sent_only: true}), {snoozeMenu: true}, 'palette', null],
  ])('%s', (_, email, more, where, expected) => {
    expect(snoozeOf(emailActions(email, true, handlers(more), where, []))).toEqual(expected);
  });

  test('a snoozed email has Snooze in Pin\'s place, and a received one has it after Pin', () => {
    const ids = (email: MessageRowOut, more: Partial<EmailHandlers>) => emailActions(email, true, handlers(more), 'menu', []).map(action => action.id).slice(0, 3);
    expect(ids(row(), {snoozeTimes: times})).toEqual(['trash', 'pin', 'snooze']);
    expect(ids(row(SNOOZED), {snoozeTimes: snoozedTimes})).toEqual(['trash', 'snooze', 'gmail']);
  });

  test('a time hands on its moment, and Unsnooze its own', () => {
    const picked: (number | 'unsnooze')[] = [];
    const [tomorrow, weekday, unsnooze] = snoozeItems(FRIDAY, '07:30', ZONE, until => picked.push(until), () => picked.push('unsnooze'));
    tomorrow!.run();
    weekday!.run();
    unsnooze!.run();
    expect(picked).toEqual([Date.parse('2026-10-10T14:30:00.000Z'), Date.parse('2026-10-12T14:30:00.000Z'), 'unsnooze']);
  });
});

describe('Snooze in a selection\'s actions', () => {
  const on: SelectionHandlers = {done: none, trash: none, pin: none, snooze: none, markRead: none, markUnread: none, clear: none, reply: none, replyAll: none, forward: none};
  test.each<[string, MessageRowOut[], 'menu' | 'palette', ReturnType<typeof snoozeOf>]>([
    ['⌘K on emails that can all be snoozed: Snooze with its key', [row(), row({id: 2})], 'palette', {label: 'Snooze', hint: 'S', items: null}],
    ['⌘K with one already snoozed', [row(), row({id: 2, ...SNOOZED})], 'palette', null],
    ['the right-click menu has none', [row(), row({id: 2})], 'menu', null],
  ])('%s', (_, rows, where, expected) => {
    expect(snoozeOf(selectionActions(rows, on, where))).toEqual(expected);
  });
});
