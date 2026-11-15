// The message builder and the body it carries, as tables. Every built email is read back through
// the parser the sync uses (src/providers/mime.ts), so what Setpoint sends is what it would read.
import type {Recipient} from '@setpoint/shared';
import type {Block} from '@setpoint/shared/richText';
import {describe, expect, test} from 'vitest';
import {composeBody, replyLine} from '../src/domain/outgoingBody.ts';
import type {QuotedEmail} from '../src/domain/outgoingBody.ts';
import {buildMessage, encodeWords, formatAddress, replyHeaders} from '../src/domain/outgoingMessage.ts';
import type {OutgoingMessage} from '../src/domain/outgoingMessage.ts';
import {parseEmail} from '../src/providers/mime.ts';

const ZONE = 'America/Los_Angeles';
const sam: Recipient = {name: 'Sam Ortiz', address: 'sam.ortiz@example.org'};
const june: Recipient = {name: 'June Park', address: 'june.park@example.org'};

const message = (fields: Partial<OutgoingMessage> = {}): OutgoingMessage => ({
  messageId: '<sp.1.abc@setpoint.example>', date: new Date('2026-11-15T20:30:05Z'),
  from: {name: 'User', address: 'user.work@example.com'}, to: [sam], cc: [], bcc: [], subject: 'Thursday',
  inReplyTo: null, references: [], text: 'See you then.', html: '<div dir="ltr">See you then.</div>', attachments: [], boundarySeed: 'sp.1.abc',
  ...fields,
});

const headerBlock = (raw: Buffer) => raw.toString('utf8').split('\r\n\r\n')[0]!;

describe('buildMessage: read back by the sync\'s parser', () => {
  test.each<[string, Partial<OutgoingMessage>, Record<string, unknown>]>([
    ['a plain message', {}, {fromName: 'User', fromAddress: 'user.work@example.com', to: [sam], cc: [], subject: 'Thursday', rfc822Id: '<sp.1.abc@setpoint.example>', inReplyTo: null, references: []}],
    ['a reply\'s headers', {inReplyTo: '<b@x.example>', references: ['<a@x.example>', '<b@x.example>']}, {inReplyTo: '<b@x.example>', references: ['<a@x.example>', '<b@x.example>']}],
    ['To and Cc with names', {to: [sam, june], cc: [{name: null, address: 'theo@example.net'}]}, {to: [sam, june], cc: [{name: null, address: 'theo@example.net'}]}],
    ['non-ASCII names and subject', {from: {name: 'Zoë Müller', address: 'zoe@example.com'}, to: [{name: 'Søren Ødegård', address: 's@example.dk'}], subject: 'Café ☕ résumé, the long version that has to be split across more than one encoded word'},
      {fromName: 'Zoë Müller', to: [{name: 'Søren Ødegård', address: 's@example.dk'}], subject: 'Café ☕ résumé, the long version that has to be split across more than one encoded word'}],
    ['a name with specials is quoted', {to: [{name: 'Ortiz, Sam "Sammy"', address: 'sam.ortiz@example.org'}]}, {to: [{name: 'Ortiz, Sam "Sammy"', address: 'sam.ortiz@example.org'}]}],
    ['a subject with a line break stays one header', {subject: 'Hi\r\nBcc: someone@evil.example'}, {subject: 'Hi Bcc: someone@evil.example', to: [sam]}],
    ['a name with a line break stays one header', {to: [{name: 'Sam\r\nBcc: x@evil.example', address: 'sam.ortiz@example.org'}]}, {to: [{name: 'Sam Bcc: x@evil.example', address: 'sam.ortiz@example.org'}]}],
    ['the plain text and HTML', {text: 'Line one\nLine two — ok', html: '<p>Line <b>one</b></p>'}, {text: 'Line one\nLine two — ok', html: '<p>Line <b>one</b></p>'}],
  ])('%s', async (_name, fields, expected) => {
    const parsed = await parseEmail(buildMessage(message(fields), {bcc: true}));
    const read = {fromName: parsed.fromName, fromAddress: parsed.fromAddress, to: parsed.to, cc: parsed.cc, subject: parsed.subject, rfc822Id: parsed.rfc822Id,
      inReplyTo: parsed.inReplyTo, references: parsed.references, text: parsed.text.trim(), html: parsed.html};
    expect(read).toMatchObject(expected);
  });

  test('a long recipient list folds, and no header line runs past 78 characters', async () => {
    const many = Array.from({length: 12}, (_, n) => ({name: `Person Number ${n}`, address: `person.${n}@example.org`}));
    const raw = buildMessage(message({to: many, references: Array.from({length: 6}, (_, n) => `<ref-${n}-0123456789@example.org>`)}), {bcc: true});
    expect(headerBlock(raw).split('\r\n').every(line => line.length <= 78)).toBe(true);
    expect((await parseEmail(raw)).to).toEqual(many);
  });

  test.each([true, false])('Bcc is in the headers only when asked (%s)', bcc => {
    const raw = buildMessage(message({bcc: [{name: 'Hidden', address: 'hidden@example.org'}]}), {bcc});
    expect(headerBlock(raw).includes('Bcc: Hidden <hidden@example.org>')).toBe(bcc);
    expect(raw.includes('hidden@example.org')).toBe(bcc);
  });

  test('a forward carries its attachments, a non-ASCII name included', async () => {
    const files = [
      {filename: 'Itinerary.pdf', mimeType: 'application/pdf', content: Buffer.from('%PDF-1.4 fake')},
      {filename: 'Reçu été.png', mimeType: 'image/png', content: Buffer.alloc(300, 7)},
    ];
    const parsed = await parseEmail(buildMessage(message({attachments: files}), {bcc: false}));
    expect(parsed.attachments.map(file => ({filename: file.filename, mimeType: file.mimeType, sizeBytes: file.sizeBytes})))
      .toEqual([{filename: 'Itinerary.pdf', mimeType: 'application/pdf', sizeBytes: 13}, {filename: 'Reçu été.png', mimeType: 'image/png', sizeBytes: 300}]);
    expect(parsed.text.trim()).toBe('See you then.');
  });

  test('the same message builds the same bytes', () => {
    expect(buildMessage(message(), {bcc: true}).equals(buildMessage(message(), {bcc: true}))).toBe(true);
  });
});

