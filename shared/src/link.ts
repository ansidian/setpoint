// An event's link, read the same by the server (ItemOut's `link`) and the web app (the place line's
// look): DESIGN.md #245 for a link in the place (SV-77), and D439 for the event's own URL (SV-179).

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

// shared/ is typed without the DOM or Node, and both have WHATWG's URL.
declare const URL: new (url: string) => {protocol: string; hostname: string};

/** The host of an http or https link, without a leading "www."; null for anything else. */
function webHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.hostname.replace(/^www\./i, '') || null;
  } catch {
    return null;
  }
}

/** The place's link, if it has one: in the place, or in an address Google kept on the same line. */
export function placeLink(item: {place: string | null; address: string | null}): PlaceLink | null {
  const text = [item.place?.trim(), item.address?.trim()].filter(Boolean).join(', ');
  const found = LINK.exec(text);
  if (!found) return null;
  const url = /^www\./i.test(found[0]) ? `https://${found[0]}` : found[0];
  const host = webHost(url);
  return host ? {url, host, only: found[0] === text} : null;
}

/** An http or https URL as its link and host (Google's `source.url`); null for any other text. */
export function webLink(url: string | null): {url: string; host: string} | null {
  const text = url?.trim();
  if (!text || /\s/.test(text)) return null;
  const host = webHost(text);
  return host ? {url: text, host} : null;
}

/**
 * The event's link, for Open (D439): the place's link, else its own URL (Google's `source.url`, an
 * .ics file's URL line), else none. Only http and https count; a bare domain isn't a link.
 */
export function eventLink(item: {place: string | null; address: string | null; source_url: string | null}): string | null {
  return placeLink(item)?.url ?? webLink(item.source_url)?.url ?? null;
}
