// The message builder and the body it carries, as tables. Every built email is read back through
// the parser the sync uses (src/providers/mime.ts), so what Setpoint sends is what it would read.
import {replyLine} from '@setpoint/shared';
import type {Recipient} from '@setpoint/shared';
import type {Block} from '@setpoint/shared/richText';
import {simpleParser} from 'mailparser';
import {describe, expect, test} from 'vitest';
import {composeBody} from '../src/domain/outgoingBody.ts';
import type {QuotedEmail} from '../src/domain/outgoingBody.ts';
import {buildMessage, encodeWords, formatAddress, inlineImages, replyHeaders} from '../src/domain/outgoingMessage.ts';
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
    const raw = buildMessage(message(fields), {bcc: true});
    const parsed = await parseEmail(raw);
    // The text part as sent (the record reads an email with HTML from its HTML).
    const text = ((await simpleParser(raw)).text ?? '').trim();
    const read = {fromName: parsed.fromName, fromAddress: parsed.fromAddress, to: parsed.to, cc: parsed.cc, subject: parsed.subject, rfc822Id: parsed.rfc822Id,
      inReplyTo: parsed.inReplyTo, references: parsed.references, text, html: parsed.html};
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

  test('a quoted inline image goes as a related part the HTML names by cid, with the original bytes', async () => {
    const png = Buffer.from('a png image');
    const html = `<p>FYI</p><img src="data:image/png;base64,${png.toString('base64')}" alt="Logo">`;
    const raw = buildMessage(message({html}), {bcc: false});
    const parsed = await simpleParser(raw, {keepCidLinks: true});
    expect(parsed.html).toContain('src="cid:img1.sp.1.abc"');
    expect(parsed.html).not.toContain('data:image');
    expect((parsed.attachments ?? []).map(file => ({cid: file.cid, type: file.contentType, related: file.related, content: file.content?.toString()})))
      .toEqual([{cid: 'img1.sp.1.abc', type: 'image/png', related: true, content: 'a png image'}]);
    expect((await parseEmail(raw)).attachments).toEqual([]);
  });

  test('without images the bytes are as before: alternative, no related part', () => {
    const raw = buildMessage(message(), {bcc: false}).toString('utf8');
    expect(raw).not.toContain('multipart/related');
    expect(headerBlock(Buffer.from(raw))).toContain('Content-Type: multipart/alternative; boundary="=_sp_alt_sp.1.abc"');
  });
});

describe('inlineImages', () => {
  const uri = (type: string, text: string) => `data:${type};base64,${Buffer.from(text).toString('base64')}`;
  test.each<[string, string, string, {cid: string; mimeType: string; content: string}[]]>([
    ['one png is one cid part', `<img src="${uri('image/png', 'one')}">`, '<img src="cid:img1.seed">', [{cid: 'img1.seed', mimeType: 'image/png', content: 'one'}]],
    ['the same URI twice is one part, named twice', `<img src="${uri('image/jpeg', 'same')}"><img alt="" src="${uri('image/jpeg', 'same')}">`,
      '<img src="cid:img1.seed"><img alt="" src="cid:img1.seed">', [{cid: 'img1.seed', mimeType: 'image/jpeg', content: 'same'}]],
    ['two images are two parts', `<img src="${uri('image/gif', 'a')}"><img src="${uri('image/webp', 'b')}">`, '<img src="cid:img1.seed"><img src="cid:img2.seed">',
      [{cid: 'img1.seed', mimeType: 'image/gif', content: 'a'}, {cid: 'img2.seed', mimeType: 'image/webp', content: 'b'}]],
    ['data:text/plain and an https image are untouched', `<a href="${uri('text/plain', 'x')}">x</a><img src="${uri('text/plain', 'y')}"><img src="https://example.org/a.png">`,
      `<a href="${uri('text/plain', 'x')}">x</a><img src="${uri('text/plain', 'y')}"><img src="https://example.org/a.png">`, []],
    ['no images leaves the HTML as it is', '<p>Hello</p>', '<p>Hello</p>', []],
  ])('%s', (_name, html, expectedHtml, expectedImages) => {
    const result = inlineImages(html, 'seed');
    expect(result.html).toBe(expectedHtml);
    expect(result.images.map(image => ({cid: image.cid, mimeType: image.mimeType, content: image.content.toString()}))).toEqual(expectedImages);
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

  test('a quote the user trimmed is sent as they left it, under the same line', () => {
    const trimmed: Block[] = [{type: 'paragraph', runs: [{text: 'Are we on for ', marks: [], href: null}, {text: 'Thursday', marks: ['bold'], href: null}, {text: '?', marks: [], href: null}]}];
    const body = composeBody(blocks, {kind: 'reply', email: original, quote: trimmed}, ZONE);
    expect(body.text).toBe('Yes, see you there <https://maps.example/x>\n- Bring the notes\n\nOn Nov 12, 2026, Sam Ortiz wrote:\n> Are we on for Thursday?');
    expect(body.html).toContain('padding-left:1ex"><div dir="ltr">Are we on for <b>Thursday</b>?</div></blockquote>');
    expect(body.html).not.toContain('cdn.example');
  });

  test('a quote the user emptied leaves the reply without one', () => {
    const body = composeBody(blocks, {kind: 'reply', email: original, quote: []}, ZONE);
    expect(body).toEqual(composeBody(blocks, null, ZONE));
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

  test('a forward names people as written, as the composer previews them, not as headers encode them', () => {
    const email = {...original, fromName: 'José Núñez', fromAddress: 'jose@example.es', to: [{name: 'Doe, Jane', address: 'jane.doe@example.com'}], cc: [{name: null, address: 'theo@example.net'}]};
    const body = composeBody([], {kind: 'forward', email}, ZONE);
    expect(body.text).toContain('From: José Núñez <jose@example.es>\n');
    expect(body.text).toContain('To: Doe, Jane <jane.doe@example.com>\nCc: theo@example.net\n');
    expect(body.html).toContain('From: José Núñez &lt;jose@example.es&gt;<br>');
    expect(body.html).toContain('To: Doe, Jane &lt;jane.doe@example.com&gt;<br>');
  });
});
