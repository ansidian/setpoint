// Calendar items, calendars, weather and Places (BRIEF.md › Calendar; DESIGN.md › Calendar).
//
//   GET    /api/items?from=2026-10-01&to=2026-11-01   ItemsOut (occurrences expanded; `to` exclusive)
//   GET    /api/items/:id                              ItemOut (the item itself, not an occurrence)
//   POST   /api/items                  ItemCreateInput       CommandOut
//   PATCH  /api/items/:id              ItemUpdateInput       CommandOut
//   POST   /api/items/:id/delete       ItemScopeInput        CommandOut
//   POST   /api/items/:id/complete     ItemCompleteInput     CommandOut
//   GET    /api/calendars                                     CalendarOut[]
//   PATCH  /api/calendars/:id          CalendarUpdateInput   CalendarOut (a colour change is a command: `command` says how it went)
//   GET    /api/weather?from=&to=                             WeatherDayOut[]
//   GET    /api/places?query=&session_token=                  PlaceSuggestionOut[] (B5)
//   GET    /api/places/recent                                 RecentPlaceOut[] (SV-71: what "@" offers before typing)
//   GET    /api/places/:place_id?session_token=               PlaceOut (F7: Settings › Calendar's Home, with its coordinates)
//   GET    /api/todoist/projects                              TodoistProjectOut[] (B5)
//   PATCH  /api/todoist/projects/:id   TodoistProjectUpdateInput TodoistProjectOut (SV-25: a colour, a command to Todoist)
//   GET    /api/todoist/labels                                TodoistLabelOut[] (F6b)
//   POST   /api/todoist/connect                               TodoistConnectOut: Todoist's consent page (B5)
//   GET    /api/ea/accounts/todoist/callback?code=&state=     Todoist's redirect back (no session; the state is)
//   POST   /api/calendar/push                                 Google Calendar's watch notifications (no session)
import {z} from 'zod';
import {CALENDAR_PROVIDERS, COLOURS, EVENT_COLOURS, ITEM_KINDS, RECURRING_SCOPES} from '../enums.ts';
import type {CalendarProvider, Colour, ItemKind, WeatherCondition} from '../enums.ts';
import {id, instant, localDate} from './common.ts';
import type {CommandOut, ItemWhen} from './common.ts';

/**
 * One item on the calendar, or one occurrence of a recurring one. `key` is unique in a range read
 * ("12" or "3@2026-10-07T14:00:00.000Z"); `occurrence_start` names the occurrence for a change with
 * a recurring scope.
 */
export interface ItemOut extends ItemWhen {
  key: string;
  id: number;
  calendar_id: number;
  kind: ItemKind;
  title: string;
  time_zone: string | null;
  recurring: boolean;
  recurrence: string | null;
  occurrence_start: string | null;
  place: string | null;
  address: string | null;
  attendees: string[];
  // Minutes before the start.
  reminders: number[];
  // SV-31: Time to Leave for this event, added among its notifications; never by default.
  leave_reminder: boolean;
  // A task's Todoist project.
  project: string | null;
  done: boolean;
  done_at: string | null;
  command: CommandOut | null;
  // Google's own kinds of event (birthdays, focus time, out of office): shown, never changed here.
  read_only: boolean;
  // A Todoist task's due as Todoist words it ("every mon"); `recurring` is true for a repeating task.
  due_string: string | null;
  // "Leave by 2:05 PM · 18 min": from Home by live routes, with Settings' buffer, when the event has
  // Time to Leave (`leave_reminder`) and there is one.
  time_to_leave: TimeToLeaveOut | null;
  // F6: an event's own colour (Google's event colour, as a swatch); null takes its calendar's.
  colour: Colour | null;
  // F6b: a task's Todoist labels, by name. Events have none.
  labels: string[];
  // F6b: a repeating task's repeat in Todoist's words ("every mon"), without its time or start.
  repeat: string | null;
}

/** Time to Leave for one occurrence (DESIGN.md › Right pane). */
export interface TimeToLeaveOut {
  leave_at: string;
  travel_minutes: number;
  checked_at: string;
}

export const itemsRangeInput = z.strictObject({from: localDate, to: localDate}).refine(range => range.from < range.to, 'from must be before to');
export interface ItemsOut {
  from: string;
  to: string;
  items: ItemOut[];
}

