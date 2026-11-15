// Which sent email answers an email of its thread, for "You replied Nov 15" and a row's reply mark.
//
// The reply is the earliest email the user sent after it, in its thread, that answers it:
// - its In-Reply-To names the email's Message-ID, when both are known;
// - else the last of its References does, when it has References;
// - else, with neither known (headers Setpoint hasn't read, a client that sent none, an email with no
//   Message-ID), by order: no other email came to the user between the two.
// So in a thread the user answers email by email, each email has its own reply, and a reply to a
// later email in the thread doesn't count for an earlier one. An email the user only sent is never
// answered, and mail to yourself is never its own reply.

export interface ThreadEmail {
  id: number;
  receivedAt: string;
  sent: boolean;
  received: boolean;
  rfc822Id: string | null;
  // Null while Setpoint hasn't read them.
  inReplyTo: string | null;
  referenceIds: string[] | null;
}

const before = (a: ThreadEmail, b: ThreadEmail) => a.receivedAt < b.receivedAt || (a.receivedAt === b.receivedAt && a.id < b.id);

/** The email the user sent that answers `email`, from the rest of its thread (any order), or null. */
export function replyOf(email: ThreadEmail, thread: ThreadEmail[]): ThreadEmail | null {
  if (!email.received) return null;
  const later = thread.filter(other => other.id !== email.id && before(email, other)).sort((a, b) => (before(a, b) ? -1 : 1));
  for (const sent of later) {
    if (!sent.sent) continue;
    if (email.rfc822Id && sent.inReplyTo) {
      if (sent.inReplyTo === email.rfc822Id) return sent;
      continue;
    }
    if (email.rfc822Id && sent.referenceIds?.length) {
      if (sent.referenceIds.at(-1) === email.rfc822Id) return sent;
      continue;
    }
    const between = later.some(other => other.received && !other.sent && before(other, sent));
    if (!between) return sent;
  }
  return null;
}
