// The reader's rules (DESIGN.md › The reader; BRIEF.md › Security mail) as tables: the sender's
// line, the actions offered, the facts card, which remote images load, attachments and CSV.
import type {MessageOut, RemoteContentOut} from '@setpoint/shared';
import {SEED_NOW, SEED_TIME_ZONE} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {attachmentLabel, attachmentType, factRows, fileSize, hasRemoteContent, paneWidth, parseCsv, previewKind, readerActions, remoteImages, senderLine, whenLabel} from '../src/logic/reader.ts';

const now = Date.parse(SEED_NOW);
const zone = SEED_TIME_ZONE;
const remote = (fields: Partial<RemoteContentOut> = {}): RemoteContentOut => ({domain: 'contosocoffee.example', trust_domain: 'contosocoffee.example', sender_authenticated: null, trusted: false, load: false, reason: 'unknown', ...fields});

describe('the reading pane\'s width', () => {
  test.each([
    ['dragged inside the bounds', 812.4, 812],
    ['too narrow', 300, 480],
    ['too wide', 2000, 1100],
    ['as stored', '900', 900],
    ['nothing stored', null, 680],
    ['an empty value', '', 680],
    ['junk', 'wide', 680],
  ] as const)('%s', (_name, width, expected) => expect(paneWidth(width)).toBe(expected));
});

describe('senderLine', () => {
  type Sender = Pick<MessageOut, 'from_name' | 'organisation' | 'via'> & Partial<Pick<MessageOut, 'remote_content'>>;
  test.each<[string, Sender, ReturnType<typeof senderLine>]>([
    ['the organisation and platform, in ink2', {from_name: 'Priya Raman', organisation: 'Northwind Talent', via: 'Greenhouse', remote_content: remote({domain: 'northwind.example'})},
      {text: 'Northwind Talent · via Greenhouse', tone: 'ink2'}],
    ['the organisation alone', {from_name: 'Dana Whitfield', organisation: 'Parkside Apartments', via: null, remote_content: remote({domain: 'parksideapts.example'})},
      {text: 'Parkside Apartments', tone: 'ink2'}],
    ['the organisation is the sender: its domain, in ink3', {from_name: 'Google', organisation: 'Google', via: null, remote_content: remote({domain: 'accounts.google.com'})},
      {text: 'accounts.google.com', tone: 'ink3'}],
    ['no organisation: the domain', {from_name: 'Sam Lee', organisation: null, via: null, remote_content: remote({domain: 'example.com'})},
      {text: 'example.com', tone: 'ink3'}],
    ['the platform alone', {from_name: 'Fabrikam', organisation: 'Fabrikam', via: 'Workday', remote_content: remote()},
      {text: 'via Workday', tone: 'ink2'}],
    // From the email's row while the email itself loads (reader-01): the domain waits for it.
    ['from its row: the organisation and platform', {from_name: 'Priya Raman', organisation: 'Northwind Talent', via: 'Greenhouse'},
      {text: 'Northwind Talent · via Greenhouse', tone: 'ink2'}],
    ['from its row, the organisation the sender: nothing until its domain is known', {from_name: 'Google', organisation: 'Google', via: null}, null],
  ])('%s', (_name, message, line) => {
    expect(senderLine(message)).toEqual(line);
  });
});

describe('readerActions', () => {
  test.each([
    ['an email that may hold a date', {kind: 'career', lane: 'attention', done: false}, {done: true, proposals: 'buttons', ask: true}],
    ['security: the facts card under the head, proposals in More', {kind: 'security', lane: 'attention', done: false}, {done: true, proposals: 'more', ask: true}],
    ['a security FYI row too, with no Done', {kind: 'security', lane: 'fyi', done: false}, {done: false, proposals: 'more', ask: true}],
    ['FYI: no Done, as opening already read it', {kind: 'money', lane: 'fyi', done: false}, {done: false, proposals: 'buttons', ask: true}],
    ['Noise: in More, no Done', {kind: null, lane: 'noise', done: false}, {done: false, proposals: 'more', ask: true}],
    ['Unsorted: under the head, no Done', {kind: null, lane: null, done: false}, {done: false, proposals: 'buttons', ask: true}],
    ['attention already Done (All, search): no Done', {kind: 'career', lane: 'attention', done: true}, {done: false, proposals: 'buttons', ask: true}],
  ] as const)('%s', (_name, message, actions) => {
    expect(readerActions(message)).toEqual(actions);
  });
});

