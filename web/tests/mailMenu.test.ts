// The phone's mail title menu as tables: its groups for each place and count, what's checked, and
// the header's title.
import {expect, test} from 'vitest';
import {mailMenu, mailTitle} from '../src/logic/mailMenu.ts';
import type {MailHere} from '../src/logic/mailMenu.ts';

const NONE = {unread: 0, attention: 0, drafts: 0, snoozed: 0};
const SOME = {unread: 19, attention: 3, drafts: 2, snoozed: 1};
const VIEWS = ['All', 'Unread', 'Attention', 'FYI', 'Noise'];

/** Each group's rows as "Label", "Label 3" with a count, "Label ✓" checked. */
const drawn = (here: MailHere, counts: typeof NONE) => mailMenu(here, counts).map(group => group.map(row => [row.label, row.count, row.checked && '✓'].filter(Boolean).join(' ')));

test.each<[string, MailHere, typeof NONE, string[][]]>([
  ['All with nothing waiting: Sent alone after the views', {page: 'inbox', view: 'all'}, NONE, [['All ✓', 'Unread', 'Attention', 'FYI', 'Noise'], ['Sent'], ['Settings']]],
  ['All with drafts and a snooze: their counts, as the sidebar\'s', {page: 'inbox', view: 'all'}, SOME,
    [['All ✓', 'Unread 19', 'Attention 3', 'FYI', 'Noise'], ['Sent', 'Drafts 2', 'Snoozed 1'], ['Settings']]],
  ['FYI: its view checked', {page: 'inbox', view: 'fyi'}, NONE, [['All', 'Unread', 'Attention', 'FYI ✓', 'Noise'], ['Sent'], ['Settings']]],
  ['Sent: no view checked', {page: 'sent'}, SOME, [['All', 'Unread 19', 'Attention 3', 'FYI', 'Noise'], ['Sent ✓', 'Drafts 2', 'Snoozed 1'], ['Settings']]],
  ['Drafts emptied while it shows: still there, checked', {page: 'drafts'}, NONE, [VIEWS, ['Sent', 'Drafts ✓'], ['Settings']]],
  ['Snoozed emptied while it shows: still there, checked', {page: 'snoozed'}, NONE, [VIEWS, ['Sent', 'Snoozed ✓'], ['Settings']]],
])('the menu on %s', (_name, here, counts, groups) => {
  expect(drawn(here, counts)).toEqual(groups);
});

test('each row goes to its place', () => {
  const rows = mailMenu({page: 'sent'}, SOME).flat();
  expect(rows.map(row => row.go)).toEqual([
    {page: 'inbox', view: 'all'}, {page: 'inbox', view: 'unread'}, {page: 'inbox', view: 'attention'}, {page: 'inbox', view: 'fyi'}, {page: 'inbox', view: 'noise'},
    {page: 'sent'}, {page: 'drafts'}, {page: 'snoozed'}, {page: 'settings'},
  ]);
});

test.each<[MailHere, string]>([
  [{page: 'inbox', view: 'all'}, 'Inbox'],
  [{page: 'inbox', view: 'attention'}, 'Attention'],
  [{page: 'sent'}, 'Sent'],
  [{page: 'drafts'}, 'Drafts'],
  [{page: 'snoozed'}, 'Snoozed'],
])('the title on %j is %s', (here, title) => {
  expect(mailTitle(here)).toBe(title);
});
