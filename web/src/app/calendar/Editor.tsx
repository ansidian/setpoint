// The editor in the right pane (DESIGN.md › Editor; boards 13 and 14). A new event or task starts
// from one line that parses as it's typed ("Dinner with Sam fri 7-9pm @Blue Door": date, time and
// end, place, calendar, each parsed part marked), with the fields under it to check or change: the
// title, the date and times, the place with Places suggestions, the calendar, reminders (Settings ›
// Notifications' default, override 8), the repeat, then the conflict preview, a small timeline of
// the day. Batch drafts add more events ("Create 2 events ⌘Enter"). A Todoist task uses the same
// editor with its due date, project, labels and repeat (F6b: Todoist's words, sent with the date).
// Opened from an email (the proposal card's More options), the fields hold what the card held, and
// those the email gave keep the card's "from the email" mark until they're changed; opened from
// News's Upcoming (its Add to calendar), the keynote's proposal, as an email's is, its calendar picked
// the same way (N3), but with no "from the email" marks. Editing an item shows its fields directly (board 14), says
// what it was ("Was 7:00 – 8:00 AM"), and a recurring event asks This event, This and following or
// All events in place of the footer before it saves. Nothing is created or changed until ⌘Enter.
import type {CalendarOut, Colour, ItemChanges, ItemCreateInput, ItemKind, ItemOut, PlaceSuggestionOut, ProposalField, ProposalOut, RecentPlaceOut, RecurringScope, Settings, TodoistLabelOut, TodoistProjectOut} from '@setpoint/shared';
import {TODOIST_COLOURS} from '@setpoint/shared';
import {useEffect, useMemo, useRef, useState} from 'react';
import type {CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject} from 'react';
import {useResource} from '../../api/client.ts';
import {placeSuggestions, proposalFrom, RECENT_PLACES_PATH, SETTINGS_PATH, TODOIST_LABELS_PATH, TODOIST_PROJECTS_PATH} from '../../api/items.ts';
import {newsProposal} from '../../api/news.ts';
import {findPlace} from '../../api/settings.ts';
import {dayTitle, timeRange} from '../../logic/calendar.ts';
import {bareToken, clockLabel, completeToken, describeRule, lineWithTitle, describeTaskRepeat, draftStarted, endChoices, extraDays, parseClock, parseDay, parseDays, parseTitle, PLACE_URL, readEnd, repeatChoices, spanTo, taskRepeat, taskRepeatChoices, timeChoices} from '../../logic/compose.ts';
import type {Mark} from '../../logic/compose.ts';
import {conflictLine, minutesFrom, overlapsWith, timelineLabels, timelineWindow} from '../../logic/conflict.ts';
import {placeName} from '../../logic/place.ts';
import {remindersLine} from '../../logic/detail.ts';
import {addDays, daysBetween, instantAt, localDate, minutesOf} from '../../logic/format.ts';
import {dayOf} from '../../logic/manipulate.ts';
import {calendarMoveChoices, DEFAULT_SCOPE, scopeChoices} from '../../logic/scope.ts';
import {projectChoice, projectMenu, rankMatches} from '../../logic/search.ts';
import {motion} from '../../tokens.ts';
import {Icon} from '../../ui/Icon.tsx';
import {segThumb} from '../../ui/seg.ts';
import {placeMenu, useMenuRef} from '../../ui/popover.ts';
import {colourVar} from '../accounts.ts';
import {DateField, ProjectField, stepCursor, TimeField} from './Pickers.tsx';
import {ScopePrompt} from './ScopePrompt.tsx';
import './editor.css';

/** What the editor opens on: New C or D on a day, Edit (E) on an item, or an email's proposal. */
export interface EditorOpen {
  kind: ItemKind;
  date: string;
  item?: ItemOut;
  message?: number | null;
  // News's Upcoming keynote, its Add to calendar.
  upcoming?: number | null;
  // Drafts the page kept when the user left Calendar with this editor started, to carry on from (UX #3).
  kept?: KeptDrafts;
  // A range dragged on the week view: its times (null for all day) and days.
  slot?: Slot;
}

/** Where a new event was put on the week view: its time when the line names none (DESIGN.md › Week view). */
export interface Slot {
  start: number | null;
  end: number | null;
  days: number;
}

/** An editor's drafts as they stand, for the page to keep when it's left and bring back. */
export interface KeptDrafts {
  drafts: Draft[];
  active: number;
  kind: ItemKind;
}

type Manual = 'title' | 'date' | 'time' | 'place' | 'calendar' | 'recurrence' | 'labels' | 'project';

interface Draft {
  id: number;
  kind: ItemKind;
  // The line as typed (new items only).
  text: string;
  title: string;
  date: string;
  // The day it was put on (opened on, or a grid day clicked, D56): its date when the line names none.
  day: string;
  // Minutes after the date's midnight; null is all day (an event) or no time (a task). A timed
  // event's end may be days on (SV-29).
  start: number | null;
  end: number | null;
  // An all-day event's days, its date the first (SV-29); 1 otherwise.
  days: number;
  // The time it was put at on the week view (a range dragged, a slot clicked): its time when the
  // line names none, as `day` is its date.
  slot: Slot | null;
  place: string;
  // Set when a suggestion was picked (or the item had one).
  address: string | null;
  // The line's place text a suggestion was picked for ("mcd"): the place stops there (SV-27).
  picked: string | null;
  // Null: the first calendar shown (events).
  calendarId: number | null;
  // Null: Settings › Notifications' default (override 8), which the server applies too.
  reminders: number[] | null;
  // SV-31: Time to Leave, added from the reminder menu; never by default.
  leaveReminder: boolean;
  recurrence: string | null;
  project: string | null;
  // Set when New project was picked for it: Todoist makes it with the task (SV-25, D50).
  newProject: boolean;
  // The line's #project text a menu pick was made for: the project stops there (SV-25).
  pickedProject: string | null;
  // The same for an event's #calendar (D57).
  pickedCalendar: string | null;
  // A task's Todoist labels and repeat (Todoist's words).
  labels: string[];
  repeat: string | null;
  // Fields an email gave (More options on its proposal card), marked until they're changed.
  fromEmail: ProposalField[];
  // Fields set by hand: the line's parse no longer changes them.
  manual: Manual[];
}

/** The button that opens each of the editor's menus, by its label. */
const MENU_OPENERS = {calendar: 'Calendar', repeat: 'Repeat', reminder: 'Add reminder', labels: 'Add label', more: 'More'} as const;

const DEFAULT_START = 9 * 60;
const DEFAULT_LENGTH = 60;
const REMINDER_CHOICES = [0, 5, 10, 15, 30, 60, 120, 1440];

let nextDraft = 1;

/** The proposal card's fields as More options left them (S4), for the editor it opens. */
interface Handed {
  proposal: ProposalOut;
  // Null: Settings' default.
  reminders: number[] | null;
  newProject: boolean;
}
let fromCard: Handed | null = null;
// shortcut: kept in memory, so a reload of /calendar/new reads the email's proposal afresh; move it into the route if that matters.
export const handProposal = (next: Handed) => {
  fromCard = next;
};

function emptyDraft(kind: ItemKind, date: string, slot: Slot | null = null): Draft {
  const at = kind === 'event' ? slot : null;
  return {
    id: nextDraft++, kind, text: '', title: '', date, day: date, slot: at,
    start: at ? at.start : kind === 'event' ? DEFAULT_START : null, end: at ? at.end : kind === 'event' ? DEFAULT_START + DEFAULT_LENGTH : null, days: at?.days ?? 1,
    place: '', address: null, picked: null, calendarId: null, reminders: null, leaveReminder: false, recurrence: null, project: null, newProject: false, pickedProject: null, pickedCalendar: null, labels: [], repeat: null, fromEmail: [], manual: [],
  };
}

/** A draft with its defaults filled in: the first calendar shown, Settings' reminder. */
const withDefaults = (draft: Draft, calendar: number | null, reminders: number[]): Draft & {reminders: number[]} => ({
  ...draft, calendarId: draft.calendarId ?? (draft.kind === 'event' ? calendar : null), reminders: draft.reminders ?? (draft.kind === 'event' ? reminders : []),
});

