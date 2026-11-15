// How a sent email's row names who it went to, as a table: "To Sam Ortiz +2" in the sender's place.
import type {Recipient} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {recipientLine, recipientText} from '../src/logic/sent.ts';

const SAM: Recipient = {name: 'Sam Ortiz', address: 'sam.ortiz@example.org'};
const JUNE: Recipient = {name: 'June Park', address: 'june@example.org'};
const BARE: Recipient = {name: null, address: 'billing@proseware.example.com'};
const BLANK: Recipient = {name: '  ', address: 'ravi@example.org'};

describe('a sent row\'s recipients', () => {
  test.each<[string, Recipient[] | null | undefined, Recipient[] | null | undefined, string, boolean, string | null]>([
    ['one, by name', [SAM], [], 'To Sam Ortiz', true, 'Sam Ortiz <sam.ortiz@example.org>'],
    ['one with no name, by address', [BARE], [], 'To billing@proseware.example.com', true, 'billing@proseware.example.com'],
    ['a blank name is no name', [BLANK], [], 'To ravi@example.org', true, 'ravi@example.org'],
    ['several: the first, and how many more', [SAM, JUNE], [BARE], 'To Sam Ortiz +2', true, 'Sam Ortiz <sam.ortiz@example.org>, June Park <june@example.org>, billing@proseware.example.com'],
    ['Cc known as null with To known', [SAM], null, 'To Sam Ortiz', true, 'Sam Ortiz <sam.ortiz@example.org>'],
    ['only Cc: the first of Cc', [], [JUNE], 'To June Park', true, 'June Park <june@example.org>'],
    ['not read yet: never "To nobody"', null, null, 'To unknown', false, null],
    ['left out of the answer: unknown too', undefined, undefined, 'To unknown', false, null],
    ['none in To or Cc: Bcc only', [], [], 'Bcc only', false, null],
  ])('%s', (_name, to, cc, text, known, tip) => {
    const line = recipientLine(to, cc);
    expect([recipientText(line), line.known, line.tip]).toEqual([text, known, tip]);
  });

  test('the count stays apart from the name, so a long name is cut before it', () => {
    expect(recipientLine([SAM, JUNE], [])).toMatchObject({lead: 'To', name: 'Sam Ortiz', more: 1});
  });
});
