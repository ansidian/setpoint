// The composer's pure rules as tables: when an email has anyone for Reply all (the server's own fill
// rule), what a typed or pasted recipient is, a chip's words, the reply's quote and its line, and
// how the composer's windows fold and hide when they don't all fit, and what attachments weigh.
import type {FromOut, MessageOut, Recipient} from '@setpoint/shared';
import {attachmentsTotal, SEED_TIME_ZONE} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {arrangeWindows, canRedo, canUndo, chipLabel, fillAround, forwardLines, hasOthers, megabytes, NO_VERSIONS, placeWindows, quoteOf, readRecipient, readRecipients, recordVersion, redoVersion, replyLine, undoVersion, unwritten, withRecipients, writePlaceholder} from '../src/logic/composer.ts';
import type {Versions} from '../src/logic/composer.ts';

const FROM: FromOut = {
  accounts: [
    {account_id: 1, addresses: [{address: 'user@example.com', name: 'User', primary: true}, {address: 'alias@example.com', name: null, primary: false}]},
    {account_id: 2, addresses: [{address: 'user@work.example.org', name: null, primary: true}]},
  ],
  default_account_id: 1,
};
const SAM: Recipient = {name: 'Sam Lee', address: 'sam@example.org'};
const JUNE: Recipient = {name: 'June Park', address: 'june@example.org'};
const ME: Recipient = {name: 'User', address: 'user@example.com'};
const WORK: Recipient = {name: null, address: 'user@work.example.org'};

type Email = Pick<MessageOut, 'account_id' | 'from_name' | 'from_address' | 'subject'> & Partial<Pick<MessageOut, 'to' | 'cc' | 'reply_to'>>;
const email = (fields: Partial<Email>): Email => ({account_id: 1, from_name: 'Sam Lee', from_address: SAM.address, subject: 'Dinner', ...fields});

describe('Reply all', () => {
  test.each<[string, Email, boolean]>([
    ['to the user alone', email({to: [ME], cc: []}), false],
    ['another in To', email({to: [ME, JUNE], cc: []}), true],
    ['another in Cc', email({to: [ME], cc: [JUNE]}), true],
    ['only the user\'s other addresses, an alias and another account\'s, are no one', email({to: [ME, {name: null, address: 'Alias@Example.com'}], cc: [WORK]}), false],
    ['the sender named again in Cc is no one more', email({to: [ME], cc: [SAM]}), false],
    ['recipients not known yet count as none', email({}), false],
    ['mail the user sent to two people answers both with Reply', email({from_name: 'User', from_address: ME.address, to: [SAM, JUNE], cc: []}), false],
    ['mail the user sent with a Cc', email({from_name: 'User', from_address: ME.address, to: [SAM], cc: [JUNE]}), true],
  ])('%s', (_name, message, expected) => {
    expect(hasOthers(message, FROM)).toBe(expected);
  });

  test('not before From has loaded', () => {
    expect(hasOthers(email({to: [ME, JUNE]}), undefined)).toBe(false);
  });
});

describe('a typed recipient', () => {
  test.each<[string, string, Recipient | null]>([
    ['an address, lowered', ' Sam@Example.org ', {name: null, address: 'sam@example.org'}],
    ['a trailing comma', 'sam@example.org,', {name: null, address: 'sam@example.org'}],
    ['a name and an address', 'Sam Lee <sam@example.org>', SAM],
    ['a quoted name', '"Lee, Sam" <sam@example.org>', {name: 'Lee, Sam', address: 'sam@example.org'}],
    ['an empty name', '<sam@example.org>', {name: null, address: 'sam@example.org'}],
    ['no domain', 'sam@example', null],
    ['words', 'Sam Lee', null],
    ['nothing', '  ', null],
  ])('%s', (_name, typed, expected) => {
    expect(readRecipient(typed)).toEqual(expected);
  });

  test('several pasted at once: each address a recipient, the rest left as typed', () => {
    expect(readRecipients('Sam Lee <sam@example.org>, "Park, June" <june@example.org>; not one\nravi@example.org')).toEqual({
      recipients: [SAM, {name: 'Park, June', address: 'june@example.org'}, {name: null, address: 'ravi@example.org'}], rest: 'not one',
    });
  });

  test('a chip reads the name, else the address; a field takes each address once', () => {
    expect([SAM, {name: ' ', address: 'x@example.org'}].map(chipLabel)).toEqual(['Sam Lee', 'x@example.org']);
    expect(withRecipients([SAM], [{name: null, address: SAM.address}, JUNE, JUNE])).toEqual([SAM, JUNE]);
  });
});

