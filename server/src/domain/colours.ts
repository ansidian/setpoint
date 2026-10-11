// A Google calendar's colour as one of darma's swatches (DESIGN.md › Colour: accounts and
// calendars pick from the 11). v1 mapped Google's colours to Google's own 11 event swatches by
// redmean distance (`calendar-event-colors`); v2's swatches are darma's oklch tokens, so the match is
// by hue in OKLCH, and a colour with almost no chroma (Graphite, Google's greys) is `ink2`.
import type {Colour, EventColour} from '@setpoint/shared';

// The Night tokens' hues (web/src/tokens.ts).
const HUES: [Colour, number][] = [
  ['alert', 25], ['caution', 40], ['warm', 55], ['sun', 92], ['good', 150], ['comf', 165], ['cyan', 195], ['cool', 235], ['violet', 300],
];
const GREY_CHROMA = 0.04;

const linear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** A `#rrggbb` colour's OKLCH chroma and hue (degrees). */
export function oklch(hex: string): {l: number; c: number; h: number} | null {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!match) return null;
  const [r, g, b] = [match[1]!, match[2]!, match[3]!].map(part => linear(parseInt(part, 16))) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return {l: L, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h};
}

/**
 * SV-20 (D33): what Setpoint writes as a calendar's colour at Google (calendarList.patch with
 * colorRgbFormat), each swatch's Night token in sRGB, so Google's own app shows the swatch. Each reads
 * back as its swatch: exactly (ink3 is a grey, which hue alone would read as ink2).
 */
export const CALENDAR_HEX: Record<Colour, string> = {
  ink2: '#a3a4a8', ink3: '#7d7f84', cool: '#71c9fa', warm: '#f5ab77', caution: '#ff865b', comf: '#73d4ac', good: '#7cd591', sun: '#f7cd3a', alert: '#fd736d', violet: '#c8aefa', cyan: '#57d4d4',
};
/** What earlier builds wrote for a swatch since moved (SV-58): calendars already carrying it read back as it. */
const WRITTEN_BEFORE: Record<string, Colour> = {'#707277': 'ink3'};
const WRITTEN = new Map([...Object.entries(WRITTEN_BEFORE), ...Object.entries(CALENDAR_HEX).map(([swatch, hex]) => [hex, swatch as Colour] as const)]);

/** Text on a calendar's colour in Google's app: dark on the light swatches, white on ink3. */
export const foregroundFor = (hex: string) => ((oklch(hex)?.l ?? 1) > 0.6 ? '#000000' : '#ffffff');

/** The swatch Setpoint wrote, else the one nearest a Google colour by hue; greys and anything unreadable are `ink2`. */
export function swatchFor(hex: string | null | undefined): Colour {
  const written = hex ? WRITTEN.get(hex.trim().toLowerCase()) : undefined;
  if (written) return written;
  const colour = hex ? oklch(hex) : null;
  if (!colour || colour.c < GREY_CHROMA) return 'ink2';
  let best: Colour = 'ink2';
  let bestDistance = Infinity;
  for (const [name, hue] of HUES) {
    const distance = Math.min(Math.abs(colour.h - hue), 360 - Math.abs(colour.h - hue));
    if (distance < bestDistance) [best, bestDistance] = [name, distance];
  }
  return best;
}

/**
 * Google Calendar's eleven event colours (the API's `colors.get` event palette), by colorId. An
 * event's own colour reads as the nearest swatch; several of Google's fall on one swatch (Lavender
 * and Grape are both `violet`, Flamingo and Tomato both `alert`).
 */
export const GOOGLE_EVENT_COLOURS: Record<string, string> = {
  1: '#a4bdfc', 2: '#7ae7bf', 3: '#dbadff', 4: '#ff887c', 5: '#fbd75b', 6: '#ffb878', 7: '#46d6db', 8: '#e1e1e1', 9: '#5484ed', 10: '#51b749', 11: '#dc2127',
};

/** The colorId Setpoint writes for each swatch an event can take (shared EVENT_COLOURS): one that reads back as it. */
export const EVENT_COLOUR_IDS: Record<EventColour, string> = {
  ink2: '8', cool: '9', warm: '6', comf: '2', good: '10', sun: '5', alert: '11', violet: '3', cyan: '7',
};

/** An event's own colour from Google's colorId; null for none (it takes its calendar's) or one Google doesn't define. */
export function eventColourOf(colorId: string | null | undefined): Colour | null {
  const hex = colorId ? GOOGLE_EVENT_COLOURS[colorId] : undefined;
  return hex ? swatchFor(hex) : null;
}
