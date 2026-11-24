// Proposals from an email or the user's words. Add to calendar, Add as task and Alfred's propose
// tool all build one here. A proposal is the item POST /api/items would create, pre-filled. It marks the fields the
// email gave and, for an event, carries the conflict line against that day's items. Nothing is
// created: Create sends the item through the calendar's create command.
//
// The calendar is where similar items already live. That's the Google calendar whose items share
// the most words with the title ("CS 101 final exam" goes where "CS 101 lecture" is: Classes). Else
// it's the first calendar on the email's account, else the first Google calendar. A task goes to
// Todoist, in the project whose tasks share the most words with it, else Settings' default project.
//
// An email with an invite (a text/calendar attachment, as a scheduler sends) takes its title, time,
// end and place from the invite rather than its subject and text, because the file states them
// exactly. The account's adapter reads the invite, so it's the one step here that can wait on a
// provider. Whatever goes wrong there leaves the text's proposal.
//
// Alfred also proposes a change to an existing item: the fields he'd change, as PATCH /api/items/:id
// takes them, beside the item as it is and as the change leaves it. Nothing changes until Save.
//
// Beyond the title, day, times and place, Alfred may set what Calendar's editor sets (`Extras`): a
// description, reminders, the calendar, an event's colour, Time to Leave, a repeat as the editor's
// picker writes it, and an event's last day for one over several days. On a change, a description
// is added after the item's own (which Alfred hasn't read), and reminders replace its own.
import {formatOf, writeDescription} from '@setpoint/shared/richText';
import type {Block} from '@setpoint/shared/richText';
import {itemUpdateInput} from '@setpoint/shared';
import type {AlfredField, EventColour, ItemChanges, ItemKind, ItemOut, ProposalField, ProposalItemOut, ProposalOut, RecurringScope} from '@setpoint/shared';
import {asc, eq} from 'drizzle-orm';
import {readIcs} from '../domain/icsImport.ts';
import {bodyOf} from '../db/bodies.ts';
import * as t from '../db/schema.ts';
import {conflictLine, dayAfter, fromEmail, proposalFields} from '../domain/proposal.ts';
import type {ProposalFields} from '../domain/proposal.ts';
import {FILLER_WORDS} from '../domain/searchMatch.ts';
import {wordsOf} from '../domain/searchChips.ts';
import {addDays, daysBetween, localDay, localTime, weekday, zonedInstant} from '../domain/time.ts';
import {invalid, notFound} from '../errors.ts';
import {itemsInRange} from '../queries/items.ts';
import {gmailUrl} from '../queries/mail.ts';
import {attachmentFile} from '../queries/mailBody.ts';
import {getSettings} from '../settings.ts';
import type {Store} from '../store.ts';
import type {SyncEngine} from '../sync/engine.ts';

const HOUR = 60 * 60_000;

/** The repeats Alfred offers: the editor's picker's own, which it writes for the item's day. */
export const REPEATS = ['none', 'daily', 'weekly', 'weekdays', 'monthly', 'yearly'] as const;
export type Repeat = (typeof REPEATS)[number];
const RRULE_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const TODOIST_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** An event's rule for a repeat on its day, as the editor's repeat picker writes it. */
export function eventRule(repeat: Repeat, date: string): string | null {
  switch (repeat) {
    case 'none': return null;
    case 'daily': return 'RRULE:FREQ=DAILY';
    case 'weekly': return `RRULE:FREQ=WEEKLY;BYDAY=${RRULE_DAYS[weekday(date)]}`;
    case 'weekdays': return 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    case 'monthly': return 'RRULE:FREQ=MONTHLY';
    case 'yearly': return 'RRULE:FREQ=YEARLY';
  }
}

/** A task's Todoist repeat on its day, as the editor's repeat picker words it. */
export function taskRepeatOf(repeat: Repeat, date: string): string | null {
  switch (repeat) {
    case 'none': return null;
    case 'daily': return 'every day';
    case 'weekly': return `every ${TODOIST_DAYS[weekday(date)]}`;
    case 'weekdays': return 'every weekday';
    case 'monthly': return 'every month';
    case 'yearly': return 'every year';
  }
}

