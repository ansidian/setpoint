// Whether the sidebar is folded to its icon rail (DESIGN.md › Layout › Shell; D507, SV-245). Under
// 1100 px (the compact tier) it's always the rail; from there to 1599 it starts as the rail and from
// 1600 open, and a choice made by hand (`` ` `` or the rail's edge) wins over that in both directions.
import {viewport} from '../tokens.ts';

export type SidebarChoice = 'rail' | 'open';

/** A stored choice, or null for anything else (nothing kept, or an old value). */
export const sidebarChoice = (stored: string | null): SidebarChoice | null => (stored === 'rail' || stored === 'open' ? stored : null);

/** Whether the sidebar can be opened and folded by hand: from the compact tier's top up. */
export const sidebarFoldable = (width: number) => width >= viewport.compactBelow;

/** Whether the sidebar is the rail at this window width (CSS px, as media queries read it) with this choice. */
export function sidebarFolded(width: number, choice: SidebarChoice | null): boolean {
  if (!sidebarFoldable(width)) return true;
  return choice ? choice === 'rail' : width < viewport.railBelow;
}
