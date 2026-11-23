// How a draft starts: who a reply goes to, its subject and the address it is written from. Pure, so
// the server fills the draft and the web knows from the same rule whether an email has anyone for
// Reply all.
//
// - Reply goes to Reply-To when the sender set one, else to the sender. A reply to mail the user
//   sent goes back to its own recipients, as Gmail's does.
// - Reply all adds the email's other To and Cc recipients, less the user's own addresses (every
//   account's, aliases included), each address once, To before Cc.
// - The subject gets "Re: " or "Fwd: " once.
// - From is the address the email came to when it is one of the receiving account's own (an alias),
//   else that account's own address. A new message starts from the account asked for, else the
//   one the user last sent from, else the first account.
// Recipients a header never named are null (unknown): they add no one.
//
// A draft is empty while it is exactly as the server filled it (draftEmpty): what a reply or
// forward starts with never makes it a draft, any change the user makes does. Empty drafts stay out
// of Drafts, its count and an email's "Draft" mark, Esc discards them quietly, a closing tab
// discards them, and the server sweeps those untouched for a day.
import type {DraftKind} from './api/drafts.ts';
import type {Recipient} from './message.ts';
import {isEmpty} from './richText.ts';
import type {Block} from './richText.ts';

export interface AnsweredEmail {
  fromName: string;
  fromAddress: string;
  subject: string;
  to: Recipient[] | null;
  cc: Recipient[] | null;
  replyTo: Recipient[] | null;
  // The user sent it (Sent, or mail to yourself).
  sent: boolean;
}

export interface FilledDraft {
  fromAddress: string;
  to: Recipient[];
  cc: Recipient[];
  subject: string;
}

const lower = (address: string) => address.trim().toLowerCase();

/** Each address once, in order, leaving out `skip`'s. */
function distinct(recipients: Recipient[], skip: Set<string>): Recipient[] {
  const seen = new Set(skip);
  const out: Recipient[] = [];
  for (const recipient of recipients) {
    const address = lower(recipient.address);
    if (!address || seen.has(address)) continue;
    seen.add(address);
    out.push({name: recipient.name || null, address});
  }
  return out;
}

const REPLY_PREFIX = /^\s*re\s*:/i;
const FORWARD_PREFIX = /^\s*(fwd?|fw)\s*:/i;

/** The subject a reply or forward starts with: its prefix once. */
export function draftSubject(kind: DraftKind, subject: string): string {
  if (kind === 'new') return subject;
  const [prefix, has] = kind === 'forward' ? ['Fwd:', FORWARD_PREFIX] : ['Re:', REPLY_PREFIX];
  if (has.test(subject)) return subject;
  return `${prefix} ${subject}`.trimEnd();
}

/** Who a reply answers: Reply-To, else the sender; the email's own recipients when the user sent it. */
function replyTargets(email: AnsweredEmail, own: Set<string>): Recipient[] {
  if (email.sent && own.has(lower(email.fromAddress)) && email.to?.length) return email.to;
  if (email.replyTo?.length) return email.replyTo;
  return [{name: email.fromName || null, address: email.fromAddress}];
}

/**
 * The account's address an email came to: one of `accountAddresses` (its own first, then its
 * aliases) named in To, then Cc, or that the user sent it from; else the account's own.
 */
export function replyFrom(email: AnsweredEmail, accountAddresses: string[]): string {
  const mine = accountAddresses.map(lower);
  const named = [...(email.sent ? [{name: null, address: email.fromAddress}] : []), ...(email.to ?? []), ...(email.cc ?? [])].map(recipient => lower(recipient.address));
  return named.find(address => mine.includes(address)) ?? mine[0]!;
}

/**
 * A reply, reply all or forward of `email`, written from the receiving account. `accountAddresses`
 * is that account's (its own first), `ownAddresses` every account's, aliases included.
 */
export function fillAnswer(kind: Exclude<DraftKind, 'new'>, email: AnsweredEmail, accountAddresses: string[], ownAddresses: Iterable<string>): FilledDraft {
  const own = new Set([...ownAddresses].map(lower));
  const fromAddress = replyFrom(email, accountAddresses);
  const subject = draftSubject(kind, email.subject);
  if (kind === 'forward') return {fromAddress, to: [], cc: [], subject};
  const targets = replyTargets(email, own);
  const to = distinct(targets, new Set());
  if (kind === 'reply') return {fromAddress, to, cc: [], subject};
  const others = distinct([...to, ...(email.to ?? [])], own);
  // The reply's own targets stay even when they are the user's (mail to yourself).
  const allTo = distinct([...to, ...others], new Set());
  const cc = distinct(email.cc ?? [], new Set([...own, ...allTo.map(recipient => recipient.address)]));
  return {fromAddress, to: allTo, cc, subject};
}

/** The account a new message starts from: the one asked for, else the last sent from, else the first. */
export function newMessageAccount(accountIds: number[], asked: number | null, lastSentFrom: number | null): number | null {
  if (asked !== null && accountIds.includes(asked)) return asked;
  if (lastSentFrom !== null && accountIds.includes(lastSentFrom)) return lastSentFrom;
  return accountIds[0] ?? null;
}

/** What a draft starts with that the user can change: its recipients and subject. */
export type DraftFill = Pick<FilledDraft, 'to' | 'cc' | 'subject'>;

/** A new message starts with no one to send to and no subject. */
export const NEW_MESSAGE_FILL: DraftFill = {to: [], cc: [], subject: ''};

/** What a draft holds, as draftEmpty reads it. `files` counts the user's own; `sending`: Send has it (held, sending or failed). */
export interface DraftContent {
  to: Recipient[];
  cc: Recipient[];
  bcc: Recipient[];
  subject: string;
  body: Block[];
  quote: Block[] | null;
  removedAttachments: number[];
  files: number;
  sending: boolean;
}

const addresses = (recipients: Recipient[]) => recipients.map(recipient => lower(recipient.address)).sort().join('\n');

/**
 * Whether a draft is still exactly as the server filled it (`fill`): no words, no file, the quote
 * and a forward's originals untouched, no one in Bcc, and the same people (by address, in any
 * order) and subject it started with. From and help me write's line don't count. A draft whose
 * start isn't known (null: its email is gone) or that Send has is never empty.
 */
export function draftEmpty(draft: DraftContent, fill: DraftFill | null): boolean {
  if (!fill || draft.sending || draft.files > 0 || draft.quote !== null || draft.removedAttachments.length > 0 || draft.bcc.length > 0) return false;
  if (!isEmpty(draft.body)) return false;
  return addresses(draft.to) === addresses(fill.to) && addresses(draft.cc) === addresses(fill.cc) && draft.subject.trim() === fill.subject.trim();
}
