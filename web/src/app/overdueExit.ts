// The overdue banner's way out, measured from layout at the click (OverdueBanner.tsx): where each
// returning title goes and how small it gets there, and where the overdue-task icon sits when
// Today's lines aren't on screen. Which titles return is logic/overdueBanner.ts's; this finds
// their lines. With the sidebar open on a mail page each goes to its own Today line, and one whose
// line isn't there fades instead. Folded to the rail, or on Calendar, whose sidebar has no Today
// block, they all go to the icon, 18 px under the sidebar's nav (under the rail's next-up slot when
// it shows). Measured by offsets inside the banner, so the press or a running animation doesn't
// skew it.
import {overdue as timing} from '../tokens.ts';
import {rectIn, zoomOf} from './calendar/geometry.ts';

/** Where one returning title goes, from its own centre, and the scale it shrinks to. */
export interface Flight {
  key: string;
  x: number;
  y: number;
  scale: number;
}

/** The icon's tile, in the banner's CSS pixels. */
export interface IconPlace {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ExitPlan {
  flights: Flight[];
  icon: IconPlace | null;
}

const TILE_HEIGHT = 32;
const TILE_WIDTH = 40;

/** An element's centre inside `root`, by layout: offsets up to it, ignoring transforms. */
function layoutCentre(element: HTMLElement, root: HTMLElement): {x: number; y: number} {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = element;
  while (node && node !== root) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return {x: x + element.offsetWidth / 2, y: y + element.offsetHeight / 2};
}

/** The centre of an element's text inside `root`, in its CSS pixels: a wrapped or clamped title's lines, not its box. */
function textCentre(element: Element, root: HTMLElement): {x: number; y: number} {
  const range = document.createRange();
  range.selectNodeContents(element);
  const text = range.getBoundingClientRect();
  const box = text.width ? text : element.getBoundingClientRect();
  const origin = root.getBoundingClientRect();
  const zoom = zoomOf(root);
  return {x: (box.left + box.width / 2 - origin.left) / zoom, y: (box.top + box.height / 2 - origin.top) / zoom};
}

const fontSize = (element: Element) => parseFloat(getComputedStyle(element).fontSize);

/** A Today line's title for a task, if it's on screen in the sidebar. */
function lineTitle(sidebar: Element, key: string): Element | null {
  const title = sidebar.querySelector(`.today-row[data-key="${CSS.escape(key)}"] .title`);
  if (!title) return null;
  const line = title.getBoundingClientRect();
  const shown = sidebar.getBoundingClientRect();
  return line.height > 0 && line.top >= shown.top && line.bottom <= shown.bottom ? title : null;
}

/** Where the icon sits: 18 px under the sidebar's last nav item, or under the rail's next-up slot. */
function iconPlace(sidebar: HTMLElement, root: HTMLElement, rail: boolean): IconPlace | null {
  const above = [...sidebar.querySelectorAll<HTMLElement>(':scope > .nav, :scope > .today.next-up')].at(-1);
  const nav = sidebar.querySelector<HTMLElement>(':scope > .nav');
  if (!above || !nav) return null;
  const under = rectIn(above, root);
  const column = rectIn(nav, root);
  const width = rail ? column.width : TILE_WIDTH;
  return {left: column.left, top: under.top + under.height + timing.iconGapPx, width, height: TILE_HEIGHT};
}

/**
 * The way out for the titles in `banner` keyed by `keys` (`data-key` on each), measured now. None
 * when nothing returns, so no icon is drawn.
 */
export function planExit(banner: HTMLElement, keys: readonly string[]): ExitPlan {
  const sidebar = document.querySelector<HTMLElement>('.sb');
  if (!keys.length || !sidebar) return {flights: [], icon: null};
  const titles = keys.flatMap(key => {
    const title = banner.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    return title ? [{key, title}] : [];
  });
  const rail = sidebar.classList.contains('rail');
  const toIcon = rail || !sidebar.querySelector('.today:not(.next-up)');
  if (toIcon) {
    const icon = iconPlace(sidebar, banner, rail);
    if (!icon || !titles.length) return {flights: [], icon: null};
    const to = {x: icon.left + icon.width / 2, y: icon.top + icon.height / 2};
    // A third of a sidebar line's size: the sidebar's own text size.
    const line = fontSize(sidebar);
    const flights = titles.map(({key, title}) => {
      const from = layoutCentre(title, banner);
      return {key, x: to.x - from.x, y: to.y - from.y, scale: timing.iconScale * line / fontSize(title)};
    });
    return {flights, icon};
  }
  const flights = titles.flatMap(({key, title}) => {
    const home = lineTitle(sidebar, key);
    if (!home) return [];
    const from = layoutCentre(title, banner);
    const to = textCentre(home, banner);
    return [{key, x: to.x - from.x, y: to.y - from.y, scale: fontSize(home) / fontSize(title)}];
  });
  return {flights, icon: null};
}