describe('whenLabel', () => {
  test.each([
    ['today', '2026-10-07T15:52:00.000Z', 'Today, 8:52 AM'],
    ['yesterday', '2026-10-07T01:41:00.000Z', 'Yesterday, 6:41 PM'],
    ['this year', '2026-10-05T17:05:00.000Z', 'Mon, Oct 5, 10:05 AM'],
    ['last year', '2025-12-30T21:15:00.000Z', 'Dec 30, 2025, 1:15 PM'],
  ])('%s → %s', (_name, at, label) => {
    expect(whenLabel(at, now, zone)).toBe(label);
  });
});

describe('factRows', () => {
  const at = '2026-10-07T15:52:00.000Z';
  test('the recovery-email alert, from a place the user doesn\'t use (board 03)', () => {
    expect(factRows({what: 'Recovery email changed', device: 'Windows · Chrome', location: 'Phoenix, AZ', unfamiliar: true}, at, now, zone)).toEqual([
      {icon: 'history', label: 'What happened', value: 'Recovery email changed', note: null},
      {icon: 'schedule', label: 'When', value: 'Today, 8:52 AM', note: null},
      {icon: 'computer', label: 'Device', value: 'Windows · Chrome', note: null},
      {icon: 'location_on', label: 'Location', value: 'Phoenix, AZ', note: '· not a place you use'},
    ]);
  });

  test.each([
    ['a familiar sign-in has no note', {what: 'New sign-in', device: 'MacBook Pro', location: 'Los Angeles'}, ['What happened', 'When', 'Device', 'Location'], null],
    ['an app', {what: 'Access granted', app: 'Claude'}, ['What happened', 'When', 'App'], null],
    ['unfamiliar with no location marks the device', {what: 'New sign-in', device: 'Pixel 9', unfamiliar: true}, ['What happened', 'When', 'Device'], 'Device'],
    ['unfamiliar with neither has nowhere to say it', {what: 'Password changed', unfamiliar: true}, ['What happened', 'When'], null],
  ])('%s', (_name, facts, labels, noted) => {
    const rows = factRows(facts, at, now, zone);
    expect(rows.map(item => item.label)).toEqual(labels);
    expect(rows.find(item => item.note)?.label ?? null).toBe(noted);
  });
});

describe('which remote images load', () => {
  test.each([
    ['DMARC passed and not Noise: they load', remote({sender_authenticated: true, load: true}), true, false, {load: true, bar: false}],
    ['Noise, or not authenticated: hidden, with the bar', remote({sender_authenticated: true, load: false}), true, false, {load: false, bar: true}],
    ['authentication unknown: hidden', remote({sender_authenticated: null, load: false}), true, false, {load: false, bar: true}],
    ['a trusted domain loads', remote({trusted: true, load: true}), true, false, {load: true, bar: false}],
    ['Show loads them this time', remote(), true, true, {load: true, bar: false}],
    ['nothing remote: no bar', remote(), false, false, {load: false, bar: false}],
  ])('%s', (_name, content, hasRemote, shown, state) => {
    expect(remoteImages(content, hasRemote, shown)).toEqual(state);
  });

  test.each([
    ['an image', '<img src="https://cdn.contosocoffee.example/hero.jpg">', true],
    ['an unquoted, protocol-relative image', '<img src=//cdn.example/x.gif>', true],
    ['a background attribute', '<td background="http://cdn.example/bg.png">', true],
    ['a CSS background', '<div style="background: url(\'https://cdn.example/bg.png\')">', true],
    ['a remote stylesheet', '<link rel="stylesheet" href="https://cdn.example/s.css">', true],
    ['srcset', '<img srcset="https://cdn.example/a.png 2x">', true],
    ['an inline image', '<img src="data:image/png;base64,AAAA">', false],
    ['a link is not remote content', '<a href="https://myaccount.google.example">Check activity</a>', false],
    ['plain HTML', '<p>Hello</p>', false],
    ['no HTML', null, false],
  ])('%s', (_name, html, remoteContent) => {
    expect(hasRemoteContent(html)).toBe(remoteContent);
  });
});

