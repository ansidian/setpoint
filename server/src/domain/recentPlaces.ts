// Recent places (darma SV-71): what a bare "@" in the editor's line and an empty Place field offer
// before anything is typed. They're the places the user's events have used, the most used first,
// then the most recent. Spellings of one place count together, shown as the latest one spells it,
// with the latest address any of them has. A link is a meeting, not a place to offer.
//
// Pure: the caller reads the events' places.
import type {RecentPlaceOut} from '@setpoint/shared';

/** One event's place, with when it starts (an instant or a day; null sorts last). */
export interface PlaceUse {
  place: string;
  address: string | null;
  at: string | null;
}

const LINK = /^(?:https?:\/\/|www\.)/i;

export function recentPlaces(uses: PlaceUse[], limit = 6): RecentPlaceOut[] {
  const byName = new Map<string, {name: string; address: string | null; count: number; at: string | null; addressAt: string | null}>();
  for (const use of uses) {
    const name = use.place.trim();
    if (!name || LINK.test(name)) continue;
    const key = name.toLowerCase();
    const seen = byName.get(key) ?? {name, address: null, count: 0, at: null, addressAt: null};
    seen.count += 1;
    if (seen.at === null || (use.at !== null && use.at > seen.at)) {
      seen.at = use.at;
      seen.name = name;
    }
    const address = use.address?.trim() || null;
    if (address && (seen.address === null || (use.at !== null && (seen.addressAt === null || use.at > seen.addressAt)))) {
      seen.address = address;
      seen.addressAt = use.at;
    }
    byName.set(key, seen);
  }
  return [...byName.values()]
    .sort((a, b) => b.count - a.count || (b.at ?? '').localeCompare(a.at ?? '') || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({name, address}) => ({name, address}));
}