describe('the quote', () => {
  test('its line names the day in the owner\'s zone and the sender, else the address', () => {
    expect(replyLine({from_name: 'Sam Lee', from_address: SAM.address, received_at: '2026-10-05T19:40:00Z'}, SEED_TIME_ZONE)).toBe('On Oct 5, 2026, Sam Lee wrote:');
    expect(replyLine({from_name: '', from_address: SAM.address, received_at: '2026-10-06T06:30:00Z'}, SEED_TIME_ZONE)).toBe('On Oct 5, 2026, sam@example.org wrote:');
  });

  test('an HTML email is read as rich text, nothing of its page kept; plain text keeps its paragraphs and lines', () => {
    expect(quoteOf({body_html: '<style>p{}</style><p>Blue Door at <b>7</b>?</p><script>x()</script>', body_text: ''})).toEqual([
      {type: 'paragraph', runs: [{text: 'Blue Door at ', marks: [], href: null}, {text: '7', marks: ['bold'], href: null}, {text: '?', marks: [], href: null}]},
    ]);
    expect(quoteOf({body_html: null, body_text: 'Hey!\nDinner?\n\nSam'})).toEqual([
      {type: 'paragraph', runs: [{text: 'Hey!\nDinner?', marks: [], href: null}]},
      {type: 'paragraph', runs: [{text: 'Sam', marks: [], href: null}]},
    ]);
  });
});

describe('a draft nothing was written in, which closing leaves out of Drafts', () => {
  const words = [{type: 'paragraph' as const, runs: [{text: 'Hi', marks: [], href: null}]}];
  const blank = {kind: 'new' as const, to: [] as Recipient[], cc: [] as Recipient[], bcc: [] as Recipient[], subject: '', body: [], quote: null};
  test.each<[string, Parameters<typeof unwritten>[0], boolean]>([
    ['a new message with nothing', blank, true],
    ['a new message with only a blank line', {...blank, body: [{type: 'paragraph', runs: []}]}, true],
    ['a new message with someone to send to', {...blank, to: [SAM]}, false],
    ['a new message with a subject', {...blank, subject: 'Lunch'}, false],
    ['a new message with words', {...blank, body: words}, false],
    ['a reply with its server-filled recipients and subject and no words', {...blank, kind: 'reply', to: [SAM], subject: 'Re: Dinner'}, true],
    ['a reply with words', {...blank, kind: 'reply_all', to: [SAM], body: words}, false],
    ['a reply whose quote was trimmed', {...blank, kind: 'reply', to: [SAM], quote: []}, false],
    ['a forward with no one yet', {...blank, kind: 'forward', subject: 'Fwd: Dinner'}, true],
    ['a forward with someone to send to', {...blank, kind: 'forward', to: [JUNE], subject: 'Fwd: Dinner'}, false],
    ['a reply with only a file attached', {...blank, kind: 'reply', to: [SAM], files: [{id: 1, filename: 'Notes.txt', mime_type: 'text/plain', size_bytes: 12}]}, false],
    ['a new message with only a file attached', {...blank, files: [{id: 1, filename: 'Notes.txt', mime_type: 'text/plain', size_bytes: 12}]}, false],
  ])('%s', (_name, draft, expected) => {
    expect(unwritten(draft)).toBe(expected);
  });
});