describe('header pieces', () => {
  test.each<[Recipient, string]>([
    [{name: null, address: 'sam@example.org'}, 'sam@example.org'],
    [{name: 'Sam Ortiz', address: 'sam@example.org'}, 'Sam Ortiz <sam@example.org>'],
    [{name: 'O\'Brien', address: 'o@example.org'}, 'O\'Brien <o@example.org>'],
    [{name: 'Ortiz, Sam', address: 'sam@example.org'}, '"Ortiz, Sam" <sam@example.org>'],
    [{name: 'Zoë', address: 'z@example.org'}, '=?UTF-8?B?Wm/Dqw==?= <z@example.org>'],
  ])('formatAddress(%j) → %s', (recipient, expected) => {
    expect(formatAddress(recipient)).toBe(expected);
  });

  test('ASCII stays as it is; anything else is encoded words under 76 characters', () => {
    expect(encodeWords('Thursday')).toBe('Thursday');
    const words = encodeWords('☕'.repeat(40)).split('\r\n ');
    expect(words.length).toBeGreaterThan(1);
    expect(words.every(word => /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/.test(word) && word.length <= 75)).toBe(true);
  });

  test.each<[string, {rfc822Id: string | null; referenceIds: string[] | null; inReplyTo: string | null}, {inReplyTo: string | null; references: string[]}]>([
    ['a first email', {rfc822Id: '<a@x>', referenceIds: [], inReplyTo: null}, {inReplyTo: '<a@x>', references: ['<a@x>']}],
    ['a thread', {rfc822Id: '<c@x>', referenceIds: ['<a@x>', '<b@x>'], inReplyTo: '<b@x>'}, {inReplyTo: '<c@x>', references: ['<a@x>', '<b@x>', '<c@x>']}],
    ['References unknown, In-Reply-To known', {rfc822Id: '<c@x>', referenceIds: null, inReplyTo: '<b@x>'}, {inReplyTo: '<c@x>', references: ['<b@x>', '<c@x>']}],
    ['headers unknown', {rfc822Id: '<c@x>', referenceIds: null, inReplyTo: null}, {inReplyTo: '<c@x>', references: ['<c@x>']}],
    ['References already naming it', {rfc822Id: '<c@x>', referenceIds: ['<a@x>', '<c@x>'], inReplyTo: null}, {inReplyTo: '<c@x>', references: ['<a@x>', '<c@x>']}],
    ['no Message-ID', {rfc822Id: null, referenceIds: ['<a@x>'], inReplyTo: '<a@x>'}, {inReplyTo: null, references: ['<a@x>']}],
    ['nothing at all', {rfc822Id: null, referenceIds: null, inReplyTo: null}, {inReplyTo: null, references: []}],
  ])('replyHeaders: %s', (_name, answered, expected) => {
    expect(replyHeaders(answered)).toEqual(expected);
  });
});

