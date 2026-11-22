// A draft's body as the email's HTML and plain text: the user's rich text (shared/src/richText.ts),
// then, for a reply, the original quoted under a line such as "On Nov 12, 2026, Sam Ortiz wrote:",
// as the user trimmed it when they did, or, for a forward, the forwarded email in full under its own
// header lines. The original's HTML
// goes through the reader's own cleaning (src/domain/emailHtml.ts) first, so nothing in it runs.
import {forwardLines, replyLine} from '@setpoint/shared';
import type {Recipient} from '@setpoint/shared';
import {plainText, tidy, writeHtml} from '@setpoint/shared/richText';
import type {Block, List, Run} from '@setpoint/shared/richText';
import {safeEmail} from './emailHtml.ts';

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

/** The original's HTML, cleaned as the reader cleans it, or its text as lines. */
function originalHtml(email: QuotedEmail): string {
  if (email.bodyHtml) return safeEmail(email.bodyHtml, true).body;
  return `<div>${escapeHtml(email.bodyText).replace(/\r?\n/g, '<br>')}</div>`;
}

const quoteText = (text: string) => text.replace(/\r\n/g, '\n').split('\n').map(line => (line ? `> ${line}` : '>')).join('\n');
/**
 * The email's body: the user's text, and the original quoted (a reply) or carried in full (a
 * forward). A reply's `quote`, when the user trimmed it, takes the original's place, and an emptied
 * one leaves no quote. With no original (a new message, or one whose email is gone), the user's
 * text alone.
 */
export function composeBody(blocks: Block[], original: {kind: 'reply' | 'forward'; email: QuotedEmail; quote?: Block[] | null} | null, timeZone: string): EmailBody {
  const ownHtml = `<div dir="ltr">${writeHtml(blocks)}</div>`;
  const ownText = userText(blocks);
  const trimmed = original?.kind === 'reply' && original.quote ? tidy(original.quote) : null;
  if (!original || trimmed?.length === 0) return {html: ownHtml, text: ownText};
  const {email} = original;
  if (original.kind === 'reply') {
    const line = replyLine(email, timeZone);
    const quoted = trimmed ? `<div dir="ltr">${writeHtml(trimmed)}</div>` : originalHtml(email);
    return {
      html: `${ownHtml}<br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">${escapeHtml(line)}<br></div>`
        + `<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">${quoted}</blockquote></div>`,
      text: `${ownText}\n\n${line}\n${quoteText(trimmed ? userText(trimmed) : email.bodyText)}`,
    };
  }
  const lines = forwardLines(email, timeZone);
  return {
    html: `${ownHtml}<br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">${lines.map(escapeHtml).join('<br>')}<br></div><br>${originalHtml(email)}</div>`,
    text: `${ownText}\n\n${lines.join('\n')}\n\n${email.bodyText}`,
  };
}
