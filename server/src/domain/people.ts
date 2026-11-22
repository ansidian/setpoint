// Recipient suggestions for the composer, from the mail Setpoint holds (no contacts, no new scope).
// The people the user has written to come first, by how often and how recently in one score: each
// email to them counts, halving every RECENCY_DAYS. Then the people who wrote to the user and were
// never answered, newest first. Automated senders stay out of that second group because only mail
// triaged as People is offered there (src/sending/people.ts). The user's own addresses never show.
//
// The query matches the start of the address or of a word of the name ("sam" finds Sam Ortiz and
// sam.ortiz@…, not Pat Osam), and several words match the name's start ("june p").
import type {Recipient} from '@setpoint/shared';

/** One time a person was seen: a recipient of mail the user sent, or the sender of mail they got. */
export interface Seen {
  address: string;
  name: string | null;
  at: string;
}

const RECENCY_DAYS = 90;
const DAY_MS = 86_400_000;

interface Person {
  address: string;
  name: string | null;
  // When the name was seen, so the latest one given wins.
  namedAt: string;
  last: string;
  score: number;
}

function gather(seen: Seen[], skip: Set<string>, now: number): Map<string, Person> {
  const people = new Map<string, Person>();
  for (const one of seen) {
    const address = one.address.trim().toLowerCase();
    if (!address || skip.has(address)) continue;
    const weight = 0.5 ** (Math.max(0, now - Date.parse(one.at)) / DAY_MS / RECENCY_DAYS);
    const name = one.name?.trim() || null;
    const person = people.get(address) ?? {address, name: null, namedAt: '', last: one.at, score: 0};
    person.score += weight;
    if (one.at > person.last) person.last = one.at;
    if (name && one.at >= person.namedAt) {
      person.name = name;
      person.namedAt = one.at;
    }
    people.set(address, person);
  }
  return people;
}

/** Whether `query` names this person: the start of the address, a word of the name, or the name's start. */
export function matchesPerson(person: Recipient, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return true;
  const name = (person.name ?? '').toLowerCase();
  if (person.address.startsWith(q) || name.startsWith(q)) return true;
  return !q.includes(' ') && name.split(/[\s.,'"()-]+/).some(word => word.startsWith(q));
}

export function rankPeople({written, heard, own, query, now, limit}: {
  written: Seen[];
  heard: Seen[];
  own: string[];
  query: string;
  now: string;
  limit: number;
}): Recipient[] {
  const at = Date.parse(now);
  const skip = new Set(own.map(address => address.toLowerCase()));
  const writtenTo = gather(written, skip, at);
  const unanswered = gather(heard, new Set([...skip, ...writtenTo.keys()]), at);
  const first = [...writtenTo.values()].sort((a, b) => b.score - a.score || b.last.localeCompare(a.last));
  const then = [...unanswered.values()].sort((a, b) => b.last.localeCompare(a.last) || b.score - a.score);
  return [...first, ...then].map(({name, address}) => ({name, address})).filter(person => matchesPerson(person, query)).slice(0, limit);
}
