// SV-274 (D564): the agenda rail's USPS mail. One row of thumbnails, all one size, as many as fit the
// rail's width and never wrapping: when there are more scans than fit, the last tile is "+3" for the
// rest, and opens the viewer at the first of them. The viewer steps through the day's scans and
// stops at the ends.

export const MAIL_TILE = 56;
export const MAIL_GAP = 6;

/** How many thumbnails a row `width` wide shows for `count` scans, and how many the "+N" tile holds. */
export function mailStrip(width: number, count: number, tile = MAIL_TILE, gap = MAIL_GAP): {shown: number; more: number} {
  const fits = Math.max(1, Math.floor((width + gap) / (tile + gap)));
  if (count <= fits) return {shown: count, more: 0};
  return {shown: fits - 1, more: count - (fits - 1)};
}

/** The viewer's next scan, `step` away, held at the first and last: no wrapping. */
export const stepScan = (at: number, step: number, count: number) => Math.min(Math.max(at + step, 0), Math.max(count - 1, 0));

/** The section's line under its title: "4 pieces", or "4 pieces · 1 without a picture". */
export function mailLine(pieces: number, scans: number): string {
  const total = `${pieces} ${pieces === 1 ? 'piece' : 'pieces'}`;
  const missing = pieces - scans;
  return missing > 0 ? `${total} · ${missing} without a picture` : total;
}
