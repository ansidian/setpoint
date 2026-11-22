// The lines Setpoint writes above a quoted or forwarded email: a reply's "On Nov 12, 2026, Sam Ortiz
// wrote:" and a forward's header lines. The server writes them into the email, and the composer
// previews them, from this one rule. Dates are in the owner's zone.
import type {Recipient} from './message.ts';

export interface QuotedLines {
  fromName: string;
  fromAddress: string;
  subject: string;
  receivedAt: string;
  to: Recipient[] | null;
  cc: Recipient[] | null;
}

/** "Nov 12, 2026". */
function quotedDay(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {month: 'short', day: 'numeric', year: 'numeric', timeZone}).format(new Date(instant));
}

/** "Thu, Nov 12, 2026 at 3:04 PM", for a forward's Date line. */
function quotedMoment(instant: string, timeZone: string): string {
  const date = new Date(instant);
  const day = new Intl.DateTimeFormat('en-US', {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone}).format(date);
  const time = new Intl.DateTimeFormat('en-US', {hour: 'numeric', minute: '2-digit', timeZone}).format(date);
  return `${day} at ${time}`;
}

/** A person as the body names them, as written: "Name <address>", or the address alone. */
const named = ({name, address}: Recipient) => (name?.trim() ? `${name.trim()} <${address}>` : address);
const list = (recipients: Recipient[] | null) => (recipients ?? []).map(named).join(', ');

/** The reply's line above the quote: "On Nov 12, 2026, Sam Ortiz wrote:". */
export function replyLine(email: Pick<QuotedLines, 'fromName' | 'fromAddress' | 'receivedAt'>, timeZone: string): string {
  return `On ${quotedDay(email.receivedAt, timeZone)}, ${email.fromName.trim() || email.fromAddress} wrote:`;
}

/** The forward's header lines: the dashes, From, Date, Subject, then To and Cc when it had them. */
export function forwardLines(email: QuotedLines, timeZone: string): string[] {
  return [
    '---------- Forwarded message ---------',
    `From: ${named({name: email.fromName, address: email.fromAddress})}`,
    `Date: ${quotedMoment(email.receivedAt, timeZone)}`,
    `Subject: ${email.subject}`,
    ...(email.to?.length ? [`To: ${list(email.to)}`] : []),
    ...(email.cc?.length ? [`Cc: ${list(email.cc)}`] : []),
  ];
}