describe('attachments', () => {
  test.each([
    ['Parkside\'s agreement', {filename: 'Renewal agreement.pdf', mime_type: 'application/pdf', size_bytes: 184 * 1024}, 'PDF · 184 KB', 'pdf'],
    ['a photo', {filename: 'IMG_2041.jpg', mime_type: 'image/jpeg', size_bytes: 2_516_582}, 'JPEG · 2.4 MB', 'image'],
    ['a PNG', {filename: 'receipt.png', mime_type: 'image/png', size_bytes: 48_000}, 'PNG · 47 KB', 'image'],
    ['a CSV', {filename: 'Statement Oct.csv', mime_type: 'text/csv', size_bytes: 900}, 'CSV · 900 bytes', 'csv'],
    ['a CSV Windows calls Excel', {filename: 'export.csv', mime_type: 'application/vnd.ms-excel', size_bytes: 2048}, 'CSV · 2 KB', 'csv'],
    ['no extension: the MIME type', {filename: 'invite', mime_type: 'text/calendar', size_bytes: 1100}, 'CALENDAR · 1 KB', null],
    ['a Word file has no preview', {filename: 'Cover letter.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size_bytes: 31_000}, 'DOCX · 30 KB', null],
    ['an SVG has no preview', {filename: 'logo.svg', mime_type: 'image/svg+xml', size_bytes: 3000}, 'SVG · 3 KB', null],
  ])('%s', (_name, file, label, kind) => {
    expect(attachmentLabel(file)).toBe(label);
    expect(previewKind(file)).toBe(kind);
  });

  // Each card's type tile (#163): its colour and glyph say what the file is before its name does.
  test.each([
    ['a PDF', 'Renewal agreement.pdf', 'application/pdf', 'pdf'],
    ['a PDF by its MIME type alone', 'statement', 'application/pdf', 'pdf'],
    ['a PNG', 'Unit 4B floor plan.png', 'image/png', 'image'],
    ['a photo', 'IMG_2041.JPG', 'image/jpeg', 'image'],
    ['an SVG, though it has no preview', 'logo.svg', 'image/svg+xml', 'image'],
    ['a CSV', 'Rent ledger.csv', 'text/csv', 'sheet'],
    ['an Excel file', 'Budget.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'sheet'],
    ['an old Excel file', 'Budget.xls', 'application/vnd.ms-excel', 'sheet'],
    ['a Numbers file', 'Trip.numbers', 'application/octet-stream', 'sheet'],
    ['a Word file', 'Cover letter.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'doc'],
    ['an old Word file', 'Lease.doc', 'application/msword', 'doc'],
    ['a Pages file', 'Essay.pages', 'application/octet-stream', 'doc'],
    ['rich text', 'Notes.rtf', 'application/rtf', 'doc'],
    ['plain text', 'readme.txt', 'text/plain', 'doc'],
    ['a ZIP', 'Photos.zip', 'application/zip', 'archive'],
    ['a gzip', 'logs.tar.gz', 'application/gzip', 'archive'],
    ['a RAR', 'Scans.rar', 'application/vnd.rar', 'archive'],
    ['a 7z', 'Backup.7z', 'application/x-7z-compressed', 'archive'],
    ['an invitation', 'invite.ics', 'text/calendar', 'calendar'],
    ['an invitation without an extension', 'invite', 'text/calendar', 'calendar'],
    ['anything else', 'setup.dmg', 'application/x-apple-diskimage', 'other'],
  ])('%s is %s', (_name, filename, mime_type, type) => {
    expect(attachmentType({filename, mime_type})).toBe(type);
  });

  test.each([
    [0, '0 bytes'], [1, '1 byte'], [1023, '1023 bytes'], [1024, '1 KB'], [1536, '2 KB'], [999 * 1024, '999 KB'],
    [1000 * 1024, '1 MB'], [1.25 * 1024 * 1024, '1.3 MB'], [12.4 * 1024 * 1024, '12 MB'], [3 * 1024 ** 3, '3 GB'],
  ])('%d bytes → %s', (bytes, size) => {
    expect(fileSize(bytes)).toBe(size);
  });
});

describe('parseCsv', () => {
  test.each([
    ['plain rows', 'Date,Amount\n2026-10-01,42.00\n', [['Date', 'Amount'], ['2026-10-01', '42.00']]],
    ['CRLF and no final line break', 'a,b\r\nc,d', [['a', 'b'], ['c', 'd']]],
    ['quoted commas, quotes and line breaks', '"Lee, Sam","He said ""hi""","two\nlines"', [['Lee, Sam', 'He said "hi"', 'two\nlines']]],
    ['empty fields', 'a,,c\n,,\n', [['a', '', 'c'], ['', '', '']]],
    ['a byte-order mark', '﻿Name\nSam', [['Name'], ['Sam']]],
    ['empty text', '', []],
  ])('%s', (_name, text, rows) => {
    expect(parseCsv(text)).toEqual(rows);
  });

  test('stops at the limit', () => {
    expect(parseCsv('1\n2\n3\n4\n', 2)).toEqual([['1'], ['2']]);
  });
});
