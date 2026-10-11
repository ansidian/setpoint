// Upcoming's Add to calendar (N3; BRIEF.md › The page: "Add to calendar opens a proposal, as from an
// email"): the keynote as the event POST /api/items would create, pre-filled from the news, with its
// calendar chosen as an email's is and the conflict line against that day. Nothing is created: Create
// sends the item through B5's create command, as an email's proposal does.
import type {NewsProposalOut, ProposalField} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import {calendarFor} from '../alfred/proposals.ts';
import * as t from '../db/schema.ts';
import {conflictLine, dayAfter} from '../domain/proposal.ts';
import {localDay, localTime} from '../domain/time.ts';
import {notFound} from '../errors.ts';
import {itemsInRange} from '../queries/items.ts';
import type {Store} from '../store.ts';

const HOUR = 60 * 60_000;

export function proposeFromNewsEvent(store: Store, eventId: number): NewsProposalOut {
  const event = store.db.select().from(t.newsEvents).where(eq(t.newsEvents.id, eventId)).get();
  if (!event) throw notFound('No such keynote.');
  const zone = store.timeZone;
  const date = localDay(event.startsAt, zone);
  const startsAt = event.allDay ? null : event.startsAt;
  // A keynote's end isn't announced: an hour, Google Calendar's own default (as an email's proposal).
  const endsAt = startsAt ? new Date(Date.parse(startsAt) + HOUR).toISOString() : null;
  const fromNews: ProposalField[] = event.allDay ? ['title', 'date'] : ['title', 'date', 'time'];
  return {
    kind: 'event', news_event_id: event.id, story_id: event.storyId, from_email: fromNews,
    item: {
      kind: 'event', calendar_id: calendarFor(store, event.name, null), title: event.name, all_day: event.allDay,
      starts_at: startsAt, ends_at: endsAt, start_date: event.allDay ? date : null, end_date: event.allDay ? dayAfter(date) : null,
      due_date: null, due_at: null, time_zone: zone, place: null, project: null,
    },
    conflict: conflictLine({all_day: event.allDay, starts_at: startsAt, ends_at: endsAt, startHour: startsAt ? Number(localTime(startsAt, zone).slice(0, 2)) : null},
      itemsInRange(store, date, dayAfter(date)).items),
  };
}
