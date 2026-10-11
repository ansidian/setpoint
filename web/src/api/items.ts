// The calendar's resources (shared/src/api/items.ts has the routes): items and weather by month,
// one item, the calendars with their toggles, and F6's changes to items. A toggle shows at once and
// is Setpoint's own setting, not a provider change, so it needs no command; a calendar's colour
// (SV-20) is written to Google, so it is one.
import type {CalendarOut, Colour, CommandOut, ItemChanges, ItemCreateInput, ItemKind, PlaceSuggestionOut, ProposalOut, RecurringScope, TodoistColour, TodoistProjectOut} from '@setpoint/shared';
import {addMonths, firstOfMonth} from '../logic/calendar.ts';
import {afterPending, cachedPaths, getJson, refresh, refreshIfShown, sendJson, updateCached} from './client.ts';

export const itemsPath = (from: string, to: string) => `/items?from=${from}&to=${to}`;
export const itemPath = (id: number) => `/items/${id}`;
export const CALENDARS_PATH = '/calendars';
export const weatherPath = (from: string, to: string) => `/weather?from=${from}&to=${to}`;

/** A month's items ("2026-10" → Oct 1 to Nov 1), so months scrolled past stay cached. */
export const monthItemsPath = (month: string) => itemsPath(firstOfMonth(month), firstOfMonth(addMonths(month, 1)));
export const monthWeatherPath = (month: string) => weatherPath(firstOfMonth(month), firstOfMonth(addMonths(month, 1)));

/** Shows a calendar or hides it on the grid and in the agenda. */
export async function setCalendarVisible(id: number, visible: boolean): Promise<void> {
  updateCached<CalendarOut[]>(CALENDARS_PATH, list => list.map(calendar => (calendar.id === id ? {...calendar, visible} : calendar)));
  try {
    const calendar = await sendJson<CalendarOut>('PATCH', `/calendars/${id}`, {visible});
    updateCached<CalendarOut[]>(CALENDARS_PATH, list => list.map(one => (one.id === id ? calendar : one)));
  } catch (error) {
    refreshIfShown(CALENDARS_PATH);
    throw error;
  }
}

/**
 * SV-20: a Google calendar's colour, a change to Google through the command layer. It shows at once;
 * the calendar answers with the command pending, and live events bring Google's answer.
 */
export async function setCalendarColour(id: number, colour: Colour): Promise<void> {
  updateCached<CalendarOut[]>(CALENDARS_PATH, list => list.map(one => (one.id === id ? {...one, colour} : one)));
  try {
    const calendar = await sendJson<CalendarOut>('PATCH', `/calendars/${id}`, {colour});
    updateCached<CalendarOut[]>(CALENDARS_PATH, list => list.map(one => (one.id === id ? calendar : one)));
  } catch (error) {
    refreshIfShown(CALENDARS_PATH);
    throw error;
  }
}

/** A failed colour's Try again, or its Change back (Move back: the colour it had). */
export async function settleCalendarColour(commandId: number, how: 'retry' | 'move-back'): Promise<void> {
  await sendJson<CommandOut>('POST', `/commands/${commandId}/${how}`);
  refreshIfShown(CALENDARS_PATH);
}

// ---------- F6: changes, through the command layer ----------
// Each change answers with its command at once (pending); the grid then refetches its months, so the
// item shows where the change put it, at .5 until the provider confirms, or failed in place. Live
// events bring the confirmation or the failure.

export const SETTINGS_PATH = '/settings';
export const TODOIST_PROJECTS_PATH = '/todoist/projects';
export const TODOIST_LABELS_PATH = '/todoist/labels';

/** SV-25: a Todoist project's colour, written to Todoist as a calendar's is to Google. */
export async function setProjectColour(id: string, colour: TodoistColour): Promise<void> {
  updateCached<TodoistProjectOut[]>(TODOIST_PROJECTS_PATH, list => list.map(one => (one.id === id ? {...one, colour} : one)));
  try {
    const project = await sendJson<TodoistProjectOut>('PATCH', `/todoist/projects/${encodeURIComponent(id)}`, {colour});
    updateCached<TodoistProjectOut[]>(TODOIST_PROJECTS_PATH, list => list.map(one => (one.id === id ? project : one)));
  } catch (error) {
    refreshIfShown(TODOIST_PROJECTS_PATH);
    throw error;
  }
}

/** A failed project colour's Try again, or its Change back. */
export async function settleProjectColour(commandId: number, how: 'retry' | 'move-back'): Promise<void> {
  await sendJson<CommandOut>('POST', `/commands/${commandId}/${how}`);
  refreshIfShown(TODOIST_PROJECTS_PATH);
}

/** Every month of items loaded, again. */
export const refreshItems = () => Promise.all(cachedPaths('/items').map(path => refresh(path)));

async function change<T>(send: () => Promise<T>): Promise<T> {
  try {
    return await send();
  } finally {
    await refreshItems();
  }
}

/** Creates items one after another (batch drafts, Paste), each its own command. */
export const createItems = (inputs: ItemCreateInput[]) => change(async () => {
  const commands: CommandOut[] = [];
  for (const input of inputs) commands.push(await sendJson<CommandOut>('POST', '/items', input));
  return commands;
});

/** A move, resize or edit; Undo right after waits for the change before it to reach the provider. */
export const updateItem = (id: number, input: {changes: ItemChanges; scope?: RecurringScope; occurrence_start?: string | null}) =>
  change(() => afterPending(() => sendJson<CommandOut>('PATCH', `/items/${id}`, input)));

/** A delete; one right after a change (⌘Z on a paste) waits for that change to reach the provider. */
export const deleteItem = (id: number, input: {scope?: RecurringScope; occurrence_start?: string | null} = {}, {keepalive = false} = {}) =>
  change(() => afterPending(() => sendJson<CommandOut>('POST', `/items/${id}/delete`, input, {keepalive})));

/** Complete or Reopen; Undo right after waits for the Complete before it to reach Todoist. */
export const completeItem = (id: number, done: boolean, occurrenceDate: string | null = null) =>
  change(() => afterPending(() => sendJson<CommandOut>('POST', `/items/${id}/complete`, {done, occurrence_date: occurrenceDate})));

/** The failed card's Try again and Move back. */
export const retryChange = (commandId: number) => change(() => sendJson<CommandOut>('POST', `/commands/${commandId}/retry`));
export const moveBack = (commandId: number) => change(() => sendJson<CommandOut>('POST', `/commands/${commandId}/move-back`));

/** Places suggestions for the editor's place; one session token per editing session. */
export const placeSuggestions = (query: string, sessionToken: string) =>
  getJson<PlaceSuggestionOut[]>(`/places?query=${encodeURIComponent(query)}&session_token=${encodeURIComponent(sessionToken)}`);

/** An email's proposal, for the editor opened from the proposal card's More options. */
export const proposalFrom = (messageId: number, kind: ItemKind) => sendJson<ProposalOut>('POST', '/proposals/from-message', {message_id: messageId, kind});