/** An item as the editor's fields. */
function fromItem(item: ItemOut, timeZone: string): Draft {
  const date = dayOf(item, timeZone) ?? localDate(Date.now(), timeZone);
  const timed = item.kind === 'event' ? !item.all_day && item.starts_at && item.ends_at : !!item.due_at;
  const start = timed ? minutesOf((item.kind === 'event' ? item.starts_at : item.due_at)!, timeZone) : null;
  const end = item.kind === 'event' && timed ? start! + Math.round((Date.parse(item.ends_at!) - Date.parse(item.starts_at!)) / 60_000) : null;
  const days = item.kind === 'event' && !timed && item.start_date && item.end_date ? Math.max(1, daysBetween(item.start_date, item.end_date)) : 1;
  return {
    id: nextDraft++, kind: item.kind, text: item.title, title: item.title, date, day: date, slot: null, start, end, days, place: item.place ?? placeName(item) ?? '', address: item.address, picked: null,
    calendarId: item.calendar_id, reminders: item.reminders, leaveReminder: item.leave_reminder, recurrence: item.recurrence, project: item.project, newProject: false, pickedProject: null, pickedCalendar: null, labels: item.labels, repeat: item.repeat,
    fromEmail: [], manual: ['title', 'date', 'time', 'place', 'calendar', 'recurrence', 'project'],
  };
}

/** What a draft's line reads after "#": a task's project, from Todoist's, or an event's calendar (D57). */
const lineHash = (draft: Draft, projects: string[], calendars: CalendarOut[]) => (draft.kind === 'task'
  ? {kind: 'project' as const, names: projects, picked: draft.pickedProject}
  : {kind: 'calendar' as const, names: calendars.map(calendar => calendar.name), picked: draft.pickedCalendar});

/** The line typed into a draft: what it parses to fills the fields not set by hand. */
function retype(draft: Draft, text: string, today: string, calendars: CalendarOut[], projects: string[]): Draft {
  const parsed = parseTitle(text, today, calendars.map(calendar => calendar.name), draft.picked, lineHash(draft, projects, calendars));
  const next = {...draft, text};
  const by = (field: Manual) => !draft.manual.includes(field);
  if (by('title')) next.title = parsed.title;
  if (by('date')) next.date = parsed.date ?? draft.day;
  if (by('time')) {
    // Days picked by hand stay: the end moves to its last day (SV-29).
    const later = draft.manual.includes('date') ? extraDays(draft.start, draft.end, draft.days) * 1440 : 0;
    if (parsed.start !== null) {
      next.start = parsed.start;
      next.end = draft.kind === 'event' ? (parsed.end ?? parsed.start + DEFAULT_LENGTH) + later : null;
    } else if (draft.kind === 'event' && draft.slot) {
      next.start = draft.slot.start;
      next.end = draft.slot.end === null ? null : draft.slot.end + later;
      if (!draft.manual.includes('date')) next.days = draft.slot.days;
    } else {
      next.start = draft.kind === 'event' ? DEFAULT_START : null;
      next.end = draft.kind === 'event' ? DEFAULT_START + DEFAULT_LENGTH + later : null;
    }
  }
  // A picked place stays while the line still has the text it was picked for.
  if (by('place') && (draft.picked === null ? (parsed.place ?? '') !== draft.place : parsed.place !== draft.picked)) {
    next.place = parsed.place ?? '';
    next.address = null;
    next.picked = null;
  }
  // A calendar picked from the line's menu stays while the line has the text it was picked for.
  if (by('calendar') && draft.kind === 'event' && (draft.pickedCalendar === null || parsed.calendar !== draft.pickedCalendar)) {
    next.calendarId = calendars.find(calendar => calendar.name === parsed.calendar)?.id ?? null;
    next.pickedCalendar = null;
  }
  // A task's repeat goes to Todoist in its words (SV-25).
  if (by('recurrence') && draft.kind === 'event') next.recurrence = parsed.recurrence;
  if (by('recurrence') && draft.kind === 'task') next.repeat = taskRepeat(parsed.recurrence);
  // A picked project stays while the line still has the text it was picked for, as a place does.
  if (by('project') && draft.kind === 'task' && parsed.project !== (draft.pickedProject ?? draft.project)) {
    next.project = parsed.project;
    next.newProject = false;
    next.pickedProject = null;
  }
  return next;
}

/** What creating a draft sends. */
function createInput(draft: Draft, timeZone: string, todoist: number | null): ItemCreateInput | null {
  // Reminders left at Settings' default are left out, so the server applies it.
  if (!draft.title.trim()) return null;
  if (draft.kind === 'task') {
    if (todoist === null) return null;
    return {
      kind: 'task', calendar_id: todoist, title: draft.title.trim(), all_day: true, starts_at: null, ends_at: null, start_date: null, end_date: null,
      due_date: draft.date, due_at: draft.start === null ? null : instantAt(draft.date, draft.start, timeZone), time_zone: null, recurrence: null,
      place: null, address: null, attendees: [], leave_reminder: false, project: draft.project, colour: null, labels: draft.labels, repeat: draft.repeat,
    };
  }
  if (draft.calendarId === null) return null;
  const when = draft.start === null
    ? {all_day: true, starts_at: null, ends_at: null, start_date: draft.date, end_date: addDays(draft.date, draft.days)}
    : {all_day: false, starts_at: instantAt(draft.date, draft.start, timeZone), ends_at: instantAt(draft.date, draft.end ?? draft.start + DEFAULT_LENGTH, timeZone), start_date: null, end_date: null};
  return {
    kind: 'event', calendar_id: draft.calendarId, title: draft.title.trim(), ...when, due_date: null, due_at: null, time_zone: timeZone,
    recurrence: draft.recurrence, place: draft.place.trim() || null, address: draft.place.trim() ? draft.address : null, attendees: [],
    ...(draft.reminders ? {reminders: draft.reminders} : {}), leave_reminder: draft.leaveReminder, project: null, colour: null, labels: [], repeat: null,
  };
}

const sameList = (a: number[], b: number[]) => a.length === b.length && a.every((value, index) => value === b[index]);

/** What saving an edited draft changes, against the item it came from. */
function changesOf(draft: Draft, original: Draft, timeZone: string): ItemChanges {
  const changes: ItemChanges = {};
  if (draft.title.trim() !== original.title) changes.title = draft.title.trim();
  if (draft.date !== original.date || draft.start !== original.start || draft.end !== original.end || draft.days !== original.days) {
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
  return changes;
}

/**
 * A draft as the grid draws it (a dashed ghost on its day, board 13), "New event" until it has a title (SV-29).
 * A task with no project yet is drawn in `defaultProject`, where the server will put it (SV-72).
 */
export function draftPreview(draft: Draft & {reminders: number[]}, timeZone: string, todoist: number | null, defaultProject: string | null = null): ItemOut | null {
  const input = createInput({...draft, title: draft.title || draft.text || `New ${draft.kind}`}, timeZone, todoist);
  if (!input) return null;
  return {
    ...input, ...(draft.kind === 'task' && !input.project ? {project: defaultProject} : {}),
    key: `draft:${draft.id}`, id: -draft.id, recurring: false, occurrence_start: null, done: false, done_at: null, command: null,
    read_only: false, due_string: null, time_to_leave: null, reminders: draft.reminders, time_zone: input.time_zone,
  } as ItemOut;
}

/** Tab alone, which picks a suggestion as Enter does (SV-29). */
const accepts = (event: ReactKeyboardEvent) => event.key === 'Tab' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;

// ---------- The marked line ----------

const markClass: Record<Mark['kind'], string> = {when: 'tok-d', place: 'tok-p', calendar: 'tok-c', project: 'tok-j'};

/**
 * The line's text with its marks: a #calendar in its calendar's colour, a #project in its project's
 * (SV-56; `ink2` while it names no project yet, or a new one). The mark still being typed, its menu
 * open, is `live`, only a dashed underline; the one just picked lands, its tint brightening once
 * (polish audit calflows-06).
 */
function Marked({text, marks, calendarColour, projectColour, live = null, landed = null}: {
  text: string;
  marks: Mark[];
  calendarColour?: Colour | null;
  projectColour?: string | null;
  // Where the live mark and the one just picked start.
  live?: number | null;
  landed?: number | null;
}) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const mark of marks) {
    if (mark.start > at) parts.push(text.slice(at, mark.start));
    const colour = mark.kind === 'calendar' ? colourVar(calendarColour ?? undefined) : mark.kind === 'project' && projectColour ? projectColour : null;
    const state = mark.start === live ? ' live' : mark.start === landed ? ' landed' : '';
    parts.push(<span key={mark.start} className={`${markClass[mark.kind]}${state}`} style={colour ? {'--c': colour} as CSSProperties : undefined}>{text.slice(mark.start, mark.end)}</span>);
    at = mark.end;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

/**
 * Whether a field just changed as a side effect, for its 600 ms flash (polish audit calflows-06):
 * `value` changed while `cause`, the field's own input, didn't (the address has none: a pick fills it).
 */
function useFlash(value: string, cause: string): boolean {
  const [last, setLast] = useState({value, cause, at: 0});
  if (last.value !== value || last.cause !== cause) setLast({value, cause, at: last.cause === cause && last.value !== value ? last.at + 1 : last.at});
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!last.at) return;
    const timer = window.setTimeout(() => setShown(last.at), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [last.at]);
  return last.at > shown;
}

