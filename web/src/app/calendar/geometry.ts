// Where the calendar's overlays (the "+N" popover, the floating detail) measure things: in the month
// section's own CSS pixels, the space their left, top and translate are set in. On a wide screen
// styles.css zooms the root (1.25 from 2200 px), and the page's boxes and pointer positions come in
// zoomed pixels, so each is taken relative to the section and divided by its zoom.
import type {Rect} from '../../logic/calendar.ts';

// The calendar's grids, month and week, mark their parts the same way, so the overlays anchored to
// items (the floating detail, the "+N" popover, the drop prompt, the failed card) work on either: the
// section they're drawn in, the scroller they move with, the grid of days, and each day and item.
export const CAL = {section: '[data-cal-section]', scroll: '[data-cal-scroll]', grid: '[data-cal-grid]'} as const;
/** Every item, "+N" and all, an anchored overlay tries not to cover. */
export const CAL_ITEMS = `${CAL.grid} :is(.ev, .tk, .wb, .more)`;
/**
 * An item's element on a day of the grid; else, with `more`, that day's "+N" it's folded into; else
 * wherever it's drawn (a bar across days picked on another, a block across midnight).
 */
export function findItem(root: ParentNode, date: string, key: string, more = false): HTMLElement | null {
  const item = `[data-key="${CSS.escape(key)}"]`;
  return root.querySelector<HTMLElement>(`${CAL.grid} [data-date="${date}"] ${item}`)
    ?? (more ? root.querySelector<HTMLElement>(`${CAL.grid} [data-more="${date}"]`) : null)
    ?? root.querySelector<HTMLElement>(`${CAL.grid} ${item}`);
}
import type {Point} from '../../logic/placement.ts';

/** The zoom an element is drawn at: the browser's own figure, else its box on screen over its laid-out width. */
export function zoomOf(element: HTMLElement): number {
  const zoom = (element as HTMLElement & {currentCSSZoom?: number}).currentCSSZoom;
  if (zoom) return zoom;
  const width = element.offsetWidth;
  return width ? element.getBoundingClientRect().width / width : 1;
}

/** An element's box relative to the month section, in the section's CSS pixels. */
export function rectIn(element: Element, section: HTMLElement): Rect {
  const zoom = zoomOf(section);
  const box = element.getBoundingClientRect();
  const origin = section.getBoundingClientRect();
  return {left: (box.left - origin.left) / zoom, top: (box.top - origin.top) / zoom, width: box.width / zoom, height: box.height / zoom};
}

/** A pointer's position relative to the month section, in the section's CSS pixels. */
export function pointIn(clientX: number, clientY: number, section: HTMLElement): Point {
  const zoom = zoomOf(section);
  const origin = section.getBoundingClientRect();
  return {left: (clientX - origin.left) / zoom, top: (clientY - origin.top) / zoom};
}

/** An element's height in its own CSS pixels, unrounded (mid-animation too). */
export const heightOf = (element: HTMLElement) => element.getBoundingClientRect().height / zoomOf(element);
