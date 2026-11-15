// How a draft starts: a reply's recipients, its subject and its From, as tables.
import type {Recipient} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {draftSubject, fillAnswer, newMessageAccount, replyFrom} from '@setpoint/shared/draftFill';
import type {AnsweredEmail} from '@setpoint/shared/draftFill';

const sam: Recipient = {name: 'Sam Ortiz', address: 'sam.ortiz@example.org'};
const june: Recipient = {name: 'June Park', address: 'june.park@example.org'};
const theo: Recipient = {name: 'Theo Walsh', address: 'theo@example.net'};
const desk: Recipient = {name: 'Help desk', address: 'help@contoso.example'};
const me: Recipient = {name: 'User', address: 'user.work@example.com'};
const alias: Recipient = {name: null, address: 'hello@example.com'};
const otherAccount: Recipient = {name: null, address: 'user@icloud.example'};

const ACCOUNT = [me.address, alias.address];
const OWN = [...ACCOUNT, otherAccount.address];

const email = (fields: Partial<AnsweredEmail> = {}): AnsweredEmail => ({
  fromName: 'Sam Ortiz', fromAddress: 'Sam.Ortiz@example.org', subject: 'Thursday', to: [me], cc: [], replyTo: [], sent: false, ...fields,
});

describe('draftSubject', () => {
  test.each([
    ['reply', 'Thursday', 'Re: Thursday'],
    ['reply_all', 'Re: Thursday', 'Re: Thursday'],
    ['reply', 'RE:Thursday', 'RE:Thursday'],
    ['reply', 'Fwd: Thursday', 'Re: Fwd: Thursday'],
    ['reply', '', 'Re:'],
    ['forward', 'Thursday', 'Fwd: Thursday'],
    ['forward', 'Fw: Thursday', 'Fw: Thursday'],
    ['forward', 'FWD: Thursday', 'FWD: Thursday'],
    ['forward', 'Re: Thursday', 'Fwd: Re: Thursday'],
    ['new', 'Thursday', 'Thursday'],
  ] as const)('%s of "%s" → "%s"', (kind, subject, expected) => {
    expect(draftSubject(kind, subject)).toBe(expected);
  });
});

describe('fillAnswer: recipients', () => {
  test.each<[string, 'reply' | 'reply_all' | 'forward', Partial<AnsweredEmail>, Recipient[], Recipient[]]>([
    ['reply goes to the sender', 'reply', {}, [sam], []],
    ['reply goes to Reply-To when the sender set one', 'reply', {replyTo: [desk]}, [desk], []],
    ['reply with Reply-To unknown goes to the sender', 'reply', {replyTo: null}, [sam], []],
    ['reply ignores the other recipients', 'reply', {to: [me, june], cc: [theo]}, [sam], []],
    ['reply all adds the other To and the Cc', 'reply_all', {to: [me, june], cc: [theo]}, [sam, june], [theo]],
    ['reply all leaves out every own address, aliases and other accounts', 'reply_all', {to: [me, alias, june], cc: [otherAccount, theo]}, [sam, june], [theo]],
    ['reply all names each address once, To before Cc', 'reply_all', {to: [me, sam, june], cc: [june, sam, theo]}, [sam, june], [theo]],
    ['reply all with Reply-To answers it and keeps the others', 'reply_all', {replyTo: [desk], to: [me, june]}, [desk, june], []],
    ['reply all with unknown recipients adds no one', 'reply_all', {to: null, cc: null}, [sam], []],
    ['reply all to mail the user sent goes back to its recipients', 'reply_all', {fromName: 'User', fromAddress: me.address, sent: true, to: [sam, june], cc: [theo]}, [sam, june], [theo]],
    ['reply to mail the user sent goes back to its To', 'reply', {fromName: 'User', fromAddress: me.address, sent: true, to: [sam, june], cc: [theo]}, [sam, june], []],
    ['reply to mail to yourself goes to yourself', 'reply_all', {fromName: 'User', fromAddress: me.address, sent: true, to: [me]}, [me], []],
    ['a forward goes to no one yet', 'forward', {to: [me, june], cc: [theo]}, [], []],
  ])('%s', (_name, kind, fields, to, cc) => {
    const filled = fillAnswer(kind, email(fields), ACCOUNT, OWN);
    expect({to: filled.to, cc: filled.cc}).toEqual({to, cc});
  });

  test('addresses come lowercased and a missing name is null', () => {
    expect(fillAnswer('reply', email({fromName: ''}), ACCOUNT, OWN).to).toEqual([{name: null, address: 'sam.ortiz@example.org'}]);
  });
});

describe('replyFrom', () => {
  test.each<[string, Partial<AnsweredEmail>, string]>([
    ['the account\'s own address by default', {to: [june]}, me.address],
    ['the alias it came to', {to: [alias]}, alias.address],
    ['the alias in Cc', {to: [june], cc: [{name: null, address: 'HELLO@example.com'}]}, alias.address],
    ['To before Cc', {to: [me], cc: [alias]}, me.address],
    ['unknown recipients: the account\'s own', {to: null, cc: null}, me.address],
    ['mail the user sent: the address it was sent from', {fromAddress: alias.address, sent: true, to: [sam]}, alias.address],
    ['another account\'s address is not this account\'s', {to: [otherAccount]}, me.address],
  ])('%s', (_name, fields, expected) => {
    expect(replyFrom(email(fields), ACCOUNT)).toBe(expected);
  });
});

describe('newMessageAccount', () => {
  test.each<[string, number[], number | null, number | null, number | null]>([
    ['the account asked for', [1, 2, 3], 3, 2, 3],
    ['else the one last sent from', [1, 2, 3], null, 2, 2],
    ['an account asked for that is gone: the last sent from', [1, 2], 9, 2, 2],
    ['nothing sent yet: the first', [4, 1], null, null, 4],
    ['the last sent from is gone: the first', [4, 1], null, 9, 4],
    ['no accounts', [], null, null, null],
  ])('%s', (_name, accounts, asked, last, expected) => {
    expect(newMessageAccount(accounts, asked, last)).toBe(expected);
  });
});
