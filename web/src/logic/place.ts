// Where an item is, as the floating detail, the failed card, the agenda and search lines show it
// (DESIGN.md › The floating detail, board 12a): the place, then its address in full. Google keeps one
// location line, so an event placed at a street address comes back as the address alone
// (server/src/providers/gcal/normalize.ts).

/**
 * The place and its address as two lines. An address alone leads with its street ("1420 Elm St",
 * then "Los Angeles, CA 90026"), and one that starts with the place doesn't say it twice.
 */
export function placeLines(place: string | null, address: string | null): {name: string; address: string | null} | null {
  const name = place?.trim() || null;
  const full = address?.trim() || null;
  if (!full) return name ? {name, address: null} : null;
  if (name && full !== name && !full.startsWith(`${name}, `)) return {name, address: full};
  const comma = full.indexOf(', ');
  const lead = name ?? (comma < 0 ? full : full.slice(0, comma));
  return {name: lead, address: full.slice(lead.length + 2) || null};
}

/** The place in one line: its name, or the street of an address alone. */
export const placeName = (item: {place: string | null; address: string | null}) => placeLines(item.place, item.address)?.name ?? null;
