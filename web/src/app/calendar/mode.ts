// Calendar's last view, Month or Week, kept by this browser (localStorage, as the theme is) so the
// sidebar's Calendar, `2`, ⌘K and links from outside open in it (DESIGN.md › Week view). While on
// Calendar the address carries the view; this only fills it in for an address that names none.
import type {CalendarMode} from '../../logic/route.ts';

const KEY = 'setpoint.calendarView';

let mode: CalendarMode = (() => {
  try {
    return localStorage.getItem(KEY) === 'week' ? 'week' : 'month';
  } catch {
    return 'month';
  }
})();

export const rememberedMode = () => mode;

export function rememberMode(next: CalendarMode) {
  if (next === mode) return;
  mode = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Private windows may refuse; the view still holds for this page.
  }
}
