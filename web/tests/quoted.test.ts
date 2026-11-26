// Where a plain-text email's quoted history starts (src/logic/quoted.ts), as a table over invented
// emails from each client: what shows above •••, and what ••• folds away.
import {describe, expect, test} from 'vitest';
import {splitQuoted} from '../src/logic/quoted.ts';

const lines = (...all: string[]) => all.join('\n');

describe('the history folds from where its client starts it', () => {
  test.each([
    ['Gmail, its "On … wrote:" line wrapped onto two',
      lines('Friday works.', '', 'On Tue, Nov 24, 2026 at 3:04 PM Sam Ortiz <sam@example.com>', 'wrote:', '', '> Could you send the plan by Friday?', '>', '> Sam'),
      'Friday works.', 'On Tue, Nov 24, 2026 at 3:04 PM Sam Ortiz <sam@example.com>'],
    ['Setpoint\'s own reply',
      lines('Friday works.', '', 'On Nov 24, 2026, Sam Ortiz wrote:', '> Could you send the plan?'),
      'Friday works.', 'On Nov 24, 2026, Sam Ortiz wrote:'],
    ['Apple Mail, with a signature above the quote',
      lines('Friday works.', '', 'Jo', '', '> On Nov 24, 2026, at 3:04 PM, Sam Ortiz <sam@example.com> wrote:', '> ', '> Could you send the plan?'),
      'Friday works.\n\nJo', '> On Nov 24, 2026, at 3:04 PM, Sam Ortiz <sam@example.com> wrote:'],
    ['a quote inside a quote, from the outermost',
      lines('Done.', '', 'On Nov 24, 2026, Sam Ortiz wrote:', '> Which plan?', '>', '> On Nov 23, 2026, Jo Park wrote:', '>> Could you send the plan?'),
      'Done.', 'On Nov 24, 2026, Sam Ortiz wrote:'],
    ['`>` lines with no line above them',
      lines('Friday works.', '', '> Could you send the plan?'),
      'Friday works.', '> Could you send the plan?'],
    ['Outlook, its "Original Message" line',
      lines('Sending it over now.', '', '-----Original Message-----', 'From: Sam Ortiz <sam@example.com>', 'Sent: Tuesday, November 24, 2026 3:04 PM', 'Subject: RE: The plan', '', 'Could you send the plan?'),
      'Sending it over now.', '-----Original Message-----'],
    ['Outlook, its rule over a From: line',
      lines('Sending it over now.', '', '________________________________', 'From: Sam Ortiz <sam@example.com>', 'Sent: Tuesday, November 24, 2026 3:04 PM', 'Subject: RE: The plan', '', 'Could you send the plan?'),
      'Sending it over now.', '________________________________'],
    ['Windows line endings',
      'Friday works.\r\n\r\nOn Nov 24, 2026, Sam Ortiz wrote:\r\n> Could you send the plan?\r\n',
      'Friday works.', 'On Nov 24, 2026, Sam Ortiz wrote:'],
  ])('%s', (_name, text, fresh, quoteStarts) => {
    const split = splitQuoted(text);
    expect(split.fresh).toBe(fresh);
    expect(split.quoted?.split('\n')[0]).toBe(quoteStarts);
  });

  test('nothing is lost: what shows and what folds make the whole email', () => {
    const text = lines('Friday works.', '', 'On Nov 24, 2026, Sam Ortiz wrote:', '> Could you send the plan?');
    const {fresh, quoted} = splitQuoted(text);
    expect(`${fresh}\n\n${quoted}`).toBe(text);
  });

  test('a quote mid-body is kept while a trailing one after the sender\'s answer folds', () => {
    const text = lines('Answers inline.', '', '> Could you send the plan?', 'Yes, Friday.', '', 'On Nov 22, 2026, Sam Ortiz wrote:', '> Earlier thread');
    expect(splitQuoted(text)).toEqual({fresh: lines('Answers inline.', '', '> Could you send the plan?', 'Yes, Friday.'), quoted: lines('On Nov 22, 2026, Sam Ortiz wrote:', '> Earlier thread')});
  });
});

describe('an email shows in full when folding would lose something', () => {
  test.each([
    ['no quote at all', lines('Lunch on Thursday?', '', 'Sam')],
    ['prose that reads like a reply line', lines('On Monday she wrote:', 'the plan, and sent it on.')],
    ['an answer under the quote', lines('On Nov 24, 2026, Sam Ortiz wrote:', '> Could you send the plan?', '', 'Here it is.')],
    ['inline replies between quoted lines', lines('See below.', '', '> Could you send the plan?', 'Yes, Friday.', '> And the budget?', 'Monday.')],
    ['Gmail, a forward', lines('For you.', '', '---------- Forwarded message ---------', 'From: Sam Ortiz <sam@example.com>', 'Subject: The plan', '', 'Could you send the plan?')],
    ['Apple Mail, a forward', lines('For you.', '', 'Begin forwarded message:', '', '> From: Sam Ortiz <sam@example.com>', '> Subject: The plan')],
    ['Outlook, a forward', lines('For you.', '', '________________________________', 'From: Sam Ortiz <sam@example.com>', 'Subject: FW: The plan', '', 'Could you send the plan?')],
    ['nothing above the quote', lines('', 'On Nov 24, 2026, Sam Ortiz wrote:', '> Could you send the plan?')],
  ])('%s', (_name, text) => {
    expect(splitQuoted(text)).toEqual({fresh: text, quoted: null});
  });
});