describe('Attachments\' weight', () => {
  const MB = 1024 * 1024;
  test.each<[string, Parameters<typeof attachmentsTotal>, number]>([
    ['nothing', [[], [], []], 0],
    ['the user\'s own files', [[{size_bytes: 2 * MB}, {size_bytes: 3 * MB}], [], []], 5 * MB],
    ['a forward\'s originals with the user\'s files', [[{size_bytes: 2 * MB}], [{id: 7, size_bytes: 20 * MB}, {id: 8, size_bytes: MB}], []], 23 * MB],
    ['an original taken off doesn\'t count', [[{size_bytes: 2 * MB}], [{id: 7, size_bytes: 20 * MB}, {id: 8, size_bytes: MB}], [7]], 3 * MB],
    ['a removed id that isn\'t an original changes nothing', [[], [{id: 7, size_bytes: MB}], [99]], MB],
  ])('%s', (_name, args, expected) => {
    expect(attachmentsTotal(...args)).toBe(expected);
  });

  test.each([[0, '0 MB'], [MB, '1 MB'], [25.5 * MB, '25.5 MB'], [12.44 * MB, '12.4 MB'], [26 * MB + 1, '26 MB']])('%d bytes read %s', (bytes, words) => {
    expect(megabytes(bytes)).toBe(words);
  });
});

describe('a forward\'s header lines, as the server writes them', () => {
  const email = {from_name: 'Dana Whitfield', from_address: 'dana@example.org', subject: 'Lease renewal terms', received_at: '2026-09-30T21:15:00Z'};
  test.each<[string, Parameters<typeof forwardLines>[0], string[]]>([
    ['with To and Cc', {...email, to: [ME], cc: [JUNE, {name: null, address: 'office@example.org'}]}, [
      '---------- Forwarded message ---------', 'From: Dana Whitfield <dana@example.org>', 'Date: Wed, Sep 30, 2026 at 2:15 PM', 'Subject: Lease renewal terms',
      'To: User <user@example.com>', 'Cc: June Park <june@example.org>, office@example.org',
    ]],
    ['no name, recipients not known', {...email, from_name: ' '}, [
      '---------- Forwarded message ---------', 'From: dana@example.org', 'Date: Wed, Sep 30, 2026 at 2:15 PM', 'Subject: Lease renewal terms',
    ]],
  ])('%s', (_name, message, expected) => {
    expect(forwardLines(message, SEED_TIME_ZONE)).toEqual(expected);
  });
});

describe('the composer\'s windows, when they don\'t all fit', () => {
  // Keys 1, 2, 3… popped out in that order; `touched` says which was touched longest ago.
  const windows = (touched: number[], minimized: number[] = []) => touched.map((at, index) => ({key: index + 1, touched: at, minimized: minimized.includes(index + 1)}));
  test.each<[string, ReturnType<typeof windows>, number, {fold: number[]; hidden: number[]}]>([
    ['two fit side by side', windows([1, 2]), 1200, {fold: [], hidden: []}],
    // 560 × 3 + 2 gaps is 1704; folding the oldest makes 1464, the next 1224.
    ['the one touched longest ago folds first, then the next', windows([1, 2, 3]), 1300, {fold: [1, 2], hidden: []}],
    ['the oldest touched is the one to fold, whatever its place', windows([3, 1, 2]), 1500, {fold: [2], hidden: []}],
    ['one already folded stays, and counts as a bar', windows([1, 2, 3], [1]), 1500, {fold: [], hidden: []}],
    // Three bars and a window are 1556; hiding the oldest makes 1224 plus the chip's 76.
    ['once even the bars don\'t fit, the oldest go into the chip', windows([1, 2, 3, 4]), 1300, {fold: [1, 2, 3], hidden: [1]}],
    ['the window touched last always stays as it is', windows([1, 2]), 400, {fold: [1], hidden: [1]}],
    ['one window wider than the room only narrows', windows([1]), 400, {fold: [], hidden: []}],
  ])('%s', (_, slots, room, expected) => {
    expect(arrangeWindows(slots, room)).toEqual(expected);
  });

  test('they line up leftward in the order they popped out, a hidden one taking no room, the chip after the last shown', () => {
    const {at, end} = placeWindows([{key: 1, minimized: true}, {key: 2, minimized: true}, {key: 3, minimized: false}], [1], 1300);
    expect([...at]).toEqual([[1, {right: 0, width: 320}], [2, {right: 0, width: 320}], [3, {right: 332, width: 560}]]);
    expect(end).toBe(904);
  });
});

