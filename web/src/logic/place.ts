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

/** A link in an item's place (SV-77): where it goes, its host, and whether it's all the place says. */
export interface PlaceLink {
  url: string;
  // "zoom.us", without a leading "www.".
  host: string;
  // The place is the link alone: drawn as `videocam` and the host (#125) rather than as written.
  only: boolean;
}

// The first web link in the words, without punctuation after it ("…/j/1)." ends at "1").
const LINK = /(?:https?:\/\/|www\.)[^\s<>"]+?(?=[.,;:!?)\]]*(?:\s|$))/i;

/** The place's link, if it has one: in the place, or in an address Google kept on the same line. */
export function placeLink(item: {place: string | null; address: string | null}): PlaceLink | null {
  const text = [item.place?.trim(), item.address?.trim()].filter(Boolean).join(', ');
  const found = LINK.exec(text);
  if (!found) return null;
  const url = /^www\./i.test(found[0]) ? `https://${found[0]}` : found[0];
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '');
    return host ? {url, host, only: found[0] === text} : null;
  } catch {
    return null;
  }
}
