// The calendar editor's drafts as pure rules (Editor.tsx draws them): a draft from a day, an item, an
// email's proposal or an .ics event, the line read and retyped, and what Create or Save sends.
import type {CalendarOut, IcsEventOut, ItemChanges, ItemCreateInput, ItemKind, ItemOut, ProposalField, ProposalOut} from '@setpoint/shared';
import type {Slot} from '../app/calendar/Editor.tsx';
import {editedWhen, extraDays, parseTitle, taskRepeat} from './compose.ts';
import type {ParsedTitle, ReminderBase, ReminderRead} from './compose.ts';
import {formatOf, readDescription, sameDescription, sourceLine, writeDescription} from './description.ts';
import type {Block} from './description.ts';
import {addDays, daysBetween, instantAt, localDate, minutesOf} from './format.ts';
import {keptPicks} from './linePhrase.ts';
import {dayOf} from './manipulate.ts';
import {placeName} from './place.ts';
import {masked, retyped, unmasked, wordSpans} from './plain.ts';
import type {Span} from './plain.ts';
import {lineOffsets, withLine} from './reminders.ts';

export type Manual = 'date' | 'time' | 'place' | 'calendar' | 'recurrence' | 'labels' | 'project' | 'reminders';

export interface Draft {
  id: number;
  kind: ItemKind;
  // The line as typed (an edited item's title as it's edited).
  text: string;
  // The line's title words: what it reads once its phrases are taken out.
  title: string;
  // Phrases clicked back to title words, which the line no longer reads until they're typed into.
  plain: Span[];
  date: string;
  // A new task's date taken off with its ×. `date` stays, for a day picked again.
  undated: boolean;
  // The day it was put on (opened on, or a grid day clicked): its date when the line names none.
  day: string;
  // Minutes after the date's midnight. Null is all day (an event) or no time (a task). A timed
  // event's end may be days on.
  start: number | null;
  end: number | null;
  // An all-day event's days, its date the first, or 1 otherwise.
  days: number;
  // The time it was put at on the week view (a range dragged, a slot clicked): its time when the
  // line names none, as `day` is its date.
  slot: Slot | null;
  place: string;
  // Set when a suggestion was picked (or the item had one).
  address: string | null;
  // The line's place text a suggestion was picked for ("mcd"): the place stops there.
  picked: string | null;
  // Null: the first calendar shown (events).
  calendarId: number | null;
  // Null: Settings › Notifications' default, which the server applies too. Picked in
  // the editor (or an edited item's own). The line's sit beside them.
  reminders: number[] | null;
  // The line's reminder phrases: they replace the default and sit beside what's
  // picked, as offsets from the item's moment as it stands (`remindersOf`).
  lineReminders: ReminderRead[];
  // Time to Leave, added from the reminder menu, never by default.
  leaveReminder: boolean;
  recurrence: string | null;
  project: string | null;
  // Set when New project was picked for it: Todoist makes it with the task.
  newProject: boolean;
  // The line's #project text a menu pick was made for: the project stops there.
  pickedProject: string | null;
  // The same for an event's #calendar.
  pickedCalendar: string | null;
  // A task's Todoist labels and repeat (Todoist's words).
  labels: string[];
  repeat: string | null;
  // Fields an email gave (More options on its proposal card), marked until they're changed. The
  // description's From: line is among them, a mark the server's list doesn't carry.
  fromEmail: Marked[];
  // Fields set in their rows: the line's parse leaves them until a phrase for one is typed.
  manual: Manual[];
  // The description as the field reads it (logic/description.ts), written in its provider's
  // format on save. `descriptionLossy` when the item's own held formatting that reading drops.
  description: Block[];
  descriptionLossy: boolean;
  // What it opened with (an email's or a keynote's proposal), which the line falls back to where it
  // names none: a phrase typed changes the field, and taken out puts it back.
  base: Base;
}

interface Base {
  calendarId: number | null;
  place: string;
  project: string | null;
}

const NO_BASE: Base = {calendarId: null, place: '', project: null};

export const DEFAULT_START = 9 * 60;
export const DEFAULT_LENGTH = 60;

let nextDraft = 1;