/** Plain text as a description in the item's provider's format: each line a paragraph. */
export function descriptionOf(kind: ItemKind, text: string): string | null {
  const blocks: Block[] = text.trim().split('\n').map(line => ({type: 'paragraph', runs: line.trim() ? [{text: line.trim(), marks: [], href: null}] : []}));
  return writeDescription(formatOf(kind), blocks);
}

/**
 * What Alfred sets on an item beyond its title, day, times and place. The calendar and colour are
 * already matched from their names. `end_date` is an event's last day, inclusive.
 */
export interface Extras {
  description?: string;
  reminders?: number[];
  leave_reminder?: boolean;
  calendar_id?: number;
  colour?: EventColour | null;
  repeat?: Repeat;
  end_date?: string;
}
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

/** The Google calendar for a new event: where similar items live, else the account's first, else the first (News's keynotes have no account). */
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

/** What an email's invite says: its event's title ('' when it has none), when and where. */
export interface Invite {
  title: string;
  all_day: boolean;
  starts_at: string | null;
  ends_at: string | null;
  start_date: string | null;
  end_date: string | null;
  place: string | null;
}

const MARK_ORDER: ProposalField[] = ['title', 'date', 'time', 'place'];
/** Invites looked at per email: a scheduler sends one. */
const MAX_INVITE_FILES = 3;

/**
 * The email's invite: its first calendar attachment that holds exactly one event. Null when it has
 * none, when the file holds several events or none (which one is meant isn't the proposal's to
 * guess), and when the provider can't give the file now.
 */
export async function inviteOf(store: Store, engine: SyncEngine | null, messageId: number): Promise<Invite | null> {
  const files = store.db.select({id: t.attachments.id, filename: t.attachments.filename, mimeType: t.attachments.mimeType})
    .from(t.attachments).where(eq(t.attachments.messageId, messageId)).orderBy(asc(t.attachments.id)).all()
    .filter(file => file.mimeType.startsWith('text/calendar') || /\.ics$/i.test(file.filename));
  for (const file of files.slice(0, MAX_INVITE_FILES)) {
    try {
      const read = readIcs(new Uint8Array((await attachmentFile(store, engine, messageId, file.id)).content), {timeZone: store.timeZone});
      const event = read.ok && read.drafts.length === 1 ? read.drafts[0]! : null;
      if (!event || !(event.all_day ? event.start_date : event.starts_at)) continue;
      return {title: event.title, all_day: event.all_day, starts_at: event.starts_at, ends_at: event.ends_at, start_date: event.start_date, end_date: event.end_date, place: event.location};
    } catch {
      // The provider is unreachable or no longer has the email: the text still gives a proposal.
    }
  }
  return null;
}

/** Changes Alfred's propose tool may make to what the email gives. */
export type ProposalOverrides = Partial<ProposalFields> & {all_day?: boolean};

/**
 * A proposal for an email: Add to calendar (event) or Add as task. Each field is Alfred's when he
 * gives one, else the invite's, else the text's.
 */
export function proposeFromMessage(store: Store, messageId: number, kind: ItemKind, overrides: ProposalOverrides = {}, invite: Invite | null = null, extras: Extras = {}): ProposalOut {
  const message = store.db.select().from(t.messages).where(eq(t.messages.id, messageId)).get();
  if (!message || message.trashedAt) throw notFound('No such email.');
  const email = {subject: message.subject, organisation: message.organisation, bodyText: bodyOf(store.db, message.id).bodyText, keyDate: message.keyDate};
  const fields: ProposalFields = {...proposalFields(email, store.timeZone)};
  const zone = store.timeZone;
  // The invite's when stands unless Alfred says a day or a time of his own.
  const when = invite && overrides.date === undefined && overrides.start === undefined && !overrides.all_day ? invite : null;
  const invited: ProposalField[] = [];
  if (when) {
    fields.date = when.all_day ? when.start_date : localDay(when.starts_at!, zone);
    fields.start = when.all_day ? null : localTime(when.starts_at!, zone);
    fields.end = when.all_day || !when.ends_at ? null : localTime(when.ends_at, zone);
    invited.push('date', ...(when.all_day ? [] : ['time' as const]));
  }
  // The invite names the event ("In-person interview with Contoso"), the subject the email ("You scheduled an interview").
  if (invite?.title && !overrides.title) {
    fields.title = invite.title;
    invited.push('title');
  }
  if (invite?.place && overrides.place === undefined) {
    fields.place = invite.place;
    invited.push('place');
  }
  if (overrides.title) fields.title = overrides.title;
  for (const key of ['date', 'start', 'end', 'place'] as const) if (overrides[key] !== undefined) fields[key] = overrides[key] ?? null;
  if (overrides.all_day) {
    fields.start = null;
    fields.end = null;
  }
  if (!fields.title.trim()) throw invalid('A proposal needs a title.');
  // What the invite gave is the email's too.
  const marks = new Set([...fromEmail(email, fields, zone), ...invited]);
  const from_email = MARK_ORDER.filter(mark => marks.has(mark));
  // The description's "From:" line, linking to the email in Gmail (plain text for another provider's).
  const account = store.db.select({provider: t.accounts.provider, address: t.accounts.address}).from(t.accounts).where(eq(t.accounts.id, message.accountId)).get();
  const source = {subject: message.subject, url: account?.provider === 'gmail' ? gmailUrl(account.address, message.providerId) : null};
  return {...proposalOf(store, kind, fields, message.accountId, when, extras), message_id: messageId, from_email, source};
}

