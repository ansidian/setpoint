// SV-95: the title line's parser for the iPhone app (setpoint-ios), which runs it in JavaScriptCore
// so the same words parse the same way on both clients (darma SI-10, D8). Built into
// shared/compose/compose.js, a global `SetpointCompose` with no module loader and no DOM, by
// web/tests/composeBundle.test.ts (`npm run compose:record`), which also records
// shared/compose/cases.json; `npm test` fails when either is stale against compose.ts.
//
// Each function takes one plain-JSON object and returns plain JSON, and `call` does the same with
// JSON text, for Swift's Codable. Offsets (`start`, `end`, a mark's) are UTF-16 code units.
import {bareToken as bare, completeToken as complete, editedWhen as whenEdited, lineWithTitle as withTitle, parseTitle as parse, typedSpan as span} from './compose.ts';
import type {Mark, ParsedTitle, When} from './compose.ts';

export interface ParseTitleInput {
  text: string;
  kind: 'event' | 'task';
  // The local day, "2026-10-07".
  today: string;
  // The Google calendars' names, in the list's order: "cal …", and "#…" for an event.
  calendars: string[];
  // Todoist's projects' names, in the list's order: "#…" for a task.
  projects: string[];
  // The place text a Places suggestion was picked for, where "@…" stops.
  pickedPlace?: string | null;
  // The text a "#" menu pick was made for (a project for a task, a calendar for an event).
  pickedHash?: string | null;
  // Editing an item (SV-90): its title before the edit and its day, "2026-10-14". Only what the
  // edit typed is read, and a repeat with no day counts from the item's day.
  edit?: {before: string; day: string} | null;
}

/** The line as the web's editor reads it: "#…" is a task's project or an event's calendar. */
export function parseTitle(input: ParseTitleInput): ParsedTitle {
  const names = input.kind === 'task' ? input.projects : input.calendars;
  return parse(input.text, input.today, input.calendars, input.pickedPlace ?? null,
    {kind: input.kind === 'task' ? 'project' : 'calendar', names, picked: input.pickedHash ?? null}, input.edit ?? null);
}

/** What an edit typed into a title: the text from `start` to `end` of `after`. */
export function typedSpan(input: {before: string; after: string}): {start: number; end: number} {
  return span(input.before, input.after);
}

/** An edited item's when once its typed day and time are read (its `date`, `start`, `end` from parseTitle). */
export function editedWhen(input: {item: When; read: {date: string | null; start: number | null; end: number | null}; kind: 'event' | 'task'}): When {
  return whenEdited(input.item, input.read, input.kind);
}

/** A "#" or "@" just typed at the line's end, which opens its menu; null when there's none. */
export function bareToken(input: {text: string; trigger: '#' | '@'}): {start: number; query: string} | null {
  return bare(input.text, input.trigger);
}

/** The line once a menu pick is made for the "@" or "#" mark from `start` to `end`. */
export function completeToken(input: {text: string; start: number; end: number; name: string}): {text: string; caret: number} {
  return complete(input.text, input.start, input.end, input.name);
}

/** The line with its title words replaced by a Title typed by hand, its marked phrases after it. */
export function lineWithTitle(input: {text: string; marks: Mark[]; title: string}): string {
  return withTitle(input.text, input.marks, input.title);
}

const FUNCTIONS = {parseTitle, bareToken, completeToken, lineWithTitle, typedSpan, editedWhen} as const;

/** `call("parseTitle", '{"text":…}')` → the result as JSON text. */
export function call(name: keyof typeof FUNCTIONS, json: string): string {
  const run = FUNCTIONS[name] as (input: unknown) => unknown;
  if (!run) throw new Error(`No such function: ${name}`);
  return JSON.stringify(run(JSON.parse(json)));
}