/** A proposal as the editor opens on it. */
/** A field that can carry the "from the email" mark. */
export type Marked = ProposalField | 'description';

interface Handed {
  proposal: ProposalOut;
  // Null: Settings' default.
  reminders: number[] | null;
  newProject: boolean;
}

export function emptyDraft(kind: ItemKind, date: string, slot: Slot | null = null): Draft {
  const at = kind === 'event' ? slot : null;
  return {
    id: nextDraft++, kind, text: '', title: '', plain: [], date, undated: false, day: date, slot: at,
    start: at ? at.start : kind === 'event' ? DEFAULT_START : null, end: at ? at.end : kind === 'event' ? DEFAULT_START + DEFAULT_LENGTH : null, days: at?.days ?? 1,
    place: '', address: null, picked: null, calendarId: null, reminders: null, lineReminders: [], leaveReminder: false, recurrence: null, project: null, newProject: false, pickedProject: null, pickedCalendar: null, labels: [], repeat: null, description: [], descriptionLossy: false, fromEmail: [], manual: [], base: NO_BASE,
  };
}

/**
 * The instant a draft's reminders count from: its start or due time, an all-day event's
 * midnight, or a dated task's Settings' task time (`taskTime`, minutes). A task with no date has none.
 */
export const anchorOf = (draft: Draft, taskTime: number, timeZone: string) => (draft.kind === 'task' && draft.undated ? null
  : Date.parse(instantAt(draft.date, draft.start ?? (draft.kind === 'task' ? taskTime : 0), timeZone)));

/** A draft's reminders with its line's: null while Settings' default. */
export const remindersOf = (draft: Draft, taskTime: number, timeZone: string) =>
  withLine(draft.reminders, lineOffsets(draft.lineReminders, anchorOf(draft, taskTime, timeZone), timeZone));

/**
 * What the line's reminder phrases count from when it names no day or time: the item's day
 * and its start, the slot's or 9:00 AM for a new event, an all-day one's midnight, a task's Settings'
 * task time, or an edited item's own. A task with no date has none, so its phrases stay words.
 */
function reminderBase(draft: Draft, original: Draft | null, taskTime: number): ReminderBase | null {
  if (draft.kind === 'task' && draft.undated) return null;
  const day = draft.manual.includes('date') ? draft.date : original ? original.date : draft.day;
  const start = draft.manual.includes('time') ? draft.start : original ? original.start
    : draft.kind === 'event' ? (draft.slot ? draft.slot.start : DEFAULT_START) : null;
  return {day, time: start ?? (draft.kind === 'task' ? taskTime : 0), kept: (draft.reminders ?? []).length};
}

/** A draft with its defaults filled in: the first calendar shown, Settings' reminder, unless the line sets some. */
export const withDefaults = (draft: Draft, calendar: number | null, reminders: number[], taskTime: number, timeZone: string): Draft & {reminders: number[]} => ({
  ...draft, calendarId: draft.calendarId ?? (draft.kind === 'event' ? calendar : null),
  reminders: remindersOf(draft, taskTime, timeZone) ?? (draft.kind === 'event' ? reminders : []),
});

/**
 * An .ics file's one event as a new draft: its title as words only, none of them read,
 * its day and time in the user's zone, place, repeat, and its own reminders, never Settings'
 * default, and the calendar already holding it, if one does. The fields are set, so the line's parse
 * leaves them be.
 */
export function fromIcs(event: IcsEventOut, timeZone: string): Draft {
  const date = event.all_day ? event.start_date! : localDate(event.starts_at!, timeZone);
  const start = event.all_day ? null : minutesOf(event.starts_at!, timeZone);
  const end = start === null ? null : start + Math.round((Date.parse(event.ends_at ?? event.starts_at!) - Date.parse(event.starts_at!)) / 60_000);
  return {
    ...emptyDraft('event', date), text: event.title, title: event.title, plain: wordSpans(event.title), start, end,
    days: event.all_day ? Math.max(1, daysBetween(event.start_date!, event.end_date!)) : 1,
    place: event.place ?? '', address: event.address, calendarId: event.existing[0] ?? null, reminders: event.reminders,
    recurrence: event.recurrence.find(line => line.startsWith('RRULE:')) ?? null,
    manual: ['date', 'time', 'place', 'reminders', 'recurrence', ...(event.existing.length ? ['calendar' as const] : [])],
  };
}

