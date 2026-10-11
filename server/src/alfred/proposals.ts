// Proposals from an email (BRIEF.md › The reader; DESIGN.md › Proposal): Add to calendar and Add as
// task, and Alfred's propose tool, all build one here. A proposal is the item POST /api/items would
// create, pre-filled, with the fields the email gave marked and, for an event, the conflict line
// against that day's items. Nothing is created: Create sends the item through B5's create command.
//
// The calendar is where similar items already live: the Google calendar whose items share the most
// words with the title ("CS 101 final exam" goes where "CS 101 lecture" is: Classes), else the
// first calendar on the email's account, else the first Google calendar. A task goes to Todoist, in
// the project whose tasks share the most words with it, else Settings' default project.
import type {ItemKind, ProposalOut} from '@setpoint/shared';
import {asc, eq} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {conflictLine, dayAfter, fromEmail, proposalFields} from '../domain/proposal.ts';
import type {ProposalFields} from '../domain/proposal.ts';
import {FILLER_WORDS} from '../domain/searchMatch.ts';
import {wordsOf} from '../domain/searchChips.ts';
import {zonedInstant} from '../domain/time.ts';
import {invalid, notFound} from '../errors.ts';
import {itemsInRange} from '../queries/items.ts';
import {getSettings} from '../settings.ts';
import type {Store} from '../store.ts';

const HOUR = 60 * 60_000;
const significant = (text: string) => new Set(wordsOf(text).filter(word => !FILLER_WORDS.has(word) && word.length > 1));

/** The key with the most shared words, or null when nothing shares any. */
function bestByWords<K>(title: string, candidates: {key: K; titles: string[]}[]): K | null {
  const wanted = significant(title);
  let best: {key: K; score: number} | null = null;
  for (const candidate of candidates) {
    const words = new Set(candidate.titles.flatMap(item => [...significant(item)]));
    const score = [...wanted].filter(word => words.has(word)).length;
    if (score > 0 && (!best || score > best.score)) best = {key: candidate.key, score};
  }
  return best?.key ?? null;
}

/** The Google calendar for a new event: where similar items live, else the account's first, else the first (N3: News's keynotes have no account). */
export function calendarFor(store: Store, title: string, accountId: number | null): number | null {
  const calendars = store.db.select().from(t.calendars).where(eq(t.calendars.provider, 'google')).orderBy(asc(t.calendars.position)).all();
  if (!calendars.length) return null;
  const items = store.db.select({calendarId: t.items.calendarId, title: t.items.title}).from(t.items).where(eq(t.items.kind, 'event')).all();
  const similar = bestByWords(title, calendars.map(calendar => ({key: calendar.id, titles: items.filter(item => item.calendarId === calendar.id).map(item => item.title)})));
  return similar ?? calendars.find(calendar => calendar.accountId === accountId)?.id ?? calendars[0]!.id;
}

function projectFor(store: Store, title: string): {calendarId: number | null; project: string | null} {
  const todoist = store.db.select().from(t.calendars).where(eq(t.calendars.provider, 'todoist')).get();
  const tasks = store.db.select({project: t.items.project, title: t.items.title}).from(t.items).where(eq(t.items.kind, 'task')).all().filter(task => task.project);
  const projects = [...new Set(tasks.map(task => task.project!))];
  const similar = bestByWords(title, projects.map(project => ({key: project, titles: tasks.filter(task => task.project === project).map(task => task.title)})));
  return {calendarId: todoist?.id ?? null, project: similar ?? getSettings(store).todoist.default_project};
}

/** Changes Alfred's propose tool may make to what the email gives. */
export type ProposalOverrides = Partial<ProposalFields> & {all_day?: boolean};

/** A proposal for an email: Add to calendar (event) or Add as task. */
export function proposeFromMessage(store: Store, messageId: number, kind: ItemKind, overrides: ProposalOverrides = {}): ProposalOut {
  const message = store.db.select().from(t.messages).where(eq(t.messages.id, messageId)).get();
  if (!message || message.trashedAt) throw notFound('No such email.');
  const email = {subject: message.subject, organisation: message.organisation, bodyText: message.bodyText, keyDate: message.keyDate};
  const fields: ProposalFields = {...proposalFields(email)};
  if (overrides.title) fields.title = overrides.title;
  for (const key of ['date', 'start', 'end', 'place'] as const) if (overrides[key] !== undefined) fields[key] = overrides[key] ?? null;
  if (overrides.all_day) {
    fields.start = null;
    fields.end = null;
  }
  if (!fields.title.trim()) throw invalid('A proposal needs a title.');
  const zone = store.timeZone;
  const startsAt = fields.date && fields.start ? zonedInstant(fields.date, fields.start, zone) : null;
  let endsAt = startsAt && fields.end ? zonedInstant(fields.date!, fields.end, zone) : startsAt ? new Date(Date.parse(startsAt) + HOUR).toISOString() : null;
  // "11 PM – 1 AM" ends the next day.
  if (startsAt && endsAt && endsAt <= startsAt) endsAt = new Date(Date.parse(endsAt) + 24 * HOUR).toISOString();

  if (kind === 'task') {
    const {calendarId, project} = projectFor(store, fields.title);
    return {
      kind, message_id: messageId, from_email: fromEmail(email, fields), conflict: null,
      item: {
        kind, calendar_id: calendarId, title: fields.title, all_day: false, starts_at: null, ends_at: null, start_date: null, end_date: null,
        due_date: fields.date, due_at: startsAt, time_zone: zone, place: fields.place, project,
      },
    };
  }
  const allDay = Boolean(fields.date && !startsAt);
  const item = {
    kind, calendar_id: calendarFor(store, fields.title, message.accountId), title: fields.title, all_day: allDay,
    starts_at: startsAt, ends_at: endsAt, start_date: allDay ? fields.date : null, end_date: allDay ? dayAfter(fields.date!) : null,
    due_date: null, due_at: null, time_zone: zone, place: fields.place, project: null,
  };
  const conflict = fields.date
    ? conflictLine({all_day: allDay, starts_at: startsAt, ends_at: endsAt, startHour: fields.start ? Number(fields.start.slice(0, 2)) : null}, itemsInRange(store, fields.date, dayAfter(fields.date)).items)
    : null;
  return {kind, message_id: messageId, item, from_email: fromEmail(email, fields), conflict};
}