const FLASH_MS = 600;

const MIRROR_EVENTS = ['scroll', 'input', 'select', 'keyup', 'focus', 'blur'] as const;

/**
 * Keeps the line's marks under its letters (SV-56): a line longer than the field scrolls inside the
 * input, so the mirror moves with it, and says which sides are cut short, which fade.
 */
function useMirror(input: RefObject<HTMLInputElement | null>, mirror: RefObject<HTMLSpanElement | null>, text: string) {
  useEffect(() => {
    const field = input.current;
    const marks = mirror.current;
    const inner = marks?.firstElementChild;
    if (!field || !marks || !(inner instanceof HTMLElement)) return;
    let frame = 0;
    const follow = () => {
      cancelAnimationFrame(frame);
      // Chromium moves the input's scroll after its caret, so it's read a frame later.
      frame = requestAnimationFrame(() => {
        const left = field.scrollLeft;
        inner.style.transform = left ? `translateX(${-left}px)` : '';
        marks.toggleAttribute('data-clip-left', left > 0);
        marks.toggleAttribute('data-clip-right', field.scrollWidth - field.clientWidth - left > 1);
      });
    };
    for (const name of MIRROR_EVENTS) field.addEventListener(name, follow);
    follow();
    return () => {
      cancelAnimationFrame(frame);
      for (const name of MIRROR_EVENTS) field.removeEventListener(name, follow);
    };
  }, [input, mirror, text]);
}

// ---------- The editor ----------

interface EditorProps {
  open: EditorOpen;
  calendars: CalendarOut[] | undefined;
  today: string;
  timeZone: string;
  // The items on a day, for the conflict preview.
  dayItems: (date: string) => ItemOut[];
  handed: boolean;
  // The drafts as the grid shows them, and the active one's day (the selected day while it's open).
  onPreview: (previews: ItemOut[], day: string | null) => void;
  onCreate: (inputs: ItemCreateInput[]) => void;
  onSave: (item: ItemOut, changes: ItemChanges, scope: RecurringScope) => void;
  onDelete: (item: ItemOut) => void;
  onClose: () => void;
  // Esc inside the editor: the page closes what's on top (a floating detail first), else the editor.
  onEscape?: () => void;
  // Whether the draft holds anything (choice 14: E or New doesn't replace it then).
  onDirty?: (dirty: boolean) => void;
  // The drafts as they stand, after every change, for the page to keep if it's left (UX #3).
  onKeep?: (kept: KeptDrafts) => void;
  // A day clicked on the grid for the active new draft (D56); on the week view's hours, its time too.
  place?: {day: string; at?: number};
}

