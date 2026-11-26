// A conversation's rules, as the lists and the reader share them. A row is a conversation, and its
// `id` is the email that placed it; any email of it names the same conversation.
import type {ConversationPersonOut, MessageRowOut} from '@setpoint/shared';

/** Whether the row is the conversation email `id` is in: its own id, or one of its emails'. */
export const holds = (row: Pick<MessageRowOut, 'id' | 'thread'>, id: number): boolean =>
  row.id === id || (row.thread?.ids.includes(id) ?? false);

/** The row among `rows` whose conversation email `id` is in, the row placed by it first. */
export function rowHolding<T extends Pick<MessageRowOut, 'id' | 'thread'>>(rows: Iterable<T>, id: number): T | undefined {
  let found: T | undefined;
  for (const row of rows) {
    if (row.id === id) return row;
    if (!found && holds(row, id)) found = row;
  }
  return found;
}

/** A person's short name in a list of several: their first name, or an address's name part. */
function shortName(person: ConversationPersonOut): string {
  if (person.me) return 'me';
  const name = person.name.trim();
  if (!name || name.includes('@')) return (name || person.address).split('@')[0]!;
  return name.split(/\s+/)[0]!;
}

/** How many names a row shows before it keeps only the first and the last two. */
const NAMES_SHOWN = 3;

/**
 * A conversation row's names: everyone in it, oldest first, the user as "me", and the email count
 * from two ("Dominic, me" and 4). One person shows as the row's sender does (`lone`, its
 * organisation or name). A long list keeps the first and the last two ("Dominic … Sara, me").
 */
export function conversationNames(row: Pick<MessageRowOut, 'thread'>, lone: string): {names: string; count: number | null} {
  const thread = row.thread;
  const count = thread && thread.count >= 2 ? thread.count : null;
  const people = thread?.people ?? [];
  if (people.length <= 1) return {names: people[0]?.me ? 'me' : lone, count};
  const names = people.map(shortName);
  if (names.length <= NAMES_SHOWN) return {names: names.join(', '), count};
  return {names: `${names[0]} … ${names.slice(-2).join(', ')}`, count};
}

/** What the foot's Reply answers: the newest email someone else sent, else the newest. Null with none. */
export function replyTarget(emails: {id: number; sent_only?: true}[]): number | null {
  for (let at = emails.length - 1; at >= 0; at -= 1) if (!emails[at]!.sent_only) return emails[at]!.id;
  return emails.at(-1)?.id ?? null;
}
