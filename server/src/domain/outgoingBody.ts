// A draft's body as the email's HTML and plain text: the user's rich text (shared/src/richText.ts),
// then, for a reply, the original quoted under a line such as "On Nov 12, 2026, Sam Ortiz wrote:",
// or, for a forward, the forwarded email in full under its own header lines. The original's HTML
// goes through the reader's own cleaning (src/domain/emailHtml.ts) first, so nothing in it runs.
import type {Recipient} from '@setpoint/shared';
import {plainText, tidy, writeHtml} from '@setpoint/shared/richText';
import type {Block, List, Run} from '@setpoint/shared/richText';
import {safeEmail} from './emailHtml.ts';
import {formatAddress} from './outgoingMessage.ts';

/** The email a reply quotes or a forward carries, as the record has it. */
export interface QuotedEmail {
  fromName: string;
  fromAddress: string;
  subject: string;
  receivedAt: string;
  to: Recipient[] | null;
  cc: Recipient[] | null;
  bodyText: string;
  bodyHtml: string | null;
}

export interface EmailBody {
  html: string;
  text: string;
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A link's address after its words in the plain-text copy, unless the words are the address. */
function linkedRuns(runs: Run[]): Run[] {
  return runs.map(run => (run.href && run.text.trim() !== run.href ? {...run, text: `${run.text} <${run.href}>`} : run));
}
function linkedList(list: List): List {
  return {ordered: list.ordered, items: list.items.map(item => ({runs: linkedRuns(item.runs), ...(item.sub ? {sub: linkedList(item.sub)} : {})}))};
}
const linked = (blocks: Block[]): Block[] => blocks.map(block => (block.type === 'list' ? {type: 'list', ...linkedList(block)} : block.type === 'code' ? block : {...block, runs: linkedRuns(block.runs)}));

/** The plain-text copy of the user's text, a list item per line with its bullet or number. */
function userText(blocks: Block[]): string {
  const lines: string[] = [];
  const list = (block: List, depth: number) => block.items.forEach((item, index) => {
    lines.push(`${'  '.repeat(depth)}${block.ordered ? `${index + 1}.` : '-'} ${item.runs.map(run => run.text).join('')}`);
    if (item.sub) list(item.sub, depth + 1);
  });
  for (const block of tidy(linked(blocks))) {
    if (block.type === 'list') list(block, 0);
    else lines.push(plainText([block]));
  }
  return lines.join('\n');
}

/** "Nov 12, 2026" in the owner's zone. */
function quotedDay(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone}).format(new Date(instant));
}

/** "Thu, Nov 12, 2026 at 3:04 PM" in the owner's zone, for a forward's Date line. */
function quotedMoment(instant: string, timeZone: string): string {
  const date = new Date(instant);
  const day = new Intl.DateTimeFormat('en-US', {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone}).format(date);
  const time = new Intl.DateTimeFormat('en-US', {hour: 'numeric', minute: '2-digit', timeZone}).format(date);
  return `${day} at ${time}`;
}

/** The reply's line above the quote: "On Nov 12, 2026, Sam Ortiz wrote:". */
export function replyLine(email: Pick<QuotedEmail, 'fromName' | 'fromAddress' | 'receivedAt'>, timeZone: string): string {
  return `On ${quotedDay(email.receivedAt, timeZone)}, ${email.fromName.trim() || email.fromAddress} wrote:`;
}

/** The original's HTML, cleaned as the reader cleans it, or its text as lines. */
function originalHtml(email: QuotedEmail): string {
  if (email.bodyHtml) return safeEmail(email.bodyHtml, true).body;
  return `<div>${escapeHtml(email.bodyText).replace(/\r?\n/g, '<br>')}</div>`;
}

const quoteText = (text: string) => text.replace(/\r\n/g, '\n').split('\n').map(line => (line ? `> ${line}` : '>')).join('\n');
const list = (recipients: Recipient[] | null) => (recipients ?? []).map(formatAddress).join(', ');

/** The forward's header lines: From, Date, Subject, To and Cc (when it had one). */
function forwardLines(email: QuotedEmail, timeZone: string): string[] {
  return [
    '---------- Forwarded message ---------',
    `From: ${formatAddress({name: email.fromName || null, address: email.fromAddress})}`,
    `Date: ${quotedMoment(email.receivedAt, timeZone)}`,
    `Subject: ${email.subject}`,
    ...(email.to?.length ? [`To: ${list(email.to)}`] : []),
    ...(email.cc?.length ? [`Cc: ${list(email.cc)}`] : []),
  ];
}

/**
 * The email's body: the user's text, and the original quoted (a reply) or carried in full (a
 * forward). With no original (a new message, or one whose email is gone), the user's text alone.
 */
export function composeBody(blocks: Block[], original: {kind: 'reply' | 'forward'; email: QuotedEmail} | null, timeZone: string): EmailBody {
  const ownHtml = `<div dir="ltr">${writeHtml(blocks)}</div>`;
  const ownText = userText(blocks);
  if (!original) return {html: ownHtml, text: ownText};
  const {email} = original;
  if (original.kind === 'reply') {
    const line = replyLine(email, timeZone);
    return {
      html: `${ownHtml}<br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">${escapeHtml(line)}<br></div>`
        + `<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">${originalHtml(email)}</blockquote></div>`,
      text: `${ownText}\n\n${line}\n${quoteText(email.bodyText)}`,
    };
  }
  const lines = forwardLines(email, timeZone);
  return {
    html: `${ownHtml}<br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">${lines.map(escapeHtml).join('<br>')}<br></div><br>${originalHtml(email)}</div>`,
    text: `${ownText}\n\n${lines.join('\n')}\n\n${email.bodyText}`,
  };
}
