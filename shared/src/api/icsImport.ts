// SV-181: an .ics file's events into one of the user's Google calendars (D436, D437), reviewed first.
//
//   POST /api/calendar/import/read     the file's bytes (text/calendar)   IcsReadOut
//   POST /api/calendar/import          IcsImportInput                     CommandOut
//
// The read sends nothing to Google: it answers the file's events as drafts, in start order, each
// with the calendars that already hold its iCalUID, or refuses the file with one line (400). The
// import writes one event through Google's events.import, as a command of its own: `item_create`
// for an event new to the calendar, `item_update` for one it already holds (Google updates it in
// place). The web app sends them one at a time, waiting for each to settle; SV-182's Add to calendar
// on an email's .ics reads the attachment into the same IcsReadOut and imports the same way.
import {z} from 'zod';
import {EVENT_COLOURS, TRANSPARENCIES} from '../enums.ts';
import type {IcsDropReason, Transparency} from '../enums.ts';
import {id, instant, localDate} from './common.ts';
import {REMINDER_LIMIT_MINUTES, whenProblem} from './items.ts';

/** What an imported event (or one changed occurrence of it) carries to Google. */
export interface IcsFieldsOut {
  // '' when the file gives none: Google shows "(No title)".
  title: string;
  all_day: boolean;
  starts_at: string | null;
  ends_at: string | null;
  start_date: string | null;
  end_date: string | null;
  // The file's IANA zone; null takes the user's.
  time_zone: string | null;
  // The file's LOCATION, as the mirror splits Google's (a place, then its address).
  place: string | null;
  address: string | null;
  // Google's description and `source.url`, never shown in Setpoint (D438).
  description: string | null;
  url: string | null;
  transparency: Transparency;
  // Minutes before the start: the file's own alarms only, never Settings' default (D438).
  reminders: number[];
}

/** One changed occurrence of a repeating event (RECURRENCE-ID), by the start it replaces. */
export interface IcsChangeOut extends IcsFieldsOut {
  original_start_at: string | null;
  original_start_date: string | null;
}

export interface IcsEventOut extends IcsFieldsOut {
  ical_uid: string;
  sequence: number;
  // RFC 5545 lines as Google takes them: RRULE, then EXDATE and RDATE. Empty for a single event.
  recurrence: string[];
  changes: IcsChangeOut[];
  // Ended before now (a repeating one, its last occurrence): the review leaves it unticked.
  past: boolean;
  // The Google calendars that already hold its iCalUID: importing it there updates that event.
  existing: number[];
}

export interface IcsReadOut {
  events: IcsEventOut[];
  // How many of each the file had that an import leaves out (every reason, 0 when none).
  dropped: Record<IcsDropReason, number>;
}

const fields = {
  title: z.string().trim().max(500),
  all_day: z.boolean(),
  starts_at: instant.nullable(),
  ends_at: instant.nullable(),
  start_date: localDate.nullable(),
  end_date: localDate.nullable(),
  time_zone: z.string().min(1).max(64).nullable(),
  place: z.string().max(300).nullable(),
  address: z.string().max(500).nullable(),
  description: z.string().max(65_536).nullable(),
  url: z.url({protocol: /^https?$/}).max(2048).nullable(),
  transparency: z.enum(TRANSPARENCIES),
  // Google keeps 5 reminders, up to 4 weeks before.
  reminders: z.array(z.int().min(0).max(REMINDER_LIMIT_MINUTES)).max(5),
};
const timed = (value: {kind?: 'event'; all_day: boolean; starts_at: string | null; ends_at: string | null; start_date: string | null; end_date: string | null}) =>
  whenProblem({kind: 'event', ...value, due_date: null, due_at: null});

const change = z.strictObject({...fields, original_start_at: instant.nullable(), original_start_date: localDate.nullable()})
  .refine(one => (one.original_start_at === null) !== (one.original_start_date === null), 'A changed occurrence names the start it replaces.')
  .superRefine((one, context) => {
    const problem = timed(one);
    if (problem) context.addIssue({code: 'custom', message: problem});
  });

export const icsImportInput = z.strictObject({
  calendar_id: id,
  event: z.strictObject({
    ...fields,
    ical_uid: z.string().min(1).max(1024),
    sequence: z.int().min(0).default(0),
    recurrence: z.array(z.string().regex(/^(RRULE|EXRULE|EXDATE|RDATE)[:;]/, 'An RRULE, EXDATE or RDATE line').max(4096)).max(100),
    changes: z.array(change).max(1000),
    // The editor's own (one event opened as a draft): its colour and Time to Leave.
    colour: z.enum(EVENT_COLOURS).nullable().default(null),
    leave_reminder: z.boolean().default(false),
  }).superRefine((one, context) => {
    const problem = timed(one);
    if (problem) context.addIssue({code: 'custom', message: problem});
  }),
});
export type IcsImportInput = z.infer<typeof icsImportInput>;
export type IcsImportEvent = IcsImportInput['event'];