const original: QuotedEmail = {
  fromName: 'Sam Ortiz', fromAddress: 'sam.ortiz@example.org', subject: 'Thursday', receivedAt: '2026-11-12T23:04:00Z',
  to: [{name: 'User', address: 'user.work@example.com'}], cc: [june], bodyText: 'Are we on for Thursday?\n\nSam',
  bodyHtml: '<p onclick="steal()">Are we on for <b>Thursday</b>?</p><script>steal()</script><img src="https://cdn.example/x.png">',
};
const blocks: Block[] = [
  {type: 'paragraph', runs: [{text: 'Yes, ', marks: [], href: null}, {text: 'see you', marks: ['bold'], href: null}, {text: ' there', marks: [], href: 'https://maps.example/x'}]},
  {type: 'list', ordered: false, items: [{runs: [{text: 'Bring the notes', marks: [], href: null}]}]},
];

describe('composeBody', () => {
  test('the reply line names the day in the owner\'s zone, and the sender or their address', () => {
    expect(replyLine(original, ZONE)).toBe('On Nov 12, 2026, Sam Ortiz wrote:');
    expect(replyLine({...original, fromName: ' ', receivedAt: '2026-11-13T07:30:00Z'}, ZONE)).toBe('On Nov 12, 2026, sam.ortiz@example.org wrote:');
  });

  test('a new message is the user\'s text alone, a link\'s address after its words in the text copy', () => {
    const body = composeBody(blocks, null, ZONE);
    expect(body.text).toBe('Yes, see you there <https://maps.example/x>\n- Bring the notes');
    expect(body.html).toBe('<div dir="ltr">Yes, <b>see you</b><a href="https://maps.example/x"> there</a><br><ul><li>Bring the notes</li></ul></div>');
  });

  test('a reply quotes the original under its line, cleaned as the reader cleans it', () => {
    const body = composeBody(blocks, {kind: 'reply', email: original}, ZONE);
    expect(body.text).toBe('Yes, see you there <https://maps.example/x>\n- Bring the notes\n\nOn Nov 12, 2026, Sam Ortiz wrote:\n> Are we on for Thursday?\n>\n> Sam');
    expect(body.html).toContain('On Nov 12, 2026, Sam Ortiz wrote:<br></div><blockquote');
    expect(body.html).toContain('Are we on for <b>Thursday</b>?');
    expect(body.html).toContain('https://cdn.example/x.png');
    expect(body.html).not.toMatch(/script|onclick/);
  });

  test('a reply to plain-text mail quotes its lines', () => {
    const body = composeBody([], {kind: 'reply', email: {...original, bodyHtml: null, bodyText: 'a < b\nc'}}, ZONE);
    expect(body.html).toContain('<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex"><div>a &lt; b<br>c</div></blockquote>');
  });

  test('a forward carries the email in full under its header lines', () => {
    const body = composeBody([], {kind: 'forward', email: original}, ZONE);
    expect(body.text).toBe([
      '', '', '---------- Forwarded message ---------', 'From: Sam Ortiz <sam.ortiz@example.org>', 'Date: Thu, Nov 12, 2026 at 3:04 PM',
      'Subject: Thursday', 'To: User <user.work@example.com>', 'Cc: June Park <june.park@example.org>', '', 'Are we on for Thursday?', '', 'Sam',
    ].join('\n'));
    expect(body.html).toContain('From: Sam Ortiz &lt;sam.ortiz@example.org&gt;<br>');
    expect(body.html).not.toContain('<blockquote');
  });
});