/** An item as the editor's fields. */
export function fromItem(item: ItemOut, timeZone: string): Draft {
  const date = dayOf(item, timeZone) ?? localDate(Date.now(), timeZone);
  const timed = item.kind === 'event' ? !item.all_day && item.starts_at && item.ends_at : !!item.due_at;
  const start = timed ? minutesOf((item.kind === 'event' ? item.starts_at : item.due_at)!, timeZone) : null;
  const end = item.kind === 'event' && timed ? start! + Math.round((Date.parse(item.ends_at!) - Date.parse(item.starts_at!)) / 60_000) : null;
  const days = item.kind === 'event' && !timed && item.start_date && item.end_date ? Math.max(1, daysBetween(item.start_date, item.end_date)) : 1;
  const description = readDescription(formatOf(item.kind), item.description);
  return {
    // A subtask can have no date. It opens with none, and a day picked gives it one.
    id: nextDraft++, kind: item.kind, text: item.title, title: item.title, plain: [], date, undated: item.kind === 'task' && !item.due_date, day: date, slot: null, start, end, days, place: item.place ?? placeName(item) ?? '', address: item.address, picked: null,
    calendarId: item.calendar_id, reminders: item.reminders, lineReminders: [], leaveReminder: item.leave_reminder, recurrence: item.recurrence, project: item.project, newProject: false, pickedProject: null, pickedCalendar: null, labels: item.labels, repeat: item.repeat,
    description: description.blocks, descriptionLossy: description.lossy, fromEmail: [], manual: [], base: NO_BASE,
  };
}

/**
 * An email's or a keynote's proposal as a new draft: its title in the line as words only,
 * none of them read. Its day, time, place, calendar and project
 * are what the line falls back to, so the line still reads what's typed after it. With no day from
 * the email it starts with none, which Create then asks for.
 */
export function fromProposal(draft: Draft, {proposal, reminders, newProject}: Handed, timeZone: string): Draft {
  const item = proposal.item;
  const date = item.kind === 'task' ? item.due_date : item.start_date ?? (item.starts_at ? localDate(item.starts_at, timeZone) : null);
  // No time from the email: all day (an event) or no time (a task). An hour when it gave no end.
  const start = item.starts_at ? minutesOf(item.starts_at, timeZone) : item.due_at ? minutesOf(item.due_at, timeZone) : null;
  const end = item.starts_at ? start! + (item.ends_at ? Math.round((Date.parse(item.ends_at) - Date.parse(item.starts_at)) / 60_000) : DEFAULT_LENGTH) : null;
  const days = item.kind === 'event' && item.all_day && item.start_date && item.end_date ? Math.max(1, daysBetween(item.start_date, item.end_date)) : 1;
  const base = {calendarId: item.calendar_id ?? draft.calendarId, place: item.place ?? '', project: item.project};
  // The description starts with "From: *subject*", marked as the email's (a keynote's has no marks).
  const source = proposal.source;
  const marks: Marked[] = source && proposal.message_id ? [...proposal.from_email, 'description'] : proposal.from_email;
  return {
    ...draft, text: item.title, title: item.title, plain: wordSpans(item.title), date: date ?? draft.date, day: date ?? draft.day, undated: date === null,
    start, end, days, slot: {start, end, days}, place: base.place, address: null, calendarId: base.calendarId, project: base.project, newProject,
    reminders: reminders ?? draft.reminders, fromEmail: marks, manual: [], base, ...(source ? {description: sourceLine(source)} : {}),
  };
}

/** What a draft's line reads after "#": a task's project, from Todoist's, or an event's calendar. */
const lineHash = (draft: Draft, projects: string[], calendars: CalendarOut[]) => (draft.kind === 'task'
  ? {kind: 'project' as const, names: projects, picked: draft.pickedProject}
  : {kind: 'calendar' as const, names: calendars.map(calendar => calendar.name), picked: draft.pickedCalendar});

/**
 * A draft's line as parsed. An edited item's (`original`) reads only what the edit typed.
 * Its plain phrases are hidden from the parser and come back as title words.
 */
