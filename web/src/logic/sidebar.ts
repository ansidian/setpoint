// Whether the sidebar is folded to its icon rail. Under 1100 px (the compact tier) it's always the
// rail. From there to 1599 it starts as the rail, and from 1600 it starts open. A choice made by hand
// (`` ` `` or the rail's edge) wins over that in both directions, one per screen.
import {viewport} from '../tokens.ts';

export type SidebarChoice = 'rail' | 'open';

/** A stored choice, or null for anything else (nothing kept, or an old value). */
export const sidebarChoice = (stored: string | null): SidebarChoice | null => (stored === 'rail' || stored === 'open' ? stored : null);

/** The kept choices, one per screen it was made on (reader.ts's screenKey). A lone choice is from
 * before screens were told apart, and is the screen in front's. */
export function sidebarChoices(stored: string | null, screen: string): Record<string, SidebarChoice> {
  const lone = sidebarChoice(stored);
  if (lone) return {[screen]: lone};
  let value: unknown;
  try {
    value = JSON.parse(stored ?? '');
  } catch {
    return {};
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, kept]) => {
    const choice = typeof kept === 'string' ? sidebarChoice(kept) : null;
    return choice ? [[key, choice]] : [];
  }));
}

/** Whether the sidebar can be opened and folded by hand: from the compact tier's top up. */
export const sidebarFoldable = (width: number) => width >= viewport.compactBelow;

/** Whether the sidebar is the rail at this window width (CSS px, as media queries read it) with this choice. */
export function sidebarFolded(width: number, choice: SidebarChoice | null): boolean {
  if (!sidebarFoldable(width)) return true;
  return choice ? choice === 'rail' : width < viewport.railBelow;
}