/**
 * A proposal from the user's own words, Alfred's propose tool with no email: his title, day, times
 * and place, none marked, the calendar or project picked from the title as an email's is.
 */
export function proposeFromWords(store: Store, kind: ItemKind, fields: ProposalFields, extras: Extras = {}): ProposalOut {
  if (!fields.title.trim()) throw invalid('A proposal needs a title.');
  return {...proposalOf(store, kind, fields, null, null, extras), message_id: null, from_email: []};
}

/** What Alfred set beyond the title, day, times and place, in the chip's order. */
function alfredFields(extras: Extras): AlfredField[] {
  const set: AlfredField[] = [];
  if (extras.repeat && extras.repeat !== 'none') set.push('repeat');
  if (extras.end_date) set.push('days');
  if (extras.reminders) set.push('reminders');
  if (extras.leave_reminder) set.push('leave_reminder');
  if (extras.calendar_id !== undefined) set.push('calendar');
  if (extras.colour) set.push('colour');
  if (extras.description?.trim()) set.push('description');
  return set;
}

/** The item a proposal's fields make, in its calendar or project, with an event's conflict line. */
function proposalOf(store: Store, kind: ItemKind, fields: ProposalFields, accountId: number | null, when: Invite | null, extras: Extras): Pick<ProposalOut, 'kind' | 'item' | 'conflict' | 'alfred'> {
  const zone = store.timeZone;
  // An event over several days ends on its last day.
  const lastDay = kind === 'event' && extras.end_date && fields.date && extras.end_date > fields.date ? extras.end_date : null;
  // The invite's instants as they are (an event may end days later). The text's wall clock in the user's zone.
  const startsAt = when ? when.starts_at : fields.date && fields.start ? zonedInstant(fields.date, fields.start, zone) : null;
  let endsAt = when?.ends_at ?? (startsAt && fields.end ? zonedInstant(lastDay ?? fields.date!, fields.end, zone) : startsAt ? new Date(Date.parse(startsAt) + HOUR).toISOString() : null);
  // "11 PM – 1 AM" ends the next day.
  if (startsAt && endsAt && endsAt <= startsAt) endsAt = new Date(Date.parse(endsAt) + 24 * HOUR).toISOString();

  // Only what Alfred set rides along, so a proposal without it is as before (Settings' reminders).
  const description = extras.description?.trim() ? descriptionOf(kind, extras.description) : null;
  const named = alfredFields(extras);
  const alfred = named.length ? {alfred: named} : {};
  const set = {
    ...(description ? {description} : {}),
    ...(extras.reminders ? {reminders: extras.reminders} : {}),
  };
  if (kind === 'task') {
    const {calendarId, project} = projectFor(store, fields.title);
    const repeat = extras.repeat && fields.date ? taskRepeatOf(extras.repeat, fields.date) : null;
    return {
      kind, conflict: null, ...alfred,
      item: {
        kind, calendar_id: calendarId, title: fields.title, all_day: false, starts_at: null, ends_at: null, start_date: null, end_date: null,
        due_date: fields.date, due_at: startsAt, time_zone: zone, place: fields.place, project, ...set, ...(repeat ? {repeat} : {}),
      },
    };
  }
  const allDay = Boolean(fields.date && !startsAt);
  const recurrence = extras.repeat && fields.date ? eventRule(extras.repeat, fields.date) : null;
  const item: ProposalItemOut = {
    kind, calendar_id: extras.calendar_id ?? calendarFor(store, fields.title, accountId), title: fields.title, all_day: allDay,
    starts_at: startsAt, ends_at: endsAt, start_date: allDay ? fields.date : null, end_date: allDay ? (lastDay ? addDays(lastDay, 1) : when?.end_date ?? dayAfter(fields.date!)) : null,
    due_date: null, due_at: null, time_zone: zone, place: fields.place, project: null,
    ...set, ...(extras.leave_reminder ? {leave_reminder: true} : {}), ...(extras.colour ? {colour: extras.colour} : {}), ...(recurrence ? {recurrence} : {}),
  };
  const conflict = fields.date
    ? conflictLine({all_day: allDay, starts_at: startsAt, ends_at: endsAt, startHour: fields.start ? Number(fields.start.slice(0, 2)) : null}, itemsInRange(store, fields.date, dayAfter(fields.date)).items)
    : null;
  return {kind, item, conflict, ...alfred};
}

