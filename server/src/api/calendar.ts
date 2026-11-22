// Todoist's and Calendar's routes: Connect Todoist, projects and labels, items and their commands,
// calendar search, .ics imports, calendars and weather. Mounted under /api behind the session
// (app.ts).
import {
  calendarUpdateInput, icsImportInput, itemCompleteInput, itemCreateInput, itemScopeInput, itemsRangeInput, subtaskOrderInput, itemUpdateInput, calendarSearchInput, todoistProjectUpdateInput, weatherRangeInput,
} from '@setpoint/shared';
import type {TodoistConnectOut} from '@setpoint/shared';
import {Hono} from 'hono';
import type {Context} from 'hono';
import {z} from 'zod';
import {commandPresenter} from '../commands/index.ts';
import type {CommandRow} from '../commands/index.ts';
import {completeItem, createItem, deleteItem, reorderSubtasks, setCalendarColour, setProjectColour, updateItem} from '../commands/items.ts';
import {importEvent, readImport} from '../calendar/icsImport.ts';
import {invalid, parse, SetpointError} from '../errors.ts';
import {BIND_COOKIE, beginTodoistOAuth, TODOIST_CALLBACK_PATH, TodoistOAuthError} from '../providers/todoist/oauth.ts';
import {calendarList, itemDetail, itemsInRange, setCalendarShown, todoistLabels, todoistProjects, weatherDays} from '../queries/items.ts';
import {searchCalendar} from '../search/calendar.ts';
import {getSettings} from '../settings.ts';
import {noteLive} from '../store.ts';
import type {Store} from '../store.ts';
import {cookieNames} from './auth.ts';
import {setCookie} from 'hono/cookie';
import type {AppOptions} from './app.ts';

const id = (value: string) => parse(z.coerce.number().pipe(z.int().positive()), value);

async function body(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw invalid('The body must be JSON.');
  }
}

// An .ics file's read, whose body limit app.ts sets by this path.
const ICS_READ = '/calendar/import/read';
export const ICS_READ_PATH = `/api${ICS_READ}`;

export interface CalendarApiOptions {
  cookies: ReturnType<typeof cookieNames>;
  providers: NonNullable<AppOptions['providers']>;
}

export function calendarApi(store: Store, {cookies, providers}: CalendarApiOptions) {
  const api = new Hono();
  const presentCommand = (row: CommandRow) => commandPresenter(store)(row);

  // ---- Todoist ----

  api.post('/todoist/connect', c => {
    let begun;
    try {
      begun = beginTodoistOAuth(store, providers.todoistOAuth ?? {client: null});
    } catch (error) {
      if (error instanceof TodoistOAuthError) throw new SetpointError('todoist_not_configured', error.message, 503);
      throw error;
    }
    setCookie(c, BIND_COOKIE, begun.bind, {httpOnly: true, secure: cookies.secure, sameSite: 'Lax', path: TODOIST_CALLBACK_PATH, maxAge: 10 * 60});
    return c.json({url: begun.url} satisfies TodoistConnectOut);
  });
  api.get('/todoist/projects', c => c.json(todoistProjects(store)));
  // A project's colour is a command to Todoist. The project answers with it pending.
  api.patch('/todoist/projects/:id', async c => {
    const providerId = c.req.param('id');
    setProjectColour(store, providerId, parse(todoistProjectUpdateInput, await body(c)).colour);
    return c.json(todoistProjects(store).find(project => project.id === providerId)!);
  });
  api.get('/todoist/labels', c => c.json(todoistLabels(store)));

  // ---- Calendar ----

  api.get('/items', c => {
    const range = parse(itemsRangeInput, c.req.query());
    return c.json(itemsInRange(store, range.from, range.to));
  });
  // Calendar search.
  api.post('/calendar/search', async c => c.json(searchCalendar(store, parse(calendarSearchInput, await body(c)))));
  api.get('/items/:id', c => c.json(itemDetail(store, id(c.req.param('id')))));
  api.post('/items', async c => c.json(presentCommand(createItem(store, parse(itemCreateInput, await body(c)))), 201));
  api.patch('/items/:id', async c => c.json(presentCommand(updateItem(store, id(c.req.param('id')), parse(itemUpdateInput, await body(c))))));
  api.post('/items/:id/delete', async c => c.json(presentCommand(deleteItem(store, id(c.req.param('id')), parse(itemScopeInput, await body(c))))));
  api.post('/items/:id/complete', async c => {
    const input = parse(itemCompleteInput, await body(c));
    return c.json(presentCommand(completeItem(store, id(c.req.param('id')), input.done, input.occurrence_date)));
  });
  api.put('/items/:id/subtasks/order', async c => c.json(presentCommand(reorderSubtasks(store, id(c.req.param('id')), parse(subtaskOrderInput, await body(c)).subtask_ids))));
  // An .ics file's events, read for review (its bytes as the body), then imported one at a time.
  api.post(ICS_READ, async c => c.json(readImport(store, new Uint8Array(await c.req.arrayBuffer()))));
  api.post('/calendar/import', async c => c.json(presentCommand(importEvent(store, parse(icsImportInput, await body(c)))), 201));
  api.get('/calendars', c => c.json(calendarList(store)));
  api.patch('/calendars/:id', async c => {
    const calendarId = id(c.req.param('id'));
    const input = parse(calendarUpdateInput, await body(c));
    if (input.visible !== undefined || input.listed !== undefined) {
      setCalendarShown(store, calendarId, {visible: input.visible, listed: input.listed});
      noteLive(store, {type: 'items', items: [], calendars: [calendarId], commands: []});
    }
    // A colour is a command to Google. The calendar answers with it pending.
    if (input.colour !== undefined) setCalendarColour(store, calendarId, input.colour);
    return c.json(calendarList(store).find(calendar => calendar.id === calendarId)!);
  });
  api.get('/weather', c => {
    const range = parse(weatherRangeInput, c.req.query());
    return c.json(weatherDays(store, range.from, range.to, getSettings(store).calendar.weather));
  });

  return api;
}
