// A conversation's rules as tables: which row holds an email, and the names a row shows.
import type {ConversationPersonOut, ThreadRowOut} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {conversationNames, holds, replyTarget, rowHolding} from '../src/logic/conversation.ts';

const thread = (ids: number[], people: ConversationPersonOut[] = []): ThreadRowOut => ({count: ids.length, ids, people});
const person = (name: string, address = `${name.toLowerCase()}@example.com`): ConversationPersonOut => ({name, address, me: false});
const me: ConversationPersonOut = {name: 'me', address: 'user@example.com', me: true};

describe('which conversation an email is in', () => {
  test.each([
    ['the email that placed the row', {id: 7}, 7, true],
    ['another email of it', {id: 7, thread: thread([3, 5, 7])}, 3, true],
    ['an email of another conversation', {id: 7, thread: thread([3, 5, 7])}, 4, false],
    ['a lone email, not it', {id: 7}, 8, false],
  ] as const)('%s', (_name, row, id, expected) => expect(holds(row, id)).toBe(expected));

  test('the row an email placed comes before one that only holds it', () => {
    const rows = [{id: 9, thread: thread([2, 9])}, {id: 2}];
    expect(rowHolding(rows, 2)).toBe(rows[1]);
    expect(rowHolding(rows, 9)).toBe(rows[0]);
    expect(rowHolding(rows, 4)).toBeUndefined();
  });
});

describe('a conversation row\'s names', () => {
  test.each<[string, ThreadRowOut | undefined, string, number | null]>([
    ['a lone email', undefined, 'Contoso Coffee', null],
    ['a lone email with its thread', thread([1], [person('Dominic Reyes')]), 'Dominic Reyes', null],
    ['one person who wrote twice', thread([1, 2], [person('Dominic Reyes')]), 'Dominic Reyes', 2],
    ['the user only', thread([1, 2], [me]), 'me', 2],
    ['a reply from the user', thread([1, 2, 3, 4], [person('Dominic Reyes'), me]), 'Dominic, me', 4],
    ['three people', thread([1, 2, 3], [person('Dominic Reyes'), person('Sara Lind'), me]), 'Dominic, Sara, me', 3],
    ['a long list', thread([1, 2, 3, 4, 5, 6], [person('Dominic Reyes'), person('Ana Ruiz'), person('Lee Park'), person('Sara Lind'), me]), 'Dominic … Sara, me', 6],
    ['a name that is an address', thread([1, 2], [person('pat@example.com'), me]), 'pat, me', 2],
    ['no name at all', thread([1, 2], [{name: '', address: 'kim@example.com', me: false}, me]), 'kim, me', 2],
  ])('%s', (_name, row, names, count) => expect(conversationNames({thread: row}, row?.people.length === 1 ? 'Dominic Reyes' : 'Contoso Coffee')).toEqual({names, count}));
});

describe('what the foot\'s Reply answers', () => {
  test.each<[string, {id: number; sent_only?: true}[], number | null]>([
    ['the newest email', [{id: 1}, {id: 2}], 2],
    ['past the user\'s own reply', [{id: 1}, {id: 2}, {id: 3, sent_only: true}], 2],
    ['only the user wrote', [{id: 1, sent_only: true}, {id: 2, sent_only: true}], 2],
    ['no emails', [], null],
  ])('%s', (_name, emails, expected) => expect(replyTarget(emails)).toBe(expected));
});