/** What Alfred would change on an item: a new title, day, times or place, and any extras. Times are local "HH:MM". */
export interface ChangeEdits extends Omit<Extras, 'end_date'> {
  title?: string;
  date?: string;
  start?: string;
  end?: string;
  all_day?: boolean;
  place?: string | null;
}

/**
 * A change to an item (a recurring event's occurrence when `item` is one): only the fields that
 * differ from it. A new day keeps the times, a new start keeps the length, and a task keeps its time
 * on a new day. Null when nothing would change.
 */
export function proposeChange(store: Store, item: ItemOut, edits: ChangeEdits, scope: RecurringScope): ProposalOut | null {
  const zone = store.timeZone;
  const changes: ItemChanges = {};
  if (edits.title !== undefined && edits.title.trim() && edits.title.trim() !== item.title) changes.title = edits.title.trim();
  // A new place drops the old one's address.
  if (edits.place !== undefined && (edits.place || null) !== item.place) Object.assign(changes, {place: edits.place || null}, item.address ? {address: null} : {});
  const when = edits.date !== undefined || edits.start !== undefined || edits.end !== undefined || edits.all_day !== undefined;
  if (when && item.kind === 'task') {
    const date = edits.date ?? item.due_date;
    if (!date) throw invalid('A task with no date needs a date for its time.');
    const time = edits.start ?? (item.due_at ? localTime(item.due_at, zone) : null);
    const dueAt = edits.all_day ? null : time ? zonedInstant(date, time, zone) : null;
    if (date !== item.due_date) changes.due_date = date;
    if (dueAt !== item.due_at) Object.assign(changes, {due_date: date, due_at: dueAt});
  } else if (when) {
    const wasTimed = !item.all_day && item.starts_at !== null && item.ends_at !== null;
    const day = edits.date ?? (wasTimed ? localDay(item.starts_at!, zone) : item.start_date!);
    if (edits.all_day || (!wasTimed && edits.start === undefined)) {
      const span = !wasTimed && item.start_date && item.end_date && !edits.all_day ? Math.max(1, daysBetween(item.start_date, item.end_date)) : 1;
      const next = {all_day: true, starts_at: null, ends_at: null, start_date: day, end_date: addDays(day, span)};
      if (wasTimed || next.start_date !== item.start_date || next.end_date !== item.end_date) Object.assign(changes, next);
    } else {
      const length = wasTimed ? Math.round((Date.parse(item.ends_at!) - Date.parse(item.starts_at!)) / 60_000) : 60;
      const start = edits.start ?? localTime(item.starts_at!, zone);
      const startsAt = zonedInstant(day, start, zone);
      let endsAt = edits.end ? zonedInstant(day, edits.end, zone) : new Date(Date.parse(startsAt) + length * 60_000).toISOString();
      if (endsAt <= startsAt) endsAt = edits.end ? new Date(Date.parse(endsAt) + 24 * HOUR).toISOString() : endsAt;
      if (!wasTimed || startsAt !== item.starts_at || endsAt !== item.ends_at) Object.assign(changes, {all_day: false, start_date: null, end_date: null, starts_at: startsAt, ends_at: endsAt});
    }
  }
  extraChanges(changes, item, edits, scope, zone);
  if (!Object.keys(changes).length) return null;
  // What Save sends is what PATCH /api/items/:id takes, or no proposal.
  const checked = itemUpdateInput.safeParse({changes, scope, occurrence_start: item.occurrence_start});
  if (!checked.success) throw invalid(checked.error.issues[0]?.message ?? 'That change isn\'t one Setpoint can make.');
  const after = {...item, ...changes};
  const proposed: ProposalItemOut = {
    kind: item.kind, calendar_id: after.calendar_id, title: after.title, all_day: after.all_day, starts_at: after.starts_at, ends_at: after.ends_at,
    start_date: after.start_date, end_date: after.end_date, due_date: after.due_date, due_at: after.due_at, time_zone: item.time_zone ?? zone, place: after.place, project: item.project,
    description: after.description, reminders: after.reminders, leave_reminder: after.leave_reminder, colour: after.colour as EventColour | null, recurrence: after.recurrence, repeat: after.repeat,
  };
  // The conflict line on the day it lands, leaving the item itself out.
  const day = item.kind === 'event' ? (after.all_day ? after.start_date : after.starts_at ? localDay(after.starts_at, zone) : null) : null;
  const conflict = day
    ? conflictLine({all_day: after.all_day, starts_at: after.starts_at, ends_at: after.ends_at, startHour: after.starts_at ? Number(localTime(after.starts_at, zone).slice(0, 2)) : null},
      itemsInRange(store, day, dayAfter(day)).items.filter(other => other.id !== item.id))
    : null;
  return {kind: item.kind, message_id: null, item: proposed, from_email: [], conflict, change: {item, changes, scope: item.recurring && item.kind === 'event' ? scope : 'this'}};
}

