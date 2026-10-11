// SV-23: calendar search (DESIGN.md › Decided while building #24): POST /api/calendar/search reads the
// items and calendars, and src/domain/calendarSearch.ts finds and orders the hits. Not logged: the
// search log is mail's (no search log for the calendar, D48).
import type {CalendarSearchChip, CalendarSearchOut, calendarSearchInput} from '@setpoint/shared';
import type {z} from 'zod';
import * as t from '../db/schema.ts';
import {parseCalendarQuery, searchItems} from '../domain/calendarSearch.ts';
import {sameChip} from '../domain/searchChips.ts';
import {itemPresenter} from '../queries/items.ts';
import {isoNow} from '../store.ts';
import type {Store} from '../store.ts';

export function searchCalendar(store: Store, input: z.output<typeof calendarSearchInput>): CalendarSearchOut {
  const clock = {now: isoNow(store), timeZone: store.timeZone};
  const calendars = store.db.select().from(t.calendars).all();
  const parsed = parseCalendarQuery(input.text, calendars.map(calendar => calendar.name), clock);
  const chips: CalendarSearchChip[] = [];
  for (const chip of [...input.chips, ...parsed.chips]) if (!chips.some(existing => sameChip(existing, chip))) chips.push(chip);
  // Hidden calendars are left out, as the grid leaves them out.
  const shown = new Map(calendars.filter(calendar => calendar.visible).map(calendar => [calendar.id, calendar.name]));
  const hits = searchItems(store.db.select().from(t.items).all(), shown, chips, parsed.text, clock);
  const present = itemPresenter(store);
  const page = hits.slice(input.offset, input.offset + input.limit);
  const next = input.offset + input.limit;
  return {
    chips, text: parsed.text, total: hits.length,
    results: page.map(hit => ({
      item: present(hit.row, hit.occurrence ?? undefined), date: hit.day, upcoming: hit.upcoming, rule: hit.rule,
      reasons: hit.reasons, highlights: hit.highlights,
    })),
    next_offset: next < hits.length ? next : null,
  };
}