const rrule = z.string().regex(/^RRULE:[A-Z0-9=;,:+-]+$/, 'An RFC 5545 rule such as RRULE:FREQ=WEEKLY;BYDAY=MO');
const when = {
  all_day: z.boolean(),
  starts_at: instant.nullable(),
  ends_at: instant.nullable(),
  start_date: localDate.nullable(),
  end_date: localDate.nullable(),
  due_date: localDate.nullable(),
  due_at: instant.nullable(),
};
const editable = {
  calendar_id: id,
  title: z.string().trim().min(1).max(500),
  ...when,
  time_zone: z.string().min(1).max(64).nullable(),
  recurrence: rrule.nullable(),
  place: z.string().max(300).nullable(),
  address: z.string().max(500).nullable(),
  attendees: z.array(z.string().min(1).max(200)).max(100),
  reminders: z.array(z.int().min(0).max(40_320)).max(10),
  // SV-31: an event's Time to Leave, sent while Settings › Notifications has it on. Tasks have none.
  leave_reminder: z.boolean(),
  project: z.string().min(1).max(200).nullable(),
  // F6: an event's own colour; null takes its calendar's. Tasks have none.
  colour: z.enum(EVENT_COLOURS).nullable(),
  // F6b: a task's Todoist labels, by name (Todoist's own key for them). Events have none.
  labels: z.array(z.string().trim().min(1).max(60)).max(50),
  // F6b: a task's repeat in Todoist's words ("every mon"); null for none. Sent to Todoist with the
  // due day and time as one due string, so a date change never drops the repeat.
  repeat: z.string().trim().min(1).max(100).nullable(),
};

/** Whether the time fields fit the kind: a timed event, an all-day event, or a task's due day (or none, SV-74). */
export function whenProblem(item: {kind: ItemKind} & Partial<ItemWhen>): string | null {
  if (item.kind === 'task') {
    if (!item.due_date && item.due_at) return 'A task\'s time needs a due date.';
    if (item.starts_at || item.start_date) return 'A task has a due date, not a start.';
    return null;
  }
  if (item.due_date || item.due_at) return 'An event has a start, not a due date.';
  if (item.all_day) {
    if (!item.start_date || !item.end_date) return 'An all-day event needs a start and end date.';
    if (item.end_date <= item.start_date) return 'An all-day event ends after it starts (the end date is exclusive).';
    return null;
  }
  if (!item.starts_at || !item.ends_at) return 'An event needs a start and an end.';
  if (Date.parse(item.ends_at) < Date.parse(item.starts_at)) return 'An event can\'t end before it starts.';
  return null;
}

export const itemCreateInput = z.strictObject({
  kind: z.enum(ITEM_KINDS),
  ...editable,
  all_day: when.all_day.default(false),
  starts_at: when.starts_at.default(null),
  ends_at: when.ends_at.default(null),
  start_date: when.start_date.default(null),
  end_date: when.end_date.default(null),
  due_date: when.due_date.default(null),
  due_at: when.due_at.default(null),
  time_zone: editable.time_zone.default(null),
  recurrence: editable.recurrence.default(null),
  place: editable.place.default(null),
  address: editable.address.default(null),
  attendees: editable.attendees.default([]),
  // Omitted: Settings › Notifications' default for events (None unless set, D49).
  reminders: editable.reminders.optional(),
  // Never on unless asked for (SV-31).
  leave_reminder: editable.leave_reminder.default(false),
  project: editable.project.default(null),
  // A task's project that Todoist doesn't have yet is made only when this says so: the user picked "New
  // project" (SV-24, D50); otherwise an unknown name goes to the default project.
  create_project: z.boolean().optional(),
  colour: editable.colour.default(null),
  labels: editable.labels.default([]),
  repeat: editable.repeat.default(null),
}).superRefine((item, context) => {
  const problem = whenProblem(item);
  if (problem) context.addIssue({code: 'custom', message: problem});
});
export type ItemCreateInput = z.infer<typeof itemCreateInput>;

/**
 * A change to an item. For an occurrence of a recurring event, `occurrence_start` names it and
 * `scope` says which occurrences change: This event (the default), This and following, or All.
 */
export const itemUpdateInput = z.strictObject({
  changes: z.strictObject(editable).partial().refine(changes => Object.keys(changes).length > 0, 'Nothing to change'),
  scope: z.enum(RECURRING_SCOPES).default('this'),
  occurrence_start: instant.nullable().default(null),
});
export type ItemUpdateInput = z.infer<typeof itemUpdateInput>;
export type ItemChanges = ItemUpdateInput['changes'];