describe('help me write\'s versions', () => {
  // A body of one line, by its words ('' is the empty body).
  const b = (text: string) => (text ? [{type: 'paragraph' as const, runs: [{text, marks: [], href: null}]}] : []);
  const v = (texts: string[], at: number): Versions => ({versions: texts.map(b), at});

  test.each([
    ['the first draft keeps the empty body before it', NO_VERSIONS, '', 'A', v(['', 'A'], 1)],
    ['a second draft over the shown version adds only the new one', v(['', 'A'], 1), 'A', 'B', v(['', 'A', 'B'], 2)],
    ['typing before a draft keeps the typed body as a version', v(['', 'A'], 1), 'A typed', 'B', v(['', 'A', 'A typed', 'B'], 3)],
    ['a draft after an undo drops what redo had', v(['', 'A', 'B'], 1), 'A', 'C', v(['', 'A', 'C'], 2)],
  ])('recording: %s', (_name, state, before, after, expected) => {
    expect(recordVersion(state, b(before), b(after))).toEqual(expected);
  });

  test('the oldest versions go past the limit', () => {
    expect(recordVersion(v(['1', '2', '3'], 2), b('3'), b('4'), 3)).toEqual(v(['2', '3', '4'], 2));
  });

  test.each([
    ['nothing to undo before any draft', NO_VERSIONS, '', null],
    ['undo goes back a version', v(['', 'A', 'B'], 2), 'B', {state: v(['', 'A', 'B'], 1), body: b('A')}],
    ['at the first version, nothing more', v(['', 'A'], 0), '', null],
    ['typing since is kept, so undo shows the version it was typed over', v(['', 'A'], 1), 'A typed', {state: v(['', 'A', 'A typed'], 1), body: b('A')}],
    ['typing over the first version can still be undone back to it', v(['', 'A'], 0), 'typed', {state: v(['', 'typed'], 0), body: b('')}],
  ])('undo: %s', (_name, state, current, expected) => {
    expect(undoVersion(state, b(current))).toEqual(expected);
    expect(canUndo(state, b(current))).toBe(expected !== null);
  });

  test.each([
    ['redo after an undo', v(['', 'A', 'B'], 1), 'A', {state: v(['', 'A', 'B'], 2), body: b('B')}],
    ['nothing past the newest', v(['', 'A'], 1), 'A', null],
    ['typing since drops redo', v(['', 'A', 'B'], 1), 'A typed', null],
  ])('redo: %s', (_name, state, current, expected) => {
    expect(redoVersion(state, b(current))).toEqual(expected);
    expect(canRedo(state, b(current))).toBe(expected !== null);
  });

  test.each([
    ['an empty body asks what to write', '', 'Describe your message'],
    ['a body with text asks what to change', 'Hi Sam,', 'Describe your change'],
  ])('the line: %s', (_name, body, words) => {
    expect(writePlaceholder(b(body))).toBe(words);
  });
});

describe('what was typed before the server answered, put into the draft it answered', () => {
  const draft = {to: [SAM], cc: [], bcc: [], body: []};
  const hello = [{type: 'paragraph' as const, runs: [{text: 'Hello', marks: [], href: null}]}];
  const left = [{type: 'paragraph' as const, runs: [{text: 'Left earlier', marks: [], href: null}]}];
  test.each<[string, Parameters<typeof fillAround>[0], Parameters<typeof fillAround>[1], ReturnType<typeof fillAround>]>([
    ['nothing typed asks nothing', draft, {}, {}],
    ['words in a new draft are its body', draft, {body: hello}, {body: hello}],
    ['words typed on a draft left with words go after them', {...draft, body: left}, {body: hello}, {body: [...left, ...hello]}],
    ['a recipient typed joins the server\'s', draft, {to: [JUNE]}, {to: [SAM, JUNE]}],
    ['a recipient the server already has is there once', draft, {to: [SAM, JUNE]}, {to: [SAM, JUNE]}],
    ['a subject typed is the subject', draft, {subject: 'Lunch'}, {subject: 'Lunch'}],
    ['words typed and taken back on a draft with words change nothing', {...draft, body: left}, {body: [{type: 'paragraph' as const, runs: []}]}, {}],
  ])('%s', (_, answered, typed, saved) => {
    expect(fillAround(answered, typed)).toEqual(saved);
  });
});
