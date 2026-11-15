// How a draft starts: who a reply goes to, its subject and the address it is written from. Pure, so
// the web and the iPhone app get the same draft from the server, and the web knows from the same
// rule whether an email has anyone for Reply all.
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
import type {DraftKind} from './api/drafts.ts';
import type {Recipient} from './message.ts';

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
