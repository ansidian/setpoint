// The composer's pure rules: whether an email has anyone for Reply all (the server's own fill rule,
// shared/src/draftFill.ts), what a typed recipient is, a chip's words, and the reply's quote as the
// composer shows it under its fold.
import type {FromOut, MessageOut, Recipient} from '@setpoint/shared';
import {fillAnswer} from '@setpoint/shared/draftFill';
import {readHtml} from '@setpoint/shared/richText';
import type {Block} from '@setpoint/shared/richText';
import {paragraphs} from './body.ts';

type Answered = Pick<MessageOut, 'account_id' | 'from_name' | 'from_address' | 'subject'> & Partial<Pick<MessageOut, 'to' | 'cc' | 'reply_to'>>;

/**
 * Whether Reply all would reach anyone Reply doesn't: the email's other To and Cc recipients, less
 * the user's own addresses. Recipients not known yet (mail from before they were kept) count as none.
 */
export function hasOthers(message: Answered, from: FromOut | undefined): boolean {
  if (!from || message.to === undefined) return false;
  const account = from.accounts.find(one => one.account_id === message.account_id)?.addresses.map(address => address.address) ?? [];
  if (!account.length) return false;
  const own = from.accounts.flatMap(one => one.addresses.map(address => address.address));
  const email = {fromName: message.from_name, fromAddress: message.from_address, subject: message.subject, to: message.to ?? null, cc: message.cc ?? null, replyTo: message.reply_to ?? null,
    // Mail the user sent (Sent's, or mail to themselves) answers its own recipients.
    sent: own.includes(message.from_address.toLowerCase())};
  const count = (kind: 'reply' | 'reply_all') => {
    const filled = fillAnswer(kind, email, account, own);
    return filled.to.length + filled.cc.length;
  };
  return count('reply_all') > count('reply');
}

const ADDRESS = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

/**
 * What the user typed as a recipient: an address, or "Name <address>" as one pasted from elsewhere.
 * Null for anything else.
 */
export function readRecipient(typed: string): Recipient | null {
  const text = typed.trim().replace(/[,;]+$/, '').trim();
  const named = /^"?([^"<]*?)"?\s*<([^<>]+)>$/.exec(text);
  if (named) {
    const address = named[2]!.trim().toLowerCase();
    return ADDRESS.test(address) ? {name: named[1]!.trim() || null, address} : null;
  }
  return ADDRESS.test(text) ? {name: null, address: text.toLowerCase()} : null;
}

/** Several recipients pasted at once, split at commas, semicolons and new lines. */
export function readRecipients(pasted: string): {recipients: Recipient[]; rest: string} {
  const parts = pasted.split(/[,;\n]+(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(part => part.trim()).filter(Boolean);
  const recipients: Recipient[] = [];
  const rest: string[] = [];
  for (const part of parts) {
    const recipient = readRecipient(part);
    if (recipient) recipients.push(recipient);
    else rest.push(part);
  }
  return {recipients, rest: rest.join(', ')};
}

/** A chip's words: the name when there is one, else the address. */
export const chipLabel = (recipient: Recipient) => recipient.name?.trim() || recipient.address;

/** Adds recipients to a field's, each address once. */
export function withRecipients(field: Recipient[], added: Recipient[]): Recipient[] {
  const seen = new Set(field.map(one => one.address));
  return [...field, ...added.filter(one => !seen.has(one.address) && seen.add(one.address))];
}

/** The line above a reply's quote, as the server writes it: "On Oct 3, 2026, Theo Walsh wrote:". */
export function replyLine(message: Pick<MessageOut, 'from_name' | 'from_address' | 'received_at'>, timeZone: string): string {
  const day = new Intl.DateTimeFormat('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone}).format(new Date(message.received_at));
  return `On ${day}, ${message.from_name.trim() || message.from_address} wrote:`;
}

/** The original as the quote's blocks, for trimming: its HTML read as rich text, or its lines. */
export function quoteOf(message: Pick<MessageOut, 'body_html' | 'body_text'>): Block[] {
  if (message.body_html) return readHtml(message.body_html).blocks;
  return paragraphs(message.body_text).map(lines => ({type: 'paragraph' as const, runs: [{text: lines.join('\n'), marks: [], href: null}]}));
}
