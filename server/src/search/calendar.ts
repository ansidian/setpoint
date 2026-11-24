// Calendar search: POST /api/calendar/search reads the items and calendars, and
// src/domain/calendarSearch.ts finds and orders the hits. Not logged, because the search log is
// mail's (no search log for the calendar). Alfred's search takes Todoist tasks with no date too
// (`undated`, not subtasks, which live in their task's checklist): they come back in `undated`,
// apart from the results, which all have a day.
import type {CalendarMatchReasonOut, CalendarSearchChip, CalendarSearchOut, calendarSearchInput, ItemOut} from '@setpoint/shared';
import type {z} from 'zod';
import * as t from '../db/schema.ts';
import {parseCalendarQuery, searchItems} from '../domain/calendarSearch.ts';
import {sameChip} from '../domain/searchChips.ts';
import {itemPresenter} from '../queries/items.ts';
import {isoNow} from '../store.ts';
import type {Store} from '../store.ts';

/** A task with no date that matched, as Alfred's search gives it. */
export interface UndatedHitOut {
  item: ItemOut;
  reasons: CalendarMatchReasonOut[];
}

export function searchCalendar(store: Store, input: z.output<typeof calendarSearchInput>): CalendarSearchOut;
export function searchCalendar(store: Store, input: z.output<typeof calendarSearchInput>, options: {undated: true}): CalendarSearchOut & {undated: UndatedHitOut[]};
export function searchCalendar(store: Store, input: z.output<typeof calendarSearchInput>, {undated = false}: {undated?: boolean} = {}): CalendarSearchOut & {undated?: UndatedHitOut[]} {
  const clock = {now: isoNow(store), timeZone: store.timeZone};
  // Calendars switched off in Settings › Calendar aren't searched or offered as a chip.
  const calendars = store.db.select().from(t.calendars).all().filter(calendar => calendar.listed);
  const parsed = parseCalendarQuery(input.text, calendars.map(calendar => calendar.name), clock);
  const chips: CalendarSearchChip[] = [];
  for (const chip of [...input.chips, ...parsed.chips]) if (!chips.some(existing => sameChip(existing, chip))) chips.push(chip);
  // Search leaves out hidden calendars, as the grid does.
  const shown = new Map(calendars.filter(calendar => calendar.visible).map(calendar => [calendar.id, calendar.name]));
  const rows = store.db.select().from(t.items).all().filter(row => row.kind !== 'task' || row.dueDate !== null || (undated && row.parentProviderId === null));
  const all = searchItems(rows, shown, chips, parsed.text, clock);
  const hits = all.filter(hit => !hit.undated);
  const present = itemPresenter(store);
  const page = hits.slice(input.offset, input.offset + input.limit);
  const next = input.offset + input.limit;
  return {
    ...(undated ? {undated: all.filter(hit => hit.undated).slice(0, input.limit).map(hit => ({item: present(hit.row), reasons: hit.reasons}))} : {}),
    chips, text: parsed.text, total: hits.length,
    results: page.map(hit => ({
      item: present(hit.row, hit.occurrence ?? undefined), date: hit.day, upcoming: hit.upcoming, rule: hit.rule,
      reasons: hit.reasons, highlights: hit.highlights,
    })),
    next_offset: next < hits.length ? next : null,
  };
}