export function Editor({open, calendars, today, timeZone, dayItems, handed, onPreview, onCreate, onSave, onDelete, onClose, onEscape, onDirty, onKeep, place}: EditorProps) {
  const {data: settings} = useResource<Settings>(SETTINGS_PATH);
  const {data: projects} = useResource<TodoistProjectOut[]>(open.kind === 'task' ? TODOIST_PROJECTS_PATH : null);
  // Where a task with no project goes, as the server picks it: Settings' default project, else Todoist's Inbox.
  const defaultProject = projects?.find(one => one.name === settings?.todoist.default_project)?.name ?? projects?.find(one => one.inbox)?.name ?? null;
  const {data: todoistLabels} = useResource<TodoistLabelOut[]>(open.kind === 'task' ? TODOIST_LABELS_PATH : null);
  const google = useMemo(() => (calendars ?? []).filter(calendar => calendar.provider === 'google'), [calendars]);
  const projectNames = useMemo(() => (projects ?? []).map(project => project.name), [projects]);
  const todoist = (calendars ?? []).find(calendar => calendar.provider === 'todoist')?.id ?? null;
  const fallbackCalendar = google.find(calendar => calendar.visible)?.id ?? google[0]?.id ?? null;
  const eventDefault = settings?.reminders.event_minutes_before ?? null;
  // Time to Leave's chip says how it leaves, or that Settings has it off (SV-31).
  const leaveTitle = settings && !settings.time_to_leave.enabled ? 'Time to Leave is off in Settings › Notifications'
    : `Leave by live routes from Home, with a ${settings?.time_to_leave.buffer_minutes ?? 5} min buffer`;
  const defaultReminders = useMemo(() => (open.kind === 'event' && eventDefault !== null ? [eventDefault] : []), [open.kind, eventDefault]);
  const editing = open.item ?? null;
  // An event moves only between the calendars of its own Google account (Google's events.move).
  const accountOf = editing ? (calendars ?? []).find(one => one.id === editing.calendar_id)?.account_id : undefined;
  const calendarChoices = editing ? google.filter(one => one.account_id === accountOf) : google;

  const [original] = useState(() => (editing ? fromItem(editing, timeZone) : null));
  const [drafts, setDrafts] = useState<Draft[]>(() => open.kept?.drafts ?? [original ? {...original} : emptyDraft(open.kind, open.date, open.slot ?? null)]);
  const [active, setActive] = useState(open.kept?.active ?? drafts[0]!.id);
  const [kind, setKind] = useState<ItemKind>(open.kept?.kind ?? open.kind);
  useEffect(() => onKeep?.({drafts, active, kind}), [drafts, active, kind, onKeep]);
  const [asking, setAsking] = useState(false);
  const [scope, setScope] = useState<RecurringScope>(DEFAULT_SCOPE);
  const [menu, setMenu] = useState<'calendar' | 'repeat' | 'reminder' | 'labels' | 'more' | null>(null);
  const menuRef = useMenuRef(menu, () => setMenu(null));
  const [places, setPlaces] = useState<{query: string; list: PlaceSuggestionOut[]; cur: number} | null>(null);
  // SV-71: the Place field was focused, so it offers the recent places; and the recent list's cursor, or Esc.
  const [placeAsked, setPlaceAsked] = useState(false);
  const [recentMenu, setRecentMenu] = useState<{query: string; cur: number; closed: boolean} | null>(null);
  // The line's #project menu: its cursor, and whether Esc closed it, for the project typed.
  const [lineMenu, setLineMenu] = useState<{query: string; cur: number; closed: boolean} | null>(null);
  const [sessionToken, setSessionToken] = useState(() => crypto.randomUUID());
  const line = useRef<HTMLInputElement>(null);
  const lineMarks = useRef<HTMLSpanElement>(null);
  const title = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const filled = useMemo(() => drafts.map(one => withDefaults(one, fallbackCalendar, defaultReminders)), [drafts, fallbackCalendar, defaultReminders]);
  const draft = filled.find(one => one.id === active) ?? filled[0]!;

  // From an email: the proposal card's fields fill the first draft, else the email's proposal. From
  // News's Upcoming: the keynote's proposal (N3), its name, day and time and the calendar an email's
  // would take. The news gave its fields, but "from the email" would be wrong of a keynote and DESIGN
  // draws no mark of the news's own, so they come with none, as if typed (N5).
  useEffect(() => {
    // A kept draft already holds what the email gave, and what the user changed since.
    if ((!open.message && !open.upcoming) || open.kept) return;
    let live = true;
    const given = open.message && fromCard?.proposal.message_id === open.message && fromCard.proposal.kind === open.kind ? fromCard : null;
    const proposed: Promise<Handed | null> = open.upcoming
      ? newsProposal(open.upcoming).then(({kind, item, conflict}) => ({proposal: {kind, message_id: 0, item, from_email: [], conflict}, reminders: null, newProject: false}))
      : given ? Promise.resolve(given) : proposalFrom(open.message!, open.kind).then(proposal => ({proposal, reminders: null, newProject: false}));
    void proposed.then(handed => {
      if (!live || !handed) return;
      const {proposal, reminders, newProject} = handed;
      const item = proposal.item;
      const date = item.kind === 'task' ? item.due_date : item.start_date ?? (item.starts_at ? localDate(item.starts_at, timeZone) : null);
      setDrafts(list => list.map((one, index) => (index ? one : {
        ...one, text: item.title, title: item.title, date: date ?? one.date,
        start: item.starts_at ? minutesOf(item.starts_at, timeZone) : item.due_at ? minutesOf(item.due_at, timeZone) : item.all_day && item.kind === 'event' ? null : one.start,
        end: item.starts_at && item.ends_at ? minutesOf(item.starts_at, timeZone) + Math.round((Date.parse(item.ends_at) - Date.parse(item.starts_at)) / 60_000) : item.all_day && item.kind === 'event' ? null : one.end,
        days: item.kind === 'event' && item.all_day && item.start_date && item.end_date ? Math.max(1, daysBetween(item.start_date, item.end_date)) : 1,
        place: item.place ?? '', calendarId: item.calendar_id ?? one.calendarId, project: item.project, newProject, reminders: reminders ?? one.reminders,
        manual: ['title', 'date', 'time', 'place', 'calendar', 'project'],
        fromEmail: proposal.from_email,
      })));
    }).catch(() => {});
    return () => {
      live = false;
    };
  }, [open.message, open.upcoming, open.kind, open.kept, timeZone]);

  // The grid shows new drafts as ghosts, and the active one's day as selected.
  useEffect(() => {
    if (editing) {
      onPreview([], null);
      return;
    }
    onPreview(filled.map(one => draftPreview(one, timeZone, todoist, defaultProject)).filter((one): one is ItemOut => one !== null), draft.date);
  }, [filled, draft.date, editing, timeZone, todoist, defaultProject, onPreview]);
  useEffect(() => () => onPreview([], null), [onPreview]);

  // Places for the place as it's typed (in the line or the field), until one is picked; a link has none.
  const placeQuery = draft.kind === 'event' && draft.address === null && !PLACE_URL.test(draft.place.trim()) ? draft.place.trim() : '';
  useEffect(() => {
    if (placeQuery.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      void placeSuggestions(placeQuery, sessionToken).then(list => {
        if (live) setPlaces({query: placeQuery, list, cur: 0});
      }).catch(() => live && setPlaces(null));
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [placeQuery, sessionToken]);
  // Open until one is picked, the place changes, or Esc (not on blur: a click elsewhere in the editor would land on a moved target).
  const placesOpen = !!places && places.query === placeQuery && places.list.length > 0;

  const parsed = useMemo(() => parseTitle(draft.text, today, google.map(one => one.name), draft.picked, lineHash(draft, projectNames, google)),
    [draft, today, google, projectNames]);
  // A #project (a task) or #calendar (an event, D57) typed in the line shows its field's menu until
  // one is picked, the line has none, or Esc.
  const hashMark = parsed.marks.find(mark => draft.text[mark.start] === '#');
  // A lone "#" ending the line opens the whole menu before anything is typed (SV-71).
  const bareHash = hashMark ? null : bareToken(draft.text, '#');
  const lineMark: Mark | undefined = hashMark ?? (bareHash ? {start: bareHash.start, end: draft.text.length, kind: draft.kind === 'task' ? 'project' : 'calendar'} : undefined);
  const lineQuery = editing || !lineMark ? null
    : draft.kind === 'task' ? (draft.pickedProject === null && !draft.manual.includes('project') ? (hashMark ? parsed.project : '') : null)
      : draft.pickedCalendar === null && !draft.manual.includes('calendar') ? draft.text.slice(lineMark.start + 1, lineMark.end).replace(/\s*,$/, '') : null;
  const projectLine = draft.kind === 'task' && lineQuery !== null ? projectMenu(lineQuery, projects ?? [], draft.newProject) : [];
  // Both menus put the names starting with what's typed first, as the line reads them (SV-56).
  const calendarLine = draft.kind === 'event' && lineQuery !== null ? rankMatches(lineQuery, google, one => one.name) : [];
  const lineCount = projectLine.length + calendarLine.length;
  const lineCur = Math.min(lineMenu?.query === lineQuery ? lineMenu.cur : 0, lineCount - 1);
  const lineOpen = lineCount > 0 && !(lineMenu?.query === lineQuery && lineMenu.closed);
  // Before Places can search (two letters), the places events have used (SV-71): under a lone "@" (or
  // "@" and a letter) ending the line, or once the Place field is focused with less than that in it.
  // Like Places' list, it stays until a pick, Esc or Tab, not on blur.
  const {data: recent} = useResource<RecentPlaceOut[]>(draft.kind === 'event' ? RECENT_PLACES_PATH : null);
  const atToken = draft.kind === 'event' && !editing && !draft.manual.includes('place') && !parsed.marks.some(mark => mark.kind === 'place') ? bareToken(draft.text, '@') : null;
  const recentQuery = atToken ? atToken.query : placeAsked && draft.kind === 'event' && draft.address === null && draft.place.trim().length < 2 ? draft.place.trim() : null;
  const recentList: PlaceSuggestionOut[] = recentQuery === null ? [] : rankMatches(recentQuery, recent ?? [], one => one.name).map(one => ({place_id: '', name: one.name, address: one.address ?? ''}));
  const recentCur = Math.min(recentMenu?.query === recentQuery ? recentMenu.cur : 0, recentList.length - 1);
  const recentOpen = recentList.length > 0 && !(recentMenu?.query === recentQuery && recentMenu.closed);
  // The place's one menu: the recent places, or Places' suggestions for what's typed.
  const placeMenuShown = recentOpen ? {list: recentList, cur: recentCur, query: recentQuery!} : placesOpen ? {list: places.list, cur: places.cur, query: placeQuery} : null;
  // An unknown project not picked as new isn't sent (D50): Create waits, and the line under Project says why.
  const projectChosen = draft.kind === 'task' && projects && draft.project !== original?.project ? projectChoice(draft.project ?? '', projects, draft.newProject) : null;
  // The line's #project in its project's colour, as the Project field's dot (SV-56).
  const projectTodoist = draft.kind === 'task' && !draft.newProject && draft.project ? projects?.find(one => one.name.toLowerCase() === draft.project!.toLowerCase())?.colour : null;
  useMirror(line, lineMarks, draft.text);
  const projectProblem = projectChosen && 'problem' in projectChosen ? projectChosen.problem : null;

  useEffect(() => {
    if (!editing) line.current?.focus();
  }, [editing, active]);
  // E on an item focuses its Title, selected, so typing renames it rather than reaching the calendar's keys (UX #7).
  useEffect(() => {
    if (!editing) return;
    title.current?.focus();
    title.current?.select();
  }, [editing]);

  // A pick removes the menu item that had focus: focus goes back to the field that opened the menu
  // (or the editor itself), so ⌘Enter and Esc keep working.
  const lastMenu = useRef(menu);
  useEffect(() => {
    const closed = lastMenu.current;
    lastMenu.current = menu;
    const host = form.current;
    if (!closed || menu || !host || host.contains(document.activeElement)) return;
    (host.querySelector<HTMLElement>(`[aria-label="${MENU_OPENERS[closed]}"]`) ?? host).focus();
  }, [menu]);

  const change = (next: Partial<Draft>, manual: Manual[] = []) => {
    // A field changed by hand loses its "from the email" mark.
    const edited: ProposalField[] = [];
    if (next.title !== undefined) edited.push('title');
    if (next.date !== undefined) edited.push('date');
    if (next.start !== undefined || next.end !== undefined) edited.push('time');
    if (next.place !== undefined) edited.push('place');
    setDrafts(list => list.map(one => (one.id === draft.id
      ? {...one, ...next, manual: [...new Set([...one.manual, ...manual])], fromEmail: one.fromEmail.filter(field => !edited.includes(field))}
      : one)));
  };
  const mark = (...fields: ProposalField[]) => (fields.some(field => draft.fromEmail.includes(field))
    ? <span className="srcm" title="From the email" aria-label="From the email"><Icon name="mail" size={14} /></span> : null);
  // A Title typed by hand rewrites the line's title words, so the two never disagree, and the line
  // goes on giving the title (UX #8).
  const retitle = (title: string) => {
    const text = lineWithTitle(draft.text, parsed.marks, title);
    setDrafts(list => list.map(one => (one.id === draft.id
      ? {...one, title, text, manual: one.manual.filter(field => field !== 'title'), fromEmail: one.fromEmail.filter(field => field !== 'title')}
      : one)));
  };
  const typeLine = (text: string) => setDrafts(list => list.map(one => (one.id === draft.id ? retype(one, text, today, google, projectNames) : one)));
  // Where the line's caret goes once a pick has rewritten it.
  const caret = useRef<number | null>(null);
  useEffect(() => {
    if (caret.current === null) return;
    line.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [draft.text]);
  // The mark just picked, brightening once as it lands (polish audit calflows-06).
  const [landed, setLanded] = useState<{start: number; seq: number} | null>(null);
  useEffect(() => {
    if (!landed) return;
    const timer = window.setTimeout(() => setLanded(current => (current === landed ? null : current)), motion.slow);
    return () => window.clearTimeout(timer);
  }, [landed]);
  /** A pick for the line's "@place" or "#name" (its mark): the line reads the name in full, then a space (SV-29). */
  const completeLine = (mark: Mark, name: string, picked: Partial<Draft>) => {
    const next = completeToken(draft.text, mark.start, mark.end, name);
    caret.current = next.caret;
    setLanded({start: mark.start, seq: (landed?.seq ?? 0) + 1});
    setDrafts(list => list.map(one => (one.id === draft.id ? retype({...one, ...picked}, next.text, today, google, projectNames) : one)));
  };
  const pickLine = (index: number) => {
    if (draft.kind === 'task') {
      const {name, isNew} = projectLine[index]!;
      completeLine(lineMark!, name, {project: name, newProject: isNew, pickedProject: name});
    } else {
      const {id, name} = calendarLine[index]!;
      completeLine(lineMark!, name, {calendarId: id, pickedCalendar: name});
    }
  };
  const pick = (place: PlaceSuggestionOut) => {
    const placeMark = draft.manual.includes('place') ? undefined
      : parsed.marks.find(mark => mark.kind === 'place') ?? (atToken ? {start: atToken.start, end: draft.text.length, kind: 'place' as const} : undefined);
    const chosen = {place: place.name, address: place.address || ''};
    if (placeMark) completeLine(placeMark, place.name, {...chosen, picked: place.name});
    else change({...chosen, picked: null});
    setPlaces(null);
    setPlaceAsked(false);
    // A recent place comes with its address, and isn't Google's.
    if (!place.place_id) return;
    // A suggestion's second line can leave out the street number; Place Details has the address in
    // full. It ends Google's session, so the next place typed starts a new one.
    const id = draft.id;
    setSessionToken(crypto.randomUUID());
    void findPlace(place.place_id, sessionToken).then(found => {
      if (!found.address) return;
      setDrafts(list => list.map(one => (one.id === id && one.place === chosen.place && one.address === chosen.address ? {...one, address: found.address} : one)));
    }).catch(() => {});
  };

  const switchKind = (next: ItemKind) => {
    if (next === kind || editing) return;
    setKind(next);
    setDrafts(list => list.map(one => retype({...emptyDraft(next, one.day), id: one.id}, one.text, today, google, projectNames)));
  };

  const addAnother = () => {
    const fresh = emptyDraft(kind, draft.date);
    setDrafts(list => [...list, fresh]);
    setActive(fresh.id);
  };
  // A folded draft of the batch goes with its × (SV-29).
  const removeDraft = (id: number) => setDrafts(list => list.filter(one => one.id !== id));

  // A grid day clicked moves the active new draft there, unless its line names a day or Date was set
  // by hand (D56).
  const [placed, setPlaced] = useState(place);
  if (place !== placed) {
    setPlaced(place);
    const named = draft.manual.includes('date') || parsed.date !== null;
    // On the week view's hours it takes the time clicked too, keeping its length, unless the line names a time or Time was set by hand.
    const timed = place?.at !== undefined && draft.kind === 'event' && draft.start !== null && draft.end !== null && !draft.manual.includes('time') && parsed.start === null;
    if (place && !editing) {
      setDrafts(list => list.map(one => {
        if (one.id !== draft.id) return one;
        const moved = {...one, day: place.day, date: named ? one.date : place.day};
        if (!timed || one.start === null || one.end === null) return moved;
        const slot = {start: place.at!, end: place.at! + (one.end - one.start), days: 1};
        return {...moved, slot, start: slot.start, end: slot.end};
      }));
    }
  }

  const dirty = editing && original ? Object.keys(changesOf(draft, original, timeZone)).length > 0 : draftStarted(drafts);
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);

  const inputs = filled.map(one => {
    const input = createInput({...one, reminders: drafts.find(raw => raw.id === one.id)!.reminders}, timeZone, todoist);
    if (input?.kind !== 'task') return input;
    // A task's project by Todoist's own name, made only when New project was picked.
    const chosen = projectChoice(one.project ?? '', projects ?? [], one.newProject);
    return 'problem' in chosen ? null : {...input, ...chosen};
  });
  const ready = inputs.filter((input): input is ItemCreateInput => input !== null);
  const submit = () => {
    if (editing && original) {
      if (projectProblem) return;
      const changes = changesOf(draft, original, timeZone);
      if (!Object.keys(changes).length) return onClose();
      if (editing.kind === 'event' && editing.recurring && !asking) {
        setScope(choices[0]!.scope);
        setAsking(true);
        return;
      }
      onSave(editing, changes, asking ? scope : 'this');
      return;
    }
    if (ready.length && ready.length === drafts.length) onCreate(ready);
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (menu) setMenu(null);
      else if (recentOpen) setRecentMenu({query: recentQuery!, cur: recentCur, closed: true});
      else if (placesOpen) setPlaces(null);
      else if (lineOpen) setLineMenu({query: lineQuery!, cur: lineCur, closed: true});
      else (onEscape ?? onClose)();
    } else if (recentOpen && atToken === null && recentQuery === '' && accepts(event)) {
      // Tab through an empty Place field goes on without picking a place it was never asked for.
      setPlaceAsked(false);
    } else if (recentOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setRecentMenu({query: recentQuery!, cur: stepCursor(event.key, recentCur, recentList.length)!, closed: false});
    } else if (recentOpen && (event.key === 'Enter' || accepts(event))) {
      if (event.key === 'Enter' || event.target === line.current) event.preventDefault();
      pick(recentList[recentCur]!);
    } else if (placesOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setPlaces({...places, cur: (places.cur + delta + places.list.length) % places.list.length});
    } else if (placesOpen && (event.key === 'Enter' || accepts(event))) {
      // Tab picks as Enter does (SV-29); from the Place field it goes on to the next field.
      if (event.key === 'Enter' || event.target === line.current) event.preventDefault();
      pick(places.list[places.cur]!);
    } else if (lineOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setLineMenu({query: lineQuery!, cur: stepCursor(event.key, lineCur, lineCount)!, closed: false});
    } else if (lineOpen && ((event.key === 'Enter' && !event.metaKey && !event.ctrlKey) || accepts(event))) {
      event.preventDefault();
      pickLine(lineCur);
    }
  };

  const calendar = (calendars ?? []).find(one => one.id === draft.calendarId);
  // An event's last day (SV-29): its date for a one-day event and every task.
  const lastDay = kind === 'event' ? addDays(draft.date, extraDays(draft.start, draft.end, draft.days)) : draft.date;
  // Each row whose value the line gave takes its mark's colour on its glyph; set by hand, it's `ink3`
  // again (polish audit calflows-06).
  const fromLine = (kind: Mark['kind'], ...fields: Manual[]) => !editing && parsed.marks.some(one => one.kind === kind) && !fields.some(field => draft.manual.includes(field));
  const echo = {
    when: fromLine('when', 'date', 'time') ? 'from-when' : undefined,
    place: fromLine('place', 'place') ? 'from-place' : undefined,
    calendar: fromLine('calendar', 'calendar') ? 'from-cal' : undefined,
    project: fromLine('project', 'project') ? 'from-proj' : undefined,
  };
  const liveMark = editing ? null : placesOpen ? parsed.marks.find(one => one.kind === 'place')?.start ?? null : lineOpen ? lineMark?.start ?? null : null;
  // A field changed by another's change flashes: the Date when the End runs into the next day, the address a picked place fills in.
  const flashDate = useFlash(lastDay, draft.date);
  const flashAddress = useFlash(draft.address ?? '', '');
  const laterDays = draft.end !== null ? extraDays(draft.start, draft.end, 1) : 0;
  const unpicked = (todoistLabels ?? []).filter(label => !draft.labels.includes(label.name));
  // A recurring event moving to another calendar goes as a series (Google can't move one occurrence).
  const choices = original && draft.calendarId !== original.calendarId && calendar ? calendarMoveChoices(original.date, calendar.name) : original ? scopeChoices(original.date, draft.date) : [];
  const noun = kind === 'event' ? 'event' : 'task';
  const changed = (field: 'date' | 'start' | 'end') => !!original && draft[field] !== original[field];
  const was = original && original.kind === 'event' && original.start !== null && (draft.date !== original.date || draft.start !== original.start || draft.end !== original.end) && editing
    ? `Was ${draft.date !== original.date ? `${dayTitle(original.date)} · ` : ''}${timeRange(editing, timeZone)}`
    : null;

  return (
    <form ref={form} tabIndex={-1} className={`rpane editor${handed ? ' handed' : ''}`} aria-label={editing ? `Edit ${noun}` : `New ${noun}`} onKeyDown={onKeyDown}
      onSubmit={event => {
        event.preventDefault();
        submit();
      }}>
      <div className="ed-head">
        <span className="grow ed-title">{editing ? `Edit ${noun}` : `New ${noun}`}</span>
        {editing ? (
          <span className="menu-host">
            <button type="button" className="ibtn" aria-label="More" aria-expanded={menu === 'more'} onClick={() => setMenu(menu === 'more' ? null : 'more')}><Icon name="more_horiz" /></button>
            {menu === 'more' && (
              <div ref={menuRef} className="pop menu right" role="menu">
                <button type="button" role="menuitem" className="menu-i danger" onClick={() => onDelete(editing)}><Icon name="delete" size={16} />Delete<span className="kbd">Del</span></button>
              </div>
            )}
          </span>
        ) : (
          <span className="seg" ref={segThumb} role="tablist" aria-label="Item type">
            <span className={kind === 'event' ? 'on' : ''} role="tab" aria-selected={kind === 'event'} onClick={() => switchKind('event')}>Event</span>
            <span className={kind === 'task' ? 'on' : ''} role="tab" aria-selected={kind === 'task'} onClick={() => switchKind('task')}>Task</span>
          </span>
        )}
        <button type="button" className="ibtn" aria-label="Close editor" title="Close · Esc" onClick={onClose}><Icon name="close" /></button>
      </div>

      <div className="ed-scroll">
        <div className="ed-line">
          {editing ? (
            <label className="field big"><input ref={title} className="grow" aria-label="Title" value={draft.title} onChange={event => change({title: event.target.value}, ['title'])} /></label>
          ) : (
            <label className="field big nl">
              <span ref={lineMarks} className="nl-marks" aria-hidden="true">
                <span className="nl-text"><Marked text={draft.text} marks={parsed.marks} calendarColour={calendar?.colour} projectColour={projectTodoist ? TODOIST_COLOURS[projectTodoist] : null}
                  live={liveMark} landed={landed?.start ?? null} key={landed?.seq ?? 0} /></span>
              </span>
              <input ref={line} className="nl-input" aria-label={`Describe the ${noun}`} value={draft.text} spellCheck={false} autoComplete="off"
                placeholder={kind === 'event' ? 'Dinner with Sam fri 7-9pm @Blue Door' : 'Pay rent fri'}
                onChange={event => typeLine(event.target.value)} />
            </label>
          )}
        </div>

        <div className="eg">
          {!editing && (
            <>
              <span />
              <label className="field"><input className="grow" aria-label="Title" placeholder="Title" value={draft.title} onChange={event => retitle(event.target.value)} />{mark('title')}</label>
            </>
          )}

          <Icon name="schedule" size={17} className={echo.when} />
          <div className={`prow${lastDay !== draft.date ? ' days' : ''}`}>
            <DateField className={`date${changed('date') || (!!original && draft.days !== original.days) ? ' changed' : ''}${flashDate ? ' flash' : ''}`} label={kind === 'task' ? 'Due date' : 'Date'} value={draft.date}
              shown={lastDay === draft.date ? dayTitle(draft.date) : `${dayTitle(draft.date)} – ${dayTitle(lastDay)}`}
              today={today} read={text => parseDay(text, today)} onValue={date => change({date}, ['date'])}
              range={kind === 'event' ? {to: lastDay, read: text => parseDays(text, today), onRange: (from, to) => change(spanTo(from, to, draft.start, draft.end), ['date'])} : undefined} />
            {draft.start !== null ? (
              <>
                <TimeField className={`time num${changed('start') ? ' changed' : ''}`} label="Start" value={draft.start} choices={timeChoices()}
                  read={text => parseClock(text, draft.start)} onValue={start => change({start, end: draft.end === null ? null : start + (draft.end - draft.start!)}, ['time'])} />
                {draft.end !== null && (
                  <>
                    <span className="ink3">–</span>
                    <TimeField className={`time num${changed('end') ? ' changed' : ''}`} label="End" value={draft.end} choices={endChoices(draft.start, draft.end)}
                      read={text => readEnd(text, draft.start!, draft.end!)} onValue={end => change({end}, ['time'])} />
                    {laterDays > 0 && <span className="later num" title={`Ends ${dayTitle(lastDay)}`}>+{laterDays}</span>}
                  </>
                )}
                <button type="button" className="ibtn sm" aria-label={kind === 'event' ? 'All day' : 'Remove time'} title={kind === 'event' ? 'All day' : 'Remove time'}
                  onClick={() => {
                    // An event keeps its days (SV-29).
                    change({start: null, end: null, days: extraDays(draft.start, draft.end, 1) + 1}, ['time']);
                    // The fields it was beside go: the editor keeps focus, for ⌘Enter and Esc.
                    form.current?.focus();
                  }}><Icon name="close" size={16} /></button>
              </>
            ) : (
              <button type="button" className="btn quiet sm" onClick={() => change({start: DEFAULT_START, end: kind === 'event' ? (draft.days - 1) * 1440 + DEFAULT_START + DEFAULT_LENGTH : null, days: 1}, ['time'])}>
                {kind === 'event' ? 'All day · Add a time' : 'Add a time'}
              </button>
            )}
            {mark('date', 'time')}
          </div>
          {was && (
            <>
              <span />
              <div className="ink3 num was">{was}</div>
            </>
          )}

          {kind === 'event' && editing && <RepeatRow draft={draft} open={menu === 'repeat'} menuRef={menuRef} onToggle={() => setMenu(menu === 'repeat' ? null : 'repeat')} onPick={recurrence => {
            change({recurrence}, ['recurrence']);
            setMenu(null);
          }} />}
          {kind === 'task' && (
            <>
              <Icon name="repeat" size={17} />
              <span className="menu-host">
                <button type="button" className="field" aria-label="Repeat" aria-expanded={menu === 'repeat'} onClick={() => setMenu(menu === 'repeat' ? null : 'repeat')}>
                  <span className="grow left">{describeTaskRepeat(draft.repeat)}</span>
                  <span className="ink3"><Icon name="expand_more" size={16} /></span>
                </button>
                {menu === 'repeat' && (
                  <div ref={menuRef} className="pop menu" role="menu">
                    {taskRepeatChoices(draft.date, draft.repeat).map(choice => (
                      <button key={choice.repeat ?? 'none'} type="button" role="menuitemradio" aria-checked={choice.repeat === draft.repeat} className="menu-i" onClick={() => {
                        change({repeat: choice.repeat}, ['recurrence']);
                        setMenu(null);
                      }}>{choice.label}{choice.repeat === draft.repeat && <Icon name="check" size={16} />}</button>
                    ))}
                  </div>
                )}
              </span>
            </>
          )}

          {kind === 'event' && (
            <>
              <Icon name="location_on" size={17} className={echo.place} />
              <label className={`field${placeMenuShown ? ' focus' : ''}`}>
                <input className="grow" aria-label="Place" placeholder="Add place" value={draft.place} onFocus={() => setPlaceAsked(true)}
                  onChange={event => change({place: event.target.value, address: null, picked: null}, ['place'])} />
                {mark('place')}
                {draft.place && (
                  <button type="button" className="ibtn sm clear" aria-label="Clear place" onMouseDown={event => event.preventDefault()} onClick={() => change({place: '', address: null, picked: null}, ['place'])}>
                    <Icon name="close" size={16} />
                  </button>
                )}
              </label>
              {draft.address && (
                <>
                  <span />
                  <span className={`ell ink3 place-address${flashAddress ? ' flash' : ''}`}>{draft.address}</span>
                </>
              )}
              {placeMenuShown && (
                <>
                  <span />
                  <PlaceList places={placeMenuShown.list} cur={placeMenuShown.cur} query={placeMenuShown.query} onPick={pick} />
                </>
              )}
            </>
          )}

          {kind === 'event' ? (
            <>
              <Icon name="calendar_today" size={17} className={echo.calendar} style={{'--c': colourVar(calendar?.colour ?? undefined)} as CSSProperties} />
              <span className="menu-host">
                <button type="button" className="field" aria-label="Calendar" aria-expanded={menu === 'calendar'}
                  onClick={() => setMenu(menu === 'calendar' ? null : 'calendar')}>
                  <span className="dot sm" style={{'--c': colourVar(calendar?.colour ?? undefined)} as CSSProperties} />
                  <span className="grow left">{calendar?.name ?? 'Calendar'}</span>
                  <span className="ink3"><Icon name="expand_more" size={16} /></span>
                </button>
                {lineOpen && menu !== 'calendar' && (
                  <div ref={placeMenu} className="pop menu" role="listbox" aria-label="Calendars">
                    {calendarLine.map((one, index) => (
                      <div key={one.id} role="option" aria-selected={index === lineCur} className={`menu-i${index === lineCur ? ' cur' : ''}`}
                        onMouseDown={event => event.preventDefault()} onClick={() => pickLine(index)}>
                        <span className="dot sm" style={{'--c': colourVar(one.colour ?? undefined)} as CSSProperties} />{one.name}
                        {index === lineCur && <span className="kbd">↵</span>}
                      </div>
                    ))}
                  </div>
                )}
                {menu === 'calendar' && (
                  <div ref={menuRef} className="pop menu" role="menu">
                    {calendarChoices.map(one => (
                      <button key={one.id} type="button" role="menuitemradio" aria-checked={one.id === draft.calendarId} className="menu-i" onClick={() => {
                        change({calendarId: one.id}, ['calendar']);
                        setMenu(null);
                      }}>
                        <span className="dot sm" style={{'--c': colourVar(one.colour ?? undefined)} as CSSProperties} />{one.name}
                        {one.id === draft.calendarId && <Icon name="check" size={16} />}
                      </button>
                    ))}
                  </div>
                )}
              </span>
            </>
          ) : (
            <>
              <Icon name="work" size={17} className={echo.project} style={projectTodoist ? {'--c': TODOIST_COLOURS[projectTodoist]} as CSSProperties : undefined} />
              <ProjectField value={draft.project ?? ''} isNew={draft.newProject} projects={projects ?? []} noNew={!!editing}
                placeholder={settings?.todoist.default_project ?? projects?.find(one => one.inbox)?.name ?? 'Inbox'}
                line={lineOpen ? {cur: lineCur} : null}
                onText={text => change({project: text || null, newProject: false, pickedProject: null}, ['project'])}
                onPick={(name, isNew) => (lineOpen
                  ? completeLine(lineMark!, name, {project: name, newProject: isNew, pickedProject: name})
                  : change({project: name, newProject: isNew, pickedProject: null}, ['project']))} />
              {projectProblem && !lineOpen && (
                <>
                  <span />
                  <span className="ink3 field-note">{projectProblem}</span>
                </>
              )}
              <Icon name="alternate_email" size={17} />
              <div className="prow" aria-label="Labels">
                {draft.labels.map(label => (
                  <span key={label} className="qchip">
                    {label}
                    <button type="button" className="x" aria-label={`Remove label ${label}`} onClick={() => change({labels: draft.labels.filter(one => one !== label)}, ['labels'])}><Icon name="close" size={14} /></button>
                  </span>
                ))}
                {!draft.labels.length && <span className="ink3 none">No labels</span>}
                {unpicked.length > 0 && <span className="menu-host">
                  <button type="button" className="ibtn sm" aria-label="Add label" aria-expanded={menu === 'labels'} onClick={() => setMenu(menu === 'labels' ? null : 'labels')}><Icon name="add" size={16} /></button>
                  {menu === 'labels' && (
                    <div ref={menuRef} className="pop menu" role="menu">
                      {unpicked.map(label => (
                        <button key={label.id} type="button" role="menuitem" className="menu-i" onClick={() => {
                          change({labels: [...draft.labels, label.name]}, ['labels']);
                          setMenu(null);
                        }}>{label.name}</button>
                      ))}
                    </div>
                  )}
                </span>}
              </div>
            </>
          )}

          {kind === 'event' && (
            <>
              <Icon name="notifications" size={17} />
              <div className="prow">
                {draft.reminders.map(minutes => (
                  <span key={minutes} className="qchip">
                    <span className="num">{remindersLine([minutes])}</span>
                    <button type="button" className="x" aria-label="Remove reminder" onClick={() => change({reminders: draft.reminders.filter(one => one !== minutes)})}><Icon name="close" size={14} /></button>
                  </span>
                ))}
                {draft.leaveReminder && (
                  <span className="qchip ttl" title={leaveTitle}>
                    <Icon name="directions_car" size={14} />Time to Leave
                    <button type="button" className="x" aria-label="Remove Time to Leave" onClick={() => change({leaveReminder: false})}><Icon name="close" size={14} /></button>
                  </span>
                )}
                <span className="menu-host">
                  <button type="button" className="ibtn sm" aria-label="Add reminder" aria-expanded={menu === 'reminder'} onClick={() => setMenu(menu === 'reminder' ? null : 'reminder')}><Icon name="add" size={16} /></button>
                  {menu === 'reminder' && (
                    <div ref={menuRef} className="pop menu" role="menu">
                      {REMINDER_CHOICES.filter(minutes => !draft.reminders.includes(minutes)).map(minutes => (
                        <button key={minutes} type="button" role="menuitem" className="menu-i" onClick={() => {
                          change({reminders: [...draft.reminders, minutes].sort((a, b) => a - b)});
                          setMenu(null);
                        }}>{remindersLine([minutes])}</button>
                      ))}
                      {/* SV-31: an event with a time and a place can have Time to Leave, with Settings' buffer, while Settings has it on. */}
                      {!draft.leaveReminder && draft.start !== null && draft.place.trim() && settings?.time_to_leave.enabled && (
                        <button type="button" role="menuitem" className="menu-i" onClick={() => {
                          change({leaveReminder: true});
                          setMenu(null);
                        }}><Icon name="directions_car" size={16} />Time to Leave{' '}<span className="ink3 num">{settings.time_to_leave.buffer_minutes} min buffer</span></button>
                      )}
                    </div>
                  )}
                </span>
              </div>
            </>
          )}

          {kind === 'event' && !editing && <RepeatRow draft={draft} open={menu === 'repeat'} menuRef={menuRef} onToggle={() => setMenu(menu === 'repeat' ? null : 'repeat')} onPick={recurrence => {
            change({recurrence}, ['recurrence']);
            setMenu(null);
          }} />}
        </div>

        {/* An empty new draft has nothing to conflict yet: the preview waits for a title or a time. */}
        {kind === 'event' && draft.start !== null && lastDay === draft.date && (editing || draft.text.trim() !== '' || draft.title.trim() !== '' || draft.manual.includes('time')) && (
          <ConflictPreview draft={draft} items={dayItems(draft.date)} except={editing?.key ?? null} title={draft.title || draft.text} colour={calendar?.colour ?? null}
            calendarColour={id => (calendars ?? []).find(one => one.id === id)?.colour ?? null} isNew={!editing} timeZone={timeZone} />
        )}

        {!editing && (
          <div className="batch">
            {drafts.filter(one => one.id !== draft.id).map(one => (
              <div key={one.id} className="drafted-row">
                <button type="button" className="field drafted" aria-label={`Expand draft: ${one.text}`} onClick={() => setActive(one.id)}>
                  <span className="dot sm" style={{'--c': colourVar((calendars ?? []).find(cal => cal.id === one.calendarId)?.colour ?? undefined)} as CSSProperties} />
                  <span className="grow ell left"><Marked text={one.text} marks={parseTitle(one.text, today, google.map(cal => cal.name)).marks.filter(mark => mark.kind === 'when')} /></span>
                  <span className="ink3 num when">{dayTitle(one.date)}{one.start !== null ? ` · ${clockLabel(one.start)}` : ''}</span>
                  <span className="ink3"><Icon name="expand_more" size={16} /></span>
                </button>
                <button type="button" className="ibtn sm" aria-label={`Remove draft: ${one.text}`} title="Remove draft" onClick={() => removeDraft(one.id)}><Icon name="close" size={16} /></button>
              </div>
            ))}
            <button type="button" className="btn quiet sm another" onClick={() => addAnother()}><Icon name="add" size={17} />Add another</button>
          </div>
        )}
      </div>

      {asking && editing ? (
        <div className="pop scope-pop">
          <ScopePrompt title={`Change recurring ${noun}`} choices={choices} value={scope} action="Save" onChange={setScope}
            onConfirm={submit} onCancel={() => setAsking(false)} />
        </div>
      ) : (
        <div className="ed-foot">
          <button type="submit" className="btn" disabled={editing ? !!projectProblem : ready.length !== drafts.length}>
            {editing ? 'Save' : drafts.length > 1 ? `Create ${drafts.length} ${noun}s` : `Create ${noun}`}<span className="kbd">⌘Enter</span>
          </button>
          <button type="button" className="btn quiet" onClick={onClose}>Cancel<span className="kbd">Esc</span></button>
          {draft.fromEmail.length > 0 && <span className="legend" title="From the email"><Icon name="mail" size={14} /><span>From the email</span></span>}
        </div>
      )}
    </form>
  );
}

function RepeatRow({draft, open, menuRef, onToggle, onPick}: {draft: Draft; open: boolean; menuRef: (menu: HTMLElement | null) => void; onToggle: () => void; onPick: (rule: string | null) => void}) {
  return (
    <>
      <Icon name="repeat" size={17} />
      <span className="menu-host">
        <button type="button" className="field" aria-label="Repeat" aria-expanded={open} onClick={onToggle}>
          <span className="grow left">{describeRule(draft.recurrence, draft.date)}</span>
          <span className="ink3"><Icon name="expand_more" size={16} /></span>
        </button>
        {open && (
          <div ref={menuRef} className="pop menu" role="menu">
            {repeatChoices(draft.date, draft.recurrence).map(choice => (
              <button key={choice.rule ?? 'none'} type="button" role="menuitemradio" aria-checked={choice.rule === draft.recurrence} className="menu-i" onClick={() => onPick(choice.rule)}>
                {choice.label}{choice.rule === draft.recurrence && <Icon name="check" size={16} />}
              </button>
            ))}
          </div>
        )}
      </span>
    </>
  );
}

/**
 * Places under the place (board 13): the name with what was typed in bold, the address, ↵ on the one
 * Enter picks. The proposal card's floats under its field as a menu (SV-71).
 */
export function PlaceList({places, cur, query, floating = false, onPick}: {places: PlaceSuggestionOut[]; cur: number; query: string; floating?: boolean; onPick: (place: PlaceSuggestionOut) => void}) {
  return (
    <div className={`pop places${floating ? ' menu' : ''}`} role="listbox" aria-label="Places">
      {places.map((place, index) => {
        const at = place.name.toLowerCase().indexOf(query.toLowerCase());
        const name = at < 0 ? place.name : <>{place.name.slice(0, at)}<b>{place.name.slice(at, at + query.length)}</b>{place.name.slice(at + query.length)}</>;
        return (
          <div key={place.place_id || place.name} className={`menu-i place${index === cur ? ' cur' : ''}`} role="option" aria-selected={index === cur}
            onMouseDown={event => event.preventDefault()} onClick={() => onPick(place)}>
            <Icon name="location_on" />
            <span className="grow place-text"><span className="ell place-name">{name}</span>{place.address && <span className="ell ink3 place-address">{place.address}</span>}</span>
            {index === cur && <span className="kbd">↵</span>}
          </div>
        );
      })}
    </div>
  );
}

// ---------- The conflict preview ----------

/** "6:30 – 8:30", "7 – 9": a block's times on the timeline. */
const short = (minutes: number) => clockLabel(minutes).replace(/ (AM|PM)$/, '').replace(/:00$/, '');

interface ConflictPreviewProps {
  draft: Draft;
  items: ItemOut[];
  except: string | null;
  title: string;
  colour: Colour | null;
  calendarColour: (calendarId: number) => Colour | null;
  isNew: boolean;
  timeZone: string;
}

/**
 * A small timeline of the day (boards 13 and 14): what the event overlaps in one lane, the event
 * (dashed while new) in the next, the shared time hatched in `caution`, and the line under it.
 */
function ConflictPreview({draft, items, except, title, colour, calendarColour, isNew, timeZone}: ConflictPreviewProps) {
  const start = draft.start!;
  const end = draft.end ?? start + DEFAULT_LENGTH;
  const span = {start: Date.parse(instantAt(draft.date, start, timeZone)), end: Date.parse(instantAt(draft.date, end, timeZone))};
  const overlaps = overlapsWith(span, items.filter(item => item.id > 0), except);
  const inMinutes = (at: number) => minutesFrom(draft.date, at, timeZone);
  const others = overlaps.map(overlap => ({
    item: overlap.item, start: inMinutes(Date.parse(overlap.item.starts_at!)), end: inMinutes(Date.parse(overlap.item.ends_at!)),
    shared: {start: inMinutes(overlap.start), end: inMinutes(overlap.end)},
  }));
  const window = timelineWindow([{start, end}, ...others]);
  const x = (minutes: number) => `${((Math.max(window.from, Math.min(window.to, minutes)) - window.from) / (window.to - window.from)) * 100}%`;
  const width = (from: number, to: number) => `${((Math.min(window.to, to) - Math.max(window.from, from)) / (window.to - window.from)) * 100}%`;
  const label = (name: string, from: number, to: number) => (to - from >= 90 ? `${name} · ${short(from)} – ${short(to)}` : name);
  const verdict = conflictLine(overlaps);
  const lines = timelineLabels(window);
  return (
    <div className="conflict">
      <div className="flabel">{dayTitle(draft.date)}</div>
      <div className={`tl${others.length ? ' two' : ''}`} aria-label={`Conflict preview, ${lines[0]!.label} to ${lines.at(-1)!.label}`}>
        {lines.slice(1, -1).map(hour => <span key={hour.at} className="hr" style={{left: `${hour.at * 100}%`}} />)}
        {others.map(other => <span key={`hatch-${other.item.key}`} className="hatch" style={{left: x(other.shared.start), width: width(other.shared.start, other.shared.end)}} />)}
        {others.map(other => (
          <span key={other.item.key} className="bk other" style={{left: x(other.start), width: width(other.start, other.end), '--c': colourVar(other.item.colour ?? calendarColour(other.item.calendar_id) ?? undefined)} as CSSProperties}>{label(other.item.title, other.start, other.end)}</span>
        ))}
        <span className={`bk self${isNew ? ' new' : ''}`} style={{left: x(start), width: width(start, end), '--c': colourVar(colour ?? undefined)} as CSSProperties}>
          {label(title, start, end)}
        </span>
      </div>
      <div className="tlx num" aria-hidden="true">
        {lines.map((hour, index) => (
          <span key={hour.at} style={index === 0 ? {left: 0, transform: 'none'} : index === lines.length - 1 ? {right: 0, transform: 'none'} : {left: `${hour.at * 100}%`}}>{hour.label}</span>
        ))}
      </div>
      <div className={`verdict${verdict.free ? ' free' : ''}`}><Icon name={verdict.free ? 'check_circle' : 'warning'} size={16} />{verdict.text}</div>
    </div>
  );
}