const sameList = (a: number[], b: number[]) => a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * The extras' changes to an item: only what differs. A description is added after the item's own.
 * A recurring event's repeat or calendar changes as a series (Google can't change one occurrence's),
 * so those need scope following or all.
 */
function extraChanges(changes: ItemChanges, item: ItemOut, edits: ChangeEdits, scope: RecurringScope, zone: string) {
  const event = item.kind === 'event';
  const series = event && item.recurring;
  if (edits.description?.trim()) {
    const added = descriptionOf(item.kind, edits.description)!;
    changes.description = item.description ? `${item.description}${event ? '<br><br>' : '\n\n'}${added}` : added;
  }
  if (edits.reminders && !sameList([...edits.reminders].sort((a, b) => a - b), [...item.reminders].sort((a, b) => a - b))) changes.reminders = edits.reminders;
  if (edits.leave_reminder !== undefined && event && edits.leave_reminder !== item.leave_reminder) changes.leave_reminder = edits.leave_reminder;
  if (edits.colour !== undefined && event && edits.colour !== item.colour) changes.colour = edits.colour;
  if (edits.calendar_id !== undefined && event && edits.calendar_id !== item.calendar_id) {
    if (series && scope === 'this') throw invalid('A recurring event moves to another calendar as a series: give scope following or all.');
    changes.calendar_id = edits.calendar_id;
  }
  if (edits.repeat !== undefined) {
    const day = changes.due_date ?? changes.start_date ?? (changes.starts_at ? localDay(changes.starts_at, zone) : null)
      ?? item.due_date ?? item.start_date ?? (item.starts_at ? localDay(item.starts_at, zone) : null);
    if (!day) throw invalid('A repeat starts on a day: give the date too.');
    if (event) {
      const rule = eventRule(edits.repeat, day);
      if (rule !== item.recurrence) {
        if (series && scope === 'this') throw invalid('A recurring event\'s repeat changes for the series: give scope following or all.');
        changes.recurrence = rule;
      }
    } else {
      const repeat = taskRepeatOf(edits.repeat, day);
      if (repeat !== item.repeat) changes.repeat = repeat;
    }
  }
}
