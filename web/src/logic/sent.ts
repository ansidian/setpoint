// Sent's rules: how a sent email's row names who it went to.
import type {Recipient} from '@setpoint/shared';

/**
 * Where a received row shows its sender, a sent row reads "To Sam Ortiz": its first recipient's name,
 * or the address when it has none, from To, else Cc. `more` counts the rest of To and Cc ("+2"),
 * kept apart so a long name is cut before the count is. Recipients Setpoint hasn't read yet (null)
 * read "To unknown", and mail with only Bcc recipients reads "Bcc only". `tip` names them all.
 */
export interface RecipientLine {
  lead: 'To' | null;
  name: string;
  more: number;
  // Whether the line names someone: "To unknown" and "Bcc only" read quieter.
  known: boolean;
  tip: string | null;
}

const named = (recipient: Recipient) => recipient.name?.trim() || recipient.address;
const written = (recipient: Recipient) => (recipient.name?.trim() ? `${recipient.name.trim()} <${recipient.address}>` : recipient.address);

export function recipientLine(to: Recipient[] | null | undefined, cc: Recipient[] | null | undefined): RecipientLine {
  if (!to) return {lead: 'To', name: 'unknown', more: 0, known: false, tip: null};
  const everyone = [...to, ...(cc ?? [])];
  const first = everyone[0];
  if (!first) return {lead: null, name: 'Bcc only', more: 0, known: false, tip: null};
  return {lead: 'To', name: named(first), more: everyone.length - 1, known: true, tip: everyone.map(written).join(', ')};
}

/** The line as one string, for a screen reader and a tooltip: "To Sam Ortiz +2". */
export const recipientText = (line: RecipientLine) => [line.lead, line.name, line.more ? `+${line.more}` : null].filter(Boolean).join(' ');