export const itemScopeInput = z.strictObject({
  scope: z.enum(RECURRING_SCOPES).default('this'),
  occurrence_start: instant.nullable().default(null),
});
export type ItemScopeInput = z.infer<typeof itemScopeInput>;

/** Complete or reopen a task; a recurring task names its occurrence by its due date. */
export const itemCompleteInput = z.strictObject({done: z.boolean(), occurrence_date: localDate.nullable().default(null)});

/** Each Google calendar, and Todoist as one more toggle (DESIGN.md › Sidebar on Calendar). */
export interface CalendarOut {
  id: number;
  provider: CalendarProvider;
  account_id: number | null;
  name: string;
  // Null for Todoist, which shows its ring glyph.
  colour: Colour | null;
  position: number;
  visible: boolean;
  // SV-20: the colour change waiting for Google, or failed in place with its words; null otherwise.
  command: CommandOut | null;
}
export const calendarProviderSchema = z.enum(CALENDAR_PROVIDERS);
/** Show or hide a calendar (Setpoint's own setting), and SV-20: pick a Google calendar's colour, written to Google. */
export const calendarUpdateInput = z.strictObject({visible: z.boolean().optional(), colour: z.enum(COLOURS).optional()})
  .refine(input => input.visible !== undefined || input.colour !== undefined, 'Nothing to change.');
export type CalendarUpdateInput = z.infer<typeof calendarUpdateInput>;

export interface WeatherDayOut {
  date: string;
  condition: WeatherCondition;
  high_f: number;
  low_f: number;
}
export const weatherRangeInput = z.strictObject({from: localDate, to: localDate});

/** Places autocomplete, with Google's session token kept across one editing session. */
export const placesInput = z.strictObject({query: z.string().trim().min(1).max(200), session_token: z.string().min(8).max(64)});
export interface PlaceSuggestionOut {
  place_id: string;
  name: string;
  address: string;
}

/** SV-71: a place the user's events have used, offered before anything is typed; its address when one had it. */
export interface RecentPlaceOut {
  name: string;
  address: string | null;
}

/** F7: one place with where it is, for Home (Time to Leave's routes and the forecast need its coordinates). */
export const placeInput = z.strictObject({session_token: z.string().min(8).max(64).optional()});
export interface PlaceOut extends PlaceSuggestionOut {
  lat: number;
  lng: number;
}

/**
 * Todoist's own project colours, by the names its API uses, with its hex values
 * (developer.todoist.com/api/v1 › Colors). A task's ring takes its project's (SV-25, D54).
 */
export const TODOIST_COLOURS = {
  berry_red: '#b8255f', red: '#dc4c3e', orange: '#c77100', yellow: '#b29104', olive_green: '#949c31',
  lime_green: '#65a33a', green: '#369307', mint_green: '#42a393', teal: '#148fad', sky_blue: '#319dc0',
  light_blue: '#6988a4', blue: '#4180ff', grape: '#692ec2', violet: '#ca3fee', lavender: '#a4698c',
  magenta: '#e05095', salmon: '#c9766f', charcoal: '#808080', grey: '#999999', taupe: '#8f7a69',
} as const;
export type TodoistColour = keyof typeof TODOIST_COLOURS;
export const TODOIST_COLOUR_NAMES = Object.keys(TODOIST_COLOURS) as [TodoistColour, ...TodoistColour[]];
export const isTodoistColour = (name: unknown): name is TodoistColour => typeof name === 'string' && Object.hasOwn(TODOIST_COLOURS, name);

/** A Todoist project, for a task's project picker (Settings › Todoist's default project too), with its colour. */
export interface TodoistProjectOut {
  id: string;
  name: string;
  inbox: boolean;
  // Null when Todoist named a colour Setpoint doesn't know.
  colour: TodoistColour | null;
  // SV-25: the colour change waiting for Todoist, or failed in place with its words; null otherwise.
  command: CommandOut | null;
}
/** SV-25: pick a project's colour, written to Todoist. */
export const todoistProjectUpdateInput = z.strictObject({colour: z.enum(TODOIST_COLOUR_NAMES)});
export type TodoistProjectUpdateInput = z.infer<typeof todoistProjectUpdateInput>;

/** A Todoist label, for a task's labels picker (F6b). */
export interface TodoistLabelOut {
  id: string;
  name: string;
}

/** Connect Todoist: the web app sends the browser to `url`; Todoist comes back to the callback. */
export interface TodoistConnectOut {
  url: string;
}