export function readLine(draft: Draft, text: string, today: string, calendars: CalendarOut[], projects: string[], original: Draft | null, taskTime: number): ParsedTitle {
  const hidden = masked(text, draft.plain);
  const parsed = parseTitle(hidden.text, today, calendars.map(calendar => calendar.name), draft.picked, lineHash(draft, projects, calendars),
    original ? {before: original.title, day: original.date} : null, reminderBase(draft, original, taskTime));
  if (!hidden.words.length) return parsed;
  const back = (value: string | null) => (value === null ? null : unmasked(value, hidden.words));
  return {...parsed, title: unmasked(parsed.title, hidden.words), place: back(parsed.place), calendar: back(parsed.calendar), project: back(parsed.project)};
}

/**
 * The Title typed into an edited item: what the edit typed changes the item's own fields,
 * as on a new item's line, and a phrase taken out again puts back what the item had. Fields set in
 * their rows stay until a phrase for one is typed. A time typed after the date was set by hand keeps the days picked. A reminder phrase
 * typed adds to the item's reminders.
 */
export function retypeEdit(draft: Draft, text: string, original: Draft, today: string, calendars: CalendarOut[], projects: string[], taskTime: number): Draft {
  const plain = retyped(draft.plain, draft.text, text);
  const parsed = readLine({...draft, plain}, text, today, calendars, projects, original, taskTime);
  // A phrase typed for a field set in its row takes it back.
  const manual = keptPicks(draft.manual, parsed);
  const next = {...draft, text, plain, title: parsed.title, manual};
  const by = (field: Manual) => !manual.includes(field);
  if (by('reminders')) next.lineReminders = parsed.reminders ?? [];
  const base = by('date') && by('time') ? original : draft;
  Object.assign(next, editedWhen({date: by('date') ? original.date : draft.date, start: base.start, end: base.end, days: base.days},
    // A span of days (all day) needs both its day and time. A length needs only its time.
    {date: by('date') ? parsed.date : null, start: by('time') ? parsed.start : null, end: by('time') ? parsed.end : null,
      days: by('date') && by('time') ? parsed.days : null, length: by('time') ? parsed.length : null}, draft.kind));
  if (by('place') && draft.kind === 'event') {
    if (parsed.place === null) Object.assign(next, {place: original.place, address: original.address, picked: null});
    else if (draft.picked === null ? parsed.place !== draft.place : parsed.place !== draft.picked) Object.assign(next, {place: parsed.place, address: null, picked: null});
  }
  if (by('calendar') && draft.kind === 'event' && (draft.pickedCalendar === null || parsed.calendar !== draft.pickedCalendar)) {
    next.calendarId = calendars.find(calendar => calendar.name === parsed.calendar)?.id ?? original.calendarId;
    next.pickedCalendar = null;
  }
  if (by('recurrence') && draft.kind === 'event') next.recurrence = parsed.recurrence ?? original.recurrence;
  if (by('recurrence') && draft.kind === 'task') next.repeat = taskRepeat(parsed.recurrence) ?? original.repeat;
  if (by('project') && draft.kind === 'task' && parsed.project !== (draft.pickedProject ?? draft.project)) {
    next.project = parsed.project ?? original.project;
    next.pickedProject = null;
  }
  return next;
}

/** The line typed into a draft: its title words are the title, and its phrases fill the fields not set by hand. */
export function retype(draft: Draft, text: string, today: string, calendars: CalendarOut[], projects: string[], taskTime: number): Draft {
  const plain = retyped(draft.plain, draft.text, text);
  const parsed = readLine({...draft, plain}, text, today, calendars, projects, null, taskTime);
  // A phrase typed for a field set in its row takes it back.
  const manual = keptPicks(draft.manual, parsed);
  const next = {...draft, text, plain, title: parsed.title, manual};
  const by = (field: Manual) => !manual.includes(field);
  // The line's reminders replace Settings' default, beside what's picked.
  if (by('reminders')) next.lineReminders = parsed.reminders ?? [];
  if (by('date')) {
    next.date = parsed.date ?? draft.day;
    // A day the line names brings back a date taken off, or one the email didn't give.
    if (parsed.date !== null) next.undated = false;
  }
  if (by('time')) {
    // Days picked by hand stay: the end moves to its last day.
    const later = !by('date') ? extraDays(draft.start, draft.end, draft.days) * 1440 : 0;
    if (draft.kind === 'event' && parsed.days !== null && by('date')) {
      // A span of days with no time is all day over them.
      Object.assign(next, {start: null, end: null, days: parsed.days});
    } else if (parsed.start !== null) {
      next.start = parsed.start;
      next.end = draft.kind === 'event' ? (parsed.end ?? parsed.start + DEFAULT_LENGTH) + later : null;
    } else if (draft.kind === 'event' && parsed.length !== null) {
      // A length with no time starts at the default start, the slot's else 9:00 AM.
      next.start = draft.slot?.start ?? DEFAULT_START;
      next.end = next.start + parsed.length + later;
    } else if (draft.slot) {
      // The week view's slot, or a proposal's time (a task's too).
      next.start = draft.slot.start;
      next.end = draft.kind === 'task' || draft.slot.end === null ? null : draft.slot.end + later;
      if (by('date') && draft.kind === 'event') next.days = draft.slot.days;
    } else {
      next.start = draft.kind === 'event' ? DEFAULT_START : null;
      next.end = draft.kind === 'event' ? DEFAULT_START + DEFAULT_LENGTH + later : null;
    }
  }
  // A picked place stays while the line still has the text it was picked for.
  const linePlace = parsed.place ?? draft.base.place;
  if (by('place') && (draft.picked === null ? linePlace !== draft.place : parsed.place !== draft.picked)) {
    next.place = linePlace;
    next.address = null;
    next.picked = null;
  }
  // A calendar picked from the line's menu stays while the line has the text it was picked for.
  if (by('calendar') && draft.kind === 'event' && (draft.pickedCalendar === null || parsed.calendar !== draft.pickedCalendar)) {
    next.calendarId = calendars.find(calendar => calendar.name === parsed.calendar)?.id ?? draft.base.calendarId;
    next.pickedCalendar = null;
  }
  // A task's repeat goes to Todoist in its words.
  if (by('recurrence') && draft.kind === 'event') next.recurrence = parsed.recurrence;
  if (by('recurrence') && draft.kind === 'task') next.repeat = taskRepeat(parsed.recurrence);
  // A picked project stays while the line still has the text it was picked for, as a place does.
  const lineProject = parsed.project ?? draft.base.project;
  if (by('project') && draft.kind === 'task' && lineProject !== (draft.pickedProject ?? draft.project)) {
    next.project = lineProject;
    next.newProject = false;
    next.pickedProject = null;
  }
  return next;
}

/** What creating a draft sends. */
export function createInput(draft: Draft, timeZone: string, todoist: number | null): ItemCreateInput | null {
  // Reminders left at Settings' default are left out, so the server applies it.
  if (!draft.title.trim()) return null;
  if (draft.kind === 'task') {
    if (todoist === null) return null;
    // With no date it has no time or repeat either: a repeat starts on a day.
    const dated = !draft.undated;
    return {
      kind: 'task', calendar_id: todoist, title: draft.title.trim(), all_day: true, starts_at: null, ends_at: null, start_date: null, end_date: null,
      due_date: dated ? draft.date : null, due_at: dated && draft.start !== null ? instantAt(draft.date, draft.start, timeZone) : null, time_zone: null, recurrence: null,
      place: null, address: null, attendees: [], ...(draft.reminders ? {reminders: draft.reminders} : {}), leave_reminder: false, project: draft.project, colour: null, labels: draft.labels, repeat: dated ? draft.repeat : null, description: writeDescription('markdown', draft.description),
    };
  }
  // An email that gave no day leaves the event without one until it's picked.
  if (draft.calendarId === null || draft.undated) return null;
  const when = draft.start === null
    ? {all_day: true, starts_at: null, ends_at: null, start_date: draft.date, end_date: addDays(draft.date, draft.days)}
    : {all_day: false, starts_at: instantAt(draft.date, draft.start, timeZone), ends_at: instantAt(draft.date, draft.end ?? draft.start + DEFAULT_LENGTH, timeZone), start_date: null, end_date: null};
  return {
    kind: 'event', calendar_id: draft.calendarId, title: draft.title.trim(), ...when, due_date: null, due_at: null, time_zone: timeZone,
    recurrence: draft.recurrence, place: draft.place.trim() || null, address: draft.place.trim() ? draft.address : null, attendees: [],
    ...(draft.reminders ? {reminders: draft.reminders} : {}), leave_reminder: draft.leaveReminder, project: null, colour: null, labels: [], repeat: null, description: writeDescription('html', draft.description),
  };
}

const sameList = (a: number[], b: number[]) => a.length === b.length && a.every((value, index) => value === b[index]);

/** What saving an edited draft changes, against the item it came from. */
export function changesOf(draft: Draft, original: Draft, timeZone: string): ItemChanges {
  const changes: ItemChanges = {};
  if (draft.title.trim() !== original.title) changes.title = draft.title.trim();
  const undating = draft.kind === 'task' && draft.undated && !original.undated;
  if (!undating && (draft.undated !== original.undated || draft.date !== original.date || draft.start !== original.start || draft.end !== original.end || draft.days !== original.days)) {
    if (draft.kind === 'task') {
      changes.due_date = draft.date;
      changes.due_at = draft.start === null ? null : instantAt(draft.date, draft.start, timeZone);
    } else if (draft.start === null) {
      Object.assign(changes, {all_day: true, starts_at: null, ends_at: null, start_date: draft.date, end_date: addDays(draft.date, draft.days)});
    } else {
      Object.assign(changes, {all_day: false, start_date: null, end_date: null, starts_at: instantAt(draft.date, draft.start, timeZone), ends_at: instantAt(draft.date, draft.end ?? draft.start + DEFAULT_LENGTH, timeZone)});
    }
  }
  if (draft.place.trim() !== original.place || draft.address !== original.address) {
    changes.place = draft.place.trim() || null;
    changes.address = draft.place.trim() ? draft.address : null;
  }
  if (draft.reminders && !sameList(draft.reminders, original.reminders ?? [])) changes.reminders = draft.reminders;
  if (draft.leaveReminder !== original.leaveReminder) changes.leave_reminder = draft.leaveReminder;
  if (draft.recurrence !== original.recurrence) changes.recurrence = draft.recurrence;
  if (draft.project !== original.project) changes.project = draft.project;
  if (draft.calendarId !== original.calendarId && draft.calendarId !== null) changes.calendar_id = draft.calendarId;
  if (draft.kind === 'task' && draft.repeat !== original.repeat) changes.repeat = draft.repeat;
  if (draft.kind === 'task' && draft.labels.join('\n') !== original.labels.join('\n')) changes.labels = draft.labels;
  // Sent only when it reads differently, so one left alone stays as its provider has it.
  if (!sameDescription(draft.description, original.description)) changes.description = writeDescription(formatOf(draft.kind), draft.description);
  // A subtask's date taken off, its time, repeat and reminders going with it.
  if (undating) {
    Object.assign(changes, {due_date: null, due_at: null, repeat: null});
    if (original.reminders?.length) changes.reminders = [];
    else delete changes.reminders;
  }
  return changes;
}

/**
 * A draft as the grid draws it (a dashed ghost on its day, board 13), "New event" until it has a title.
 * A task with no project yet is drawn in `defaultProject`, where the server will put it.
 */
export function draftPreview(draft: Draft & {reminders: number[]}, timeZone: string, todoist: number | null, defaultProject: string | null = null): ItemOut | null {
  const input = createInput({...draft, title: draft.title || draft.text || `New ${draft.kind}`}, timeZone, todoist);
  if (!input) return null;
  return {
    ...input, ...(draft.kind === 'task' && !input.project ? {project: defaultProject} : {}),
    key: `draft:${draft.id}`, id: -draft.id, recurring: false, occurrence_start: null, done: false, done_at: null, command: null,
    read_only: false, due_string: null, time_to_leave: null, reminders: draft.reminders, time_zone: input.time_zone, subtasks: [], parent_id: null,
    can_reopen: false, link: null, transparency: input.kind === 'event' ? 'opaque' : null,
  } as ItemOut;
}
